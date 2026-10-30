import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBObjectStore } from 'fake-indexeddb'
import { AUTHORED_STAGES, generateSurvivalStage } from '../content/production'
import { MATH_QUESTION_BANK } from '../../server/math-questions'
import { advanceShift, initializeShift, transitionShift } from '../domain/shift-engine'
import type { PrintShopGateway } from '../domain/gateways'
import type { MathQuestion, PrintAuthorization, ShiftProgression, ShiftResult, ShiftSnapshot } from '../domain/shift-types'
import { BROWSER_STORE_KEYS, BrowserCardLibrary, BrowserPrintShop, BrowserSessionStore } from '../infrastructure/browser-store'
import { BrowserShiftStore, IndexedDbShiftCoordinator, SHIFT_STORE_KEYS, ShiftStoreConflictError, recoverPendingShiftPrint, type ShiftLockCoordinator } from '../infrastructure/shift-store'

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  writes = 0
  leaseWrites = 0
  get length() { return this.values.size }
  clear() { this.writes += 1; this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.writes += 1; if (key === BROWSER_STORE_KEYS.printLease || key === SHIFT_STORE_KEYS.mutationLease) this.leaseWrites += 1; this.values.delete(key) }
  setItem(key: string, value: string) { this.writes += 1; if (key === BROWSER_STORE_KEYS.printLease || key === SHIFT_STORE_KEYS.mutationLease) this.leaseWrites += 1; this.values.set(key, value) }
}

const result = (shiftRunId = 'run-1'): ShiftResult => ({
  shiftRunId, stageId: 'tutorial', day: 1, closedAtMs: 720_000,
  delivered: 4, satisfied: 3, left: 1, averageScore: 81, longestQualityStreak: 2, passed: true, failureReasons: [],
})

const addSettlement = (progression: ShiftProgression, settled: ShiftResult): ShiftProgression => ({
  ...progression, results: [...progression.results, settled], cumulativeSatisfied: progression.cumulativeSatisfied + settled.satisfied,
})

function pending(): Extract<PrintAuthorization, { status: 'calibrated_pending_start' }> {
  return {
    id: 'intent-1', shiftRunId: 'run-1', orderId: 'order-1', snapshotId: 'snapshot-1', confirmedAtMs: 1_000,
    nextAttempt: 2, status: 'calibrated_pending_start', machineId: 'quick', reservationId: 'reservation-1',
    puzzleId: 'puzzle-1', calibratedAtMs: 2_000,
  }
}

function snapshot(authorization: PrintAuthorization = pending()): ShiftSnapshot {
  const stage = AUTHORED_STAGES.tutorial
  const design = {
    version: 1 as const,
    preparation: { paperId: 'cream' as const, paperMaterialId: 'smooth' as const, shapeId: 'landscape' as const,
      orientation: 'landscape' as const, layoutId: 'layout-1', surfaceFinishId: 'matte' as const },
    elements: [], crafts: [],
  }
  return {
    version: 1, revision: 7, savedAtMs: 2_000,
    run: {
      version: 1, id: 'run-1', stage, seed: 'seed', status: 'running', startedAtMs: 0,
      deadlineAtMs: 720_000, lastProcessedAtMs: 2_000, pauses: [], seenTutorialTriggers: [], orders: [{
        id: 'order-1', shiftRunId: 'run-1', content: stage.customers[0].order, arrivalAtMs: 0,
        acceptedAtMs: 500, basePatienceSeconds: 300, lastWaitSeconds: 30, position: 'active',
        patience: { phase: 'normal', remainingSeconds: 298, updatedAtMs: 2_000, depletesAtMs: 300_000 }, outcome: { status: 'pending' }, remedy: 'none',
      }], activeOrderIds: ['order-1'],
      selectedOrderId: 'order-1', station: 'print', drafts: { 'draft-1': {
        id: 'draft-1', shiftRunId: 'run-1', orderId: 'order-1', revision: 1, derivedFromSnapshotId: null,
        design, reservationIds: [], inspections: [], stage: 'archived', snapshotId: 'snapshot-1',
      } }, snapshotIds: ['snapshot-1'],
      snapshots: { 'snapshot-1': {
        kind: 'production-card', version: 1, id: 'snapshot-1', shiftRunId: 'run-1', orderId: 'order-1',
        draftId: 'draft-1', draftRevision: 1, savedAtMs: 1_000, design,
      } },
      materials: { stock: Object.fromEntries(Object.entries(stage.inventory).map(([id, available]) => [id, { available, reserved: 0, consumed: 0 }])) as ShiftSnapshot['run']['materials']['stock'], reservations: {} },
      authorizations: { 'intent-1': authorization }, puzzles: authorization.status === 'confirmed' ? {} : { 'puzzle-1': {
        id: 'puzzle-1', shiftRunId: 'run-1', orderId: 'order-1', intentId: 'intent-1', machineId: 'quick',
        attempt: 1, startedAtMs: 1_000, deadlineAtMs: 10_000,
        definition: { kind: 'number-search', grid: [1, 2], columns: 2, target: 1 },
        result: { status: 'succeeded', submittedAtMs: 2_000, answer: { kind: 'number-search', index: 0 } },
      } }, tasks: {},
      printers: {
        quick: { machineId: 'quick', currentTaskId: null, queuedTaskIds: [], reservations: authorization.status === 'confirmed' ? [] : [{
          id: 'reservation-1', intentId: 'intent-1', orderId: 'order-1', shiftRunId: 'run-1', machineId: 'quick',
          puzzleId: 'puzzle-1', status: 'calibrated_pending_start', calibratedAtMs: 2_000,
        }], orderLockUntilMs: {}, estimatedFreeAtMs: null },
        fine: { machineId: 'fine', currentTaskId: null, queuedTaskIds: [], reservations: [], orderLockUntilMs: {}, estimatedFreeAtMs: null },
      },
      inspectionsRemaining: 3, freeDemoInspectionsRemaining: 1,
      remedies: { explainProgressAvailable: true, expediteAvailable: true }, pendingReconciliationIntentIds: [],
    },
  }
}

function closedSnapshot(): ShiftSnapshot {
  const open = snapshot()
  return { ...open, savedAtMs: 900_000, run: { ...open.run, status: 'settled', result: result(), pendingReconciliationIntentIds: ['intent-1'] } }
}

function finalizedSnapshot(shiftRunId = 'run-1'): ShiftSnapshot & { run: Extract<ShiftSnapshot['run'], { status: 'settled' }> } {
  const run = initializeShift(AUTHORED_STAGES.tutorial, shiftRunId, 0)
  return { version: 1, revision: 8, savedAtMs: 900_000, run: { ...run, status: 'settled', result: result(shiftRunId) } }
}

function collectedSnapshot(): ShiftSnapshot & { run: Extract<ShiftSnapshot['run'], { status: 'settled' }> } {
  const saved = snapshot({ id: 'intent-1', shiftRunId: 'run-1', orderId: 'order-1', snapshotId: 'snapshot-1',
    confirmedAtMs: 1_000, nextAttempt: 1, status: 'confirmed', machineId: 'quick' })
  return { ...saved, run: { ...saved.run, status: 'settled', result: result() } }
}

async function seedV1TransactionRecord(current: string | null, reconciliation: string | null): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('rabbit-house:v1:shift-transactions', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('envelopes') }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('envelopes', 'readwrite')
      transaction.objectStore('envelopes').put({ version: 1, kind: 'shift-envelopes', current, reconciliation }, 'current-and-reconciliation')
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onabort = () => { database.close(); reject(transaction.error) }
    }
  })
}

function nextSnapshot(): ShiftSnapshot {
  const open = snapshot()
  return { ...open, run: { ...open.run, id: 'run-2', orders: [], activeOrderIds: [], selectedOrderId: null,
    drafts: {}, snapshots: {}, snapshotIds: [], authorizations: {}, puzzles: {}, pendingReconciliationIntentIds: [],
    printers: { ...open.run.printers, quick: { ...open.run.printers.quick, reservations: [] } },
  } }
}

function serialLocks(): ShiftLockCoordinator {
  let tail = Promise.resolve()
  return { async request<T>(_name: string, action: () => T | Promise<T>): Promise<T> {
    const result = tail.then(action)
    tail = result.then(() => undefined, () => undefined)
    return result
  } }
}

function selectedSurfaceFinish(surfaceFinishId: 'foil' | 'emboss' | 'wax', departure: 'patience' | 'closing'): ShiftSnapshot {
  const stage = { ...AUTHORED_STAGES.tutorial, inventory: { ...AUTHORED_STAGES.tutorial.inventory,
    'foil-sheet': 3, 'emboss-sheet': 3, wax: 3 }, customers: [{ ...AUTHORED_STAGES.tutorial.customers[0],
    basePatienceSeconds: departure === 'closing' ? 1000 : 2, lastWaitSeconds: 1 }] }
  let run = initializeShift(stage, `surface-${surfaceFinishId}-${departure}`, 1000)
  run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, 1000)
  const draftId = Object.keys(run.drafts)[0]
  run = transitionShift(run, { station: 'preparation', type: 'select-preparation', draftId,
    selection: { ...run.orders[0].content.requirements, surfaceFinishId } }, 1000)
  run = transitionShift(run, { station: 'preparation', type: 'cut-blank', draftId }, 1000)
  run = transitionShift(run, { station: 'craft', type: 'select-craft', draftId,
    craftId: 'surface-finish', operationId: 'finish', discrete: {} }, 1000)
  return { version: 1, revision: 1, savedAtMs: 1000, run }
}

beforeEach(() => {
  // Existing envelope-contract tests exercise the Web Locks storage path.
  vi.stubGlobal('navigator', { locks: serialLocks() })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('BrowserShiftStore', () => {
  it.each((['foil', 'emboss', 'wax'] as const).flatMap(surfaceFinishId =>
    (['patience', 'closing'] as const).map(departure => ({ surfaceFinishId, departure }))))(
    'persists selected $surfaceFinishId surface finish released on $departure and rejects forged releases', async ({ surfaceFinishId, departure }) => {
      const store = new BrowserShiftStore(new MemoryStorage())
      const selected = selectedSurfaceFinish(surfaceFinishId, departure)
      await store.saveCurrent(selected)
      const at = departure === 'closing' ? selected.run.deadlineAtMs : 10_000
      const departed: ShiftSnapshot = { ...selected, revision: 2, savedAtMs: at, run: advanceShift(selected.run, at) }
      const order = departed.run.orders[0]
      expect(order.outcome).toMatchObject({ status: 'left', reason: departure })
      if (order.outcome.status !== 'left') throw new Error('Expected a departed order')
      const draft = Object.values(departed.run.drafts)[0]
      expect(draft).toMatchObject({ stage: 'crafting', activeCraft: { status: 'selected' } })
      const reservation = Object.values(departed.run.materials.reservations).find(item => item.operationId === 'finish')!
      expect(reservation).toMatchObject({ status: 'released', releasedAtMs: order.outcome.leftAtMs })
      await store.saveCurrent(departed, selected.revision)
      expect(await store.loadCurrent()).toEqual(departed)

      const pending = { ...departed, revision: 3, run: { ...selected.run, lastProcessedAtMs: at, materials: departed.run.materials } }
      await expect(store.saveCurrent(pending, departed.revision)).rejects.toThrow('Invalid current shift snapshot')
      for (const changes of [{ releasedAtMs: order.outcome.leftAtMs + 1 }, { operationId: 'another-operation' },
        { draftId: 'another-draft' }, { quantity: reservation.quantity + 1 }]) {
        const invalid = structuredClone(departed)
        Object.assign(invalid.run.materials.reservations[reservation.id], changes)
        await expect(store.saveCurrent({ ...invalid, revision: 3 }, departed.revision)).rejects.toThrow('Invalid current shift snapshot')
      }
      const invalidKind = structuredClone(departed)
      const invalidDraft = invalidKind.run.drafts[draft.id]
      if (invalidDraft.stage !== 'crafting' || !invalidDraft.activeCraft) throw new Error('Missing active craft')
      Object.assign(invalidDraft.activeCraft, { kind: 'ribbon' })
      await expect(store.saveCurrent({ ...invalidKind, revision: 3 }, departed.revision)).rejects.toThrow('Invalid current shift snapshot')

      const closed: ShiftSnapshot = { ...departed, revision: 3, savedAtMs: departed.run.deadlineAtMs,
        run: advanceShift(departed.run, departed.run.deadlineAtMs) }
      if (closed.run.status !== 'settled') throw new Error('Expected settlement')
      await store.saveCurrent(closed, departed.revision)
      await store.recordSettlement(closed.run.result, addSettlement)
      expect(await store.loadCurrent()).toEqual(closed)
      expect(await store.listFinished()).toEqual([closed.run.result])
      expect(await store.listWorkshopDrafts()).toHaveLength(1)
    })

  it.each(['foil', 'emboss', 'wax'] as const)('keeps consumed %s surface finish materials irreversible after closure', async surfaceFinishId => {
    const store = new BrowserShiftStore(new MemoryStorage())
    const selected = selectedSurfaceFinish(surfaceFinishId, 'closing')
    const draftId = Object.keys(selected.run.drafts)[0]
    const started = transitionShift(selected.run, { station: 'craft', type: 'begin-craft', draftId, craftId: 'surface-finish' }, 1001)
    const closed: ShiftSnapshot = { ...selected, savedAtMs: started.deadlineAtMs, run: advanceShift(started, started.deadlineAtMs) }
    const reservation = Object.values(closed.run.materials.reservations).find(item => item.operationId === 'finish')!
    expect(reservation.status).toBe('consumed')
    await store.saveCurrent(closed)
    expect(await store.loadCurrent()).toEqual(closed)
    const invalid = structuredClone(closed)
    Object.assign(invalid.run.materials.reservations[reservation.id], { status: 'released', releasedAtMs: closed.run.deadlineAtMs })
    const stock = invalid.run.materials.stock[reservation.materialId]
    Object.assign(stock, { consumed: stock.consumed - reservation.quantity, available: stock.available + reservation.quantity })
    await expect(store.saveCurrent({ ...invalid, revision: 2 }, closed.revision)).rejects.toThrow('Invalid current shift snapshot')
    expect(await store.loadCurrent()).toEqual(closed)
  })

  it.each(['foil', 'emboss', 'wax'] as const)('persists and restores a selected and in-progress %s surface finish', async (surfaceFinishId) => {
    const store = new BrowserShiftStore(new MemoryStorage())
    const stage = { ...AUTHORED_STAGES.tutorial, inventory: { ...AUTHORED_STAGES.tutorial.inventory,
      'foil-sheet': 3, 'emboss-sheet': 3, wax: 3 } }
    let run = initializeShift(stage, `surface-${surfaceFinishId}`, 1000)
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, 1000)
    const draftId = Object.keys(run.drafts)[0]
    run = transitionShift(run, { station: 'preparation', type: 'select-preparation', draftId,
      selection: { ...run.orders[0].content.requirements, surfaceFinishId } }, 1000)
    run = transitionShift(run, { station: 'preparation', type: 'cut-blank', draftId }, 1000)
    run = transitionShift(run, { station: 'craft', type: 'select-craft', draftId,
      craftId: 'surface-finish', operationId: 'finish', discrete: {} }, 1000)
    expect(run.drafts[draftId]).toMatchObject({ stage: 'crafting', activeCraft: { status: 'selected', requirementId: 'surface-finish' } })
    const selected: ShiftSnapshot = { version: 1, revision: 1, savedAtMs: 1000, run }
    await store.saveCurrent(selected)
    expect(await store.loadCurrent()).toEqual(selected)
    run = transitionShift((await store.loadCurrent())!.run, { station: 'craft', type: 'begin-craft', draftId, craftId: 'surface-finish' }, 1001)
    run = transitionShift(run, { station: 'craft', type: 'update-craft', draftId, craftId: 'surface-finish',
      progress: { measurements: { coverage: .5 }, completedSteps: ['first-pass'], coverageCells: [1, 2], trace: [{ x: .1, y: .2 }] } }, 1002)
    const active: ShiftSnapshot = { version: 1, revision: 2, savedAtMs: 1002, run }
    await store.saveCurrent(active, selected.revision)
    expect(await store.loadCurrent()).toEqual(active)

    for (const changes of [{ kind: 'ribbon' }, { reservationIds: [] }, { reservationIds: ['missing'] }, { requirementId: 'unknown' }]) {
      const invalid = structuredClone(active)
      const draft = invalid.run.drafts[draftId]
      if (draft.stage !== 'crafting' || !draft.activeCraft) throw new Error('Missing test craft')
      Object.assign(draft.activeCraft, changes)
      await expect(store.saveCurrent({ ...invalid, revision: 3 }, active.revision)).rejects.toThrow('Invalid current shift snapshot')
    }
    expect(await store.loadCurrent()).toEqual(active)
  })

  it.each(['__proto__', 'constructor', 'unknown'])('rejects unknown production assets %s and keeps healthy collection entries readable', async (assetId) => {
    const storage = new MemoryStorage()
    const good = snapshot().run.snapshots['snapshot-1']
    const bad = { ...good, id: 'bad-card', design: { ...good.design,
      preparation: { ...good.design.preparation, layoutId: 'welcome' }, elements: [
        { id: 'bad-word', kind: 'word-stamp' as const, assetId, slotId: 'title', size: 'medium' as const, direction: 'upright' as const, layer: 'front' as const },
      ] } }
    const raw = JSON.stringify({ version: 2, kind: 'shift-collection', value: { cards: [good, bad], drafts: [] } })
    storage.setItem(SHIFT_STORE_KEYS.collection, raw)
    const store = new BrowserShiftStore(storage, { transactions: null })
    expect(await store.listCollectedCards()).toEqual([good])
    expect(storage.getItem(SHIFT_STORE_KEYS.collection)).toBe(raw)
    const saved = snapshot()
    const invalid = { ...saved, run: { ...saved.run, snapshots: { 'snapshot-1': { ...bad, id: 'snapshot-1' } } } }
    await expect(store.saveCurrent(invalid)).rejects.toThrow('Invalid current shift snapshot')
  })

  it('keeps departed unfinished drafts independently after settlement and a later run replaces the current save', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const saved = collectedSnapshot()
    const draft = saved.run.drafts['draft-1']
    const unfinished: ShiftSnapshot = { ...saved, run: { ...saved.run,
      snapshots: {}, snapshotIds: [], authorizations: {},
      activeOrderIds: [], selectedOrderId: null,
      orders: saved.run.orders.map(order => ({ ...order, position: 'closed', outcome: { status: 'left', leftAtMs: 700_000, reason: 'closing' } })),
      drafts: { [draft.id]: { ...draft, stage: 'crafting', activeCraft: null } },
    } }
    await store.saveCurrent(unfinished)
    expect(store.listWorkshopDrafts).toBeTypeOf('function')
    expect(await store.listWorkshopDrafts()).toEqual([])
    await store.recordSettlement(result(), addSettlement)
    await store.recordSettlement(result(), addSettlement)
    await store.saveCurrent(nextSnapshot())
    const drafts = await new BrowserShiftStore(storage).listWorkshopDrafts()
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ shiftRunId: saved.run.id, customerName: saved.run.orders[0].content.customer.name,
      design: draft.design })
    expect(await store.listCollectedCards()).toEqual([])
    ;(drafts[0].design.elements as unknown[]).push({ changed: true })
    expect((await store.listWorkshopDrafts())[0].design).toEqual(draft.design)
  })
  it.each([-1, null, '5000'])('rejects an invalid inspection clock offset %j', async (offset) => {
    const storage = new MemoryStorage()
    const saved = snapshot()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current',
      value: { ...saved, run: { ...saved.run, inspectionTimeOffsetMs: offset } } }))
    const store = new BrowserShiftStore(storage, { locks: serialLocks(), transactions: null })
    expect((await store.inspectCurrent()).status).toBe('corrupt')
  })

  it('archives immediately, atomically and once, independently of a corrupt current shift', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const saved = snapshot()
    expect(store.saveArchive).toBeTypeOf('function')
    await store.saveArchive(saved)
    await store.saveArchive(saved)
    expect(await store.listFinished()).toEqual([])
    expect(await store.listCollectedCards()).toEqual([saved.run.snapshots['snapshot-1']])
    await new IndexedDbShiftCoordinator().run(storage, 'readwrite', false, canonical => canonical.setItem(SHIFT_STORE_KEYS.current, '{damaged'))
    const reopened = new BrowserShiftStore(storage, { locks: null })
    expect((await reopened.inspectCurrent()).status).toBe('corrupt')
    expect(await reopened.listCollectedCards()).toEqual([saved.run.snapshots['snapshot-1']])
    await reopened.saveCurrent(nextSnapshot())
    expect(await reopened.listCollectedCards()).toEqual([saved.run.snapshots['snapshot-1']])
  })

  it('rolls back an archive and its current revision together, then retries and settles without duplicates', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const next = nextSnapshot()
    const initial = { ...next, revision: 6, run: { ...next.run, id: 'run-1' } }
    await store.saveCurrent(initial)
    const archived = collectedSnapshot()
    expect(store.saveArchive).toBeTypeOf('function')
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      this.transaction.abort()
      return request
    })
    await expect(store.saveArchive(archived, initial.revision)).rejects.toThrow()
    expect(await store.loadCurrent()).toEqual(initial)
    expect(await store.listCollectedCards()).toEqual([])
    await store.saveArchive(archived, initial.revision)
    await store.recordSettlement(result(), addSettlement)
    expect(await new BrowserShiftStore(storage).listCollectedCards()).toEqual([archived.run.snapshots['snapshot-1']])
    expect(await store.listFinished()).toEqual([result()])
  })

  it('rejects an old archive when another tab has opened a different run at the same revision', async () => {
    const store = new BrowserShiftStore(new MemoryStorage())
    const current = nextSnapshot()
    await store.saveCurrent(current)
    await expect(store.saveArchive(snapshot(), current.revision)).rejects.toBeInstanceOf(ShiftStoreConflictError)
    expect(await store.loadCurrent()).toEqual(current)
    expect(await store.listCollectedCards()).toEqual([])
  })

  it.each(['legacy', 'canonical'] as const)('collects cards once when repairing an already-recorded %s settlement', async (source) => {
    const storage = new MemoryStorage()
    const saved = collectedSnapshot()
    storage.setItem(SHIFT_STORE_KEYS.history, JSON.stringify({ version: 1, kind: 'shift-history', value: [result('previous'), result()] }))
    const store = new BrowserShiftStore(storage, { locks: source === 'legacy' ? serialLocks() : null })
    await store.saveCurrent(saved)
    const existing = addSettlement(await store.loadProgression(), result())
    await store.saveProgression(existing)
    const before = new Map(storage.values)
    expect(await store.listCollectedCards()).toEqual([])
    expect(storage.values).toEqual(before)
    await store.recordSettlement(result(), addSettlement)
    await store.recordSettlement(result(), addSettlement)
    await store.saveCurrent(nextSnapshot())
    const reopened = new BrowserShiftStore(storage, { locks: null })
    const cards = await reopened.listCollectedCards()
    expect(cards).toEqual([saved.run.snapshots['snapshot-1']])
    ;(cards[0].design.elements as unknown[]).push({ unexpected: true })
    expect(await reopened.listCollectedCards()).toEqual([saved.run.snapshots['snapshot-1']])
    expect(await reopened.listFinished()).toEqual([result('previous'), result()])
    expect(await reopened.loadProgression()).toEqual(existing)
  })

  it.each(['settlement', 'reconciliation'] as const)('commits collections with %s and retains the source when the transaction aborts', async (operation) => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const saved = collectedSnapshot()
    if (operation === 'settlement') await store.saveCurrent(saved)
    else { await store.saveReconciliation(saved); await store.saveCurrent(nextSnapshot()) }
    const commit = (active: BrowserShiftStore) => operation === 'settlement'
      ? active.recordSettlement(result(), addSettlement)
      : active.finalizeReconciliation(saved.run.id, result(), saved.revision)
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      this.transaction.abort()
      this.transaction.db.close()
      return request
    })
    await expect(commit(store)).rejects.toThrow()
    const reopened = new BrowserShiftStore(storage, { locks: null })
    expect(await reopened.listFinished()).toEqual([])
    expect(await reopened.listCollectedCards()).toEqual([])
    expect((await reopened.loadProgression()).results).toEqual([])
    expect(operation === 'settlement' ? await reopened.loadCurrent() : (await reopened.listReconciliations())[0]).toEqual(saved)
    await commit(reopened)
    await reopened.recordSettlement(result(), addSettlement)
    await reopened.recordSettlement(result(), addSettlement)
    if (operation === 'settlement') await reopened.saveCurrent(nextSnapshot())
    expect(await new BrowserShiftStore(storage).listCollectedCards()).toEqual([saved.run.snapshots['snapshot-1']])
    expect(await reopened.listFinished()).toEqual([result()])
    if (operation === 'reconciliation') expect(await reopened.listReconciliations()).toEqual([])
  })

  it('round-trips persisted tutorial acknowledgements', async () => {
    const store = new BrowserShiftStore(new MemoryStorage())
    const saved = snapshot()
    const current: ShiftSnapshot = { ...saved, run: { ...saved.run, seenTutorialTriggers: ['read_order', 'choose_materials'] } }
    await store.saveCurrent(current)
    expect((await store.loadCurrent())?.run.seenTutorialTriggers).toEqual(['read_order', 'choose_materials'])
  })

  it('round-trips authored calibration plans and optional legal machine plans unchanged', async () => {
    const stages = [...Object.values(AUTHORED_STAGES), ...[
      undefined, {}, { quick: 'math' as const }, { fine: 'sudoku' as const }, { quick: 'minesweeper' as const, fine: 'math' as const },
    ].map(calibrationPlan => ({ ...AUTHORED_STAGES.tutorial,
      customers: AUTHORED_STAGES.tutorial.customers.map((customer, index) => index === 0 ? { ...customer, calibrationPlan } : customer),
    }))]
    for (const stage of stages) {
      const saved: ShiftSnapshot = { version: 1, revision: 1, savedAtMs: 1000, run: initializeShift(stage, 'calibration-plans', 1000) }
      const store = new BrowserShiftStore(new MemoryStorage())
      await store.saveCurrent(saved)
      expect(await store.loadCurrent()).toEqual(saved)
    }
  })

  it.each([null, [], 'sudoku', { fine: 'maths' }, { quick: 'identify' }, { fine: 2 }, { coarse: 'math' }, { fine: null }].map((calibrationPlan, index) => ({ calibrationPlan, index })))(
    'rejects malformed persisted calibration plan $index before runtime fallback', async ({ calibrationPlan }) => {
      const storage = new MemoryStorage()
      const saved = snapshot()
      const current = { ...saved, run: { ...saved.run, stage: { ...saved.run.stage,
        customers: saved.run.stage.customers.map((customer, index) => index === 0 ? { ...customer, calibrationPlan } : customer),
      } } } as unknown as ShiftSnapshot
      storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: current }))
      const writes = storage.writes
      const store = new BrowserShiftStore(storage)
      expect((await store.inspectCurrent()).status).toBe('corrupt')
      expect(await store.loadCurrent()).toBeUndefined()
      expect(storage.writes).toBe(writes)
      await expect(store.saveCurrent(current)).rejects.toThrow(/invalid/i)
    },
  )

  it.each([undefined, ['unknown-trigger'], ['read_order', 'read_order'], 'read_order'].map(seenTutorialTriggers => ({ seenTutorialTriggers })))('rejects invalid persisted tutorial triggers $seenTutorialTriggers', async ({ seenTutorialTriggers }) => {
    const store = new BrowserShiftStore(new MemoryStorage())
    const saved = snapshot()
    await expect(store.saveCurrent({ ...saved, run: { ...saved.run, seenTutorialTriggers } } as unknown as ShiftSnapshot)).rejects.toThrow(/invalid/i)
  })

  it.each([undefined, -1, 1.5, 4, NaN])('rejects invalid settled quality streak %s', async longestQualityStreak => {
    const store = new BrowserShiftStore(new MemoryStorage())
    await expect(store.appendFinished({ ...result(), longestQualityStreak } as ShiftResult)).rejects.toThrow(/invalid/i)
    expect(await store.listFinished()).toEqual([])
  })

  it('round-trips a generated survival shift with negative arrival jitter', async () => {
    const stage = generateSurvivalStage(7, 'survival-store')
    expect(stage.customers.some(customer => customer.arrivalJitterSeconds < 0)).toBe(true)
    const current: ShiftSnapshot = { version: 1, revision: 1, savedAtMs: 1_000, run: initializeShift(stage, 'survival-run', 1_000) }
    const store = new BrowserShiftStore(new MemoryStorage())
    await store.saveCurrent(current)
    expect(await store.loadCurrent()).toEqual(current)
  })

  it.each([-13, 13, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('rejects invalid survival arrival jitter %s', async (jitter) => {
    const generated = generateSurvivalStage(7, 'survival-store')
    const stage = { ...generated, customers: generated.customers.map((customer, index) => ({ ...customer, arrivalJitterSeconds: index === 0 ? jitter : Math.abs(customer.arrivalJitterSeconds) })) }
    const current: ShiftSnapshot = { version: 1, revision: 1, savedAtMs: 1_000, run: initializeShift(stage, 'survival-run', 1_000) }
    const store = new BrowserShiftStore(new MemoryStorage())
    await expect(store.saveCurrent(current)).rejects.toThrow(/invalid/i)
  })

  it.each(['web-locks', 'indexeddb'] as const)('distinguishes missing, valid and corrupt current records through %s without changing other stores', async (mode) => {
    const storage = new MemoryStorage()
    const transactions = new IndexedDbShiftCoordinator()
    const store = new BrowserShiftStore(storage, mode === 'web-locks' ? { locks: serialLocks(), transactions: null } : { locks: null, transactions })
    expect(await store.inspectCurrent()).toEqual({ status: 'missing' })
    await store.saveCurrent(snapshot())
    expect(await store.inspectCurrent()).toEqual({ status: 'valid', snapshot: snapshot() })
    if (mode === 'web-locks') storage.setItem(SHIFT_STORE_KEYS.current, '{damaged')
    else {
      storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: snapshot() }))
      await transactions.run(storage, 'readwrite', false, canonical => canonical.setItem(SHIFT_STORE_KEYS.current, '{damaged'))
    }
    const before = new Map(storage.values)
    expect(await store.inspectCurrent()).toEqual({ status: 'corrupt' })
    expect(await store.loadCurrent()).toBeUndefined()
    expect(storage.values).toEqual(before)
  })

  it('rejects stale queued-run updates and removals under the same atomic revision guard', async () => {
    const store = new BrowserShiftStore(new MemoryStorage(), { locks: null })
    const initial = closedSnapshot()
    await store.saveReconciliation(initial)
    const first = { ...initial, revision: initial.revision + 1, savedAtMs: 900_001 }
    const second = { ...first, savedAtMs: 900_002 }
    const outcomes = await Promise.allSettled([store.saveReconciliation(first, initial.revision), store.saveReconciliation(second, initial.revision)])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(outcome => outcome.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ShiftStoreConflictError)
    await expect(store.removeReconciliation(initial.run.id, initial.revision)).rejects.toBeInstanceOf(ShiftStoreConflictError)
  })

  it('uses separate versioned envelopes and deep-copies current state, results and progression', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const current = snapshot()
    const finished = result()
    const progression = await store.loadProgression()
    await store.saveCurrent(current)
    await store.appendFinished(finished)
    await store.saveProgression(progression)
    ;(current.run.printers.quick.reservations as unknown[]).length = 0
    ;(finished.failureReasons as string[]).push('departures')
    ;(progression.completedAuthoredStages as string[]).push('story')
    const reopened = new BrowserShiftStore(storage)
    const loaded = await reopened.loadCurrent()
    expect(loaded?.run.printers.quick.reservations).toHaveLength(1)
    ;(loaded!.run.printers.quick.reservations as unknown[]).length = 0
    const history = await reopened.listFinished()
    ;(history[0].failureReasons as string[]).push('departures')
    const loadedProgress = await reopened.loadProgression()
    ;(loadedProgress.completedAuthoredStages as string[]).push('story')
    expect((await reopened.loadCurrent())?.run.printers.quick.reservations).toHaveLength(1)
    expect((await reopened.listFinished())[0].failureReasons).toEqual([])
    expect((await reopened.loadProgression()).completedAuthoredStages).toEqual([])
    expect([...storage.values.keys()].sort()).toEqual([SHIFT_STORE_KEYS.current, SHIFT_STORE_KEYS.history, SHIFT_STORE_KEYS.progression].sort())
    for (const name of ['current', 'history', 'progression'] as const) {
      const key = SHIFT_STORE_KEYS[name]
      expect(JSON.parse(storage.getItem(key)!)).toMatchObject({ version: name === 'history' ? 2 : 1, kind: `shift-${name}` })
    }
  })

  it('reads missing or valid stores without writes and appends each finished shift once', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    expect(await store.loadCurrent()).toBeUndefined()
    expect(await store.listFinished()).toEqual([])
    await store.loadProgression()
    expect(storage.writes).toBe(0)
    await store.saveCurrent(snapshot())
    await store.appendFinished(result())
    await store.appendFinished(result())
    expect(await store.listFinished()).toEqual([result()])
    expect(storage.writes - storage.leaseWrites).toBe(2)
    const writes = storage.writes
    await store.loadCurrent()
    await store.listFinished()
    await store.loadProgression()
    expect(storage.writes).toBe(writes)
  })

  it.each(['web-locks', 'fallback'] as const)('keeps both finished results when %s tabs append concurrently', async (mode) => {
    const storage = new MemoryStorage()
    const options = mode === 'web-locks' ? { locks: serialLocks(), transactions: null } : { locks: null }
    const first = new BrowserShiftStore(storage, options)
    const second = new BrowserShiftStore(storage, options)
    await Promise.all([first.appendFinished(result('first')), second.appendFinished(result('second'))])
    expect(await first.listFinished()).toEqual([result('first'), result('second')])
  })

  it.each(['web-locks', 'fallback'] as const)('atomically finalizes different old runs when a competing %s tab starts at the history write', async (mode) => {
    const firstRun = finalizedSnapshot('old-first')
    const secondRun = finalizedSnapshot('old-second')
    let second: BrowserShiftStore
    let competing: Promise<void> | undefined
    const startCompeting = () => {
      competing ??= second.finalizeReconciliation(secondRun.run.id, secondRun.run.result, secondRun.revision)
    }
    const storage = new MemoryStorage()
    storage.values.set(SHIFT_STORE_KEYS.reconciliation, JSON.stringify({ version: 1, kind: 'shift-reconciliation', value: [firstRun, secondRun] }))
    const options = { locks: mode === 'web-locks' ? serialLocks() : null }
    const first = new BrowserShiftStore(storage, options)
    second = new BrowserShiftStore(storage, options)
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      startCompeting()
      return put.call(this, value, key)
    })
    await first.finalizeReconciliation(firstRun.run.id, firstRun.run.result, firstRun.revision)
    expect(competing).toBeDefined()
    await competing
    await Promise.all([first.appendFinished(firstRun.run.result), second.appendFinished(secondRun.run.result)])
    const reopened = new BrowserShiftStore(storage, options)
    expect(await reopened.listFinished()).toEqual([firstRun.run.result, secondRun.run.result])
    expect(await reopened.listReconciliations()).toEqual([])
  })

  it('rolls back history and reconciliation together when finalization migration aborts', async () => {
    const storage = new MemoryStorage()
    const old = finalizedSnapshot()
    storage.setItem(SHIFT_STORE_KEYS.reconciliation, JSON.stringify({ version: 1, kind: 'shift-reconciliation', value: [old] }))
    storage.setItem(SHIFT_STORE_KEYS.history, JSON.stringify({ version: 1, kind: 'shift-history', value: [result('previous')] }))
    const original = new Map(storage.values)
    const store = new BrowserShiftStore(storage, { locks: null })
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      this.transaction.abort()
      this.transaction.db.close()
      return request
    })
    await expect(store.finalizeReconciliation(old.run.id, old.run.result, old.revision)).rejects.toThrow()
    const reopened = new BrowserShiftStore(storage, { locks: null })
    expect(await reopened.listFinished()).toEqual([result('previous')])
    expect(await reopened.listReconciliations()).toEqual([old])
    expect(storage.values).toEqual(original)
    await reopened.finalizeReconciliation(old.run.id, old.run.result, old.revision)
    expect(await reopened.listFinished()).toEqual([result('previous'), old.run.result])
    expect(await reopened.listReconciliations()).toEqual([])
  })

  it.each(['revision', 'missing', 'wrong-run', 'different-result', 'pending', 'open', 'conflicting-history', 'corrupt-history'] as const)(
    'rejects %s finalization without changing the queue or history', async (invalid) => {
      const storage = new MemoryStorage()
      const old = invalid === 'pending' ? closedSnapshot() : invalid === 'open' ? snapshot() : finalizedSnapshot()
      const store = new BrowserShiftStore(storage, { locks: null })
      await store.saveReconciliation(old)
      if (invalid === 'conflicting-history') await store.appendFinished({ ...result(), averageScore: 99 })
      if (invalid === 'corrupt-history') {
        await new IndexedDbShiftCoordinator().run(storage, 'readwrite', false, canonical => canonical.setItem(SHIFT_STORE_KEYS.history, '{damaged'))
      }
      const history = await store.listFinished()
      const put = vi.spyOn(IDBObjectStore.prototype, 'put')
      const candidate = invalid === 'wrong-run' ? result('other-run') : invalid === 'different-result' ? { ...result(), averageScore: 99 } : result()
      await expect(store.finalizeReconciliation(invalid === 'missing' ? 'missing' : old.run.id, candidate, invalid === 'revision' ? old.revision - 1 : old.revision)).rejects.toThrow()
      expect(put).not.toHaveBeenCalled()
      expect(await store.listFinished()).toEqual(history)
      expect(await store.listReconciliations()).toEqual([old])
    },
  )

  it.each(['legacy', 'v1-record'] as const)('preserves %s history on migration, reopen and switching coordination modes', async (source) => {
    const storage = new MemoryStorage()
    const original = result('previous')
    const old = finalizedSnapshot()
    storage.setItem(SHIFT_STORE_KEYS.history, JSON.stringify({ version: 1, kind: 'shift-history', value: [original] }))
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: snapshot() }))
    const queued = JSON.stringify({ version: 1, kind: 'shift-reconciliation', value: [old] })
    if (source === 'v1-record') await seedV1TransactionRecord(null, queued)
    else storage.setItem(SHIFT_STORE_KEYS.reconciliation, queued)
    const store = new BrowserShiftStore(storage, { locks: null })
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    expect(await store.listFinished()).toEqual([original])
    expect(put).not.toHaveBeenCalled()
    await store.finalizeReconciliation(old.run.id, old.run.result, old.revision)
    storage.setItem(SHIFT_STORE_KEYS.history, JSON.stringify({ version: 1, kind: 'shift-history', value: [result('stale-legacy')] }))
    storage.setItem(SHIFT_STORE_KEYS.reconciliation, queued)
    const reopened = new BrowserShiftStore(storage, { locks: serialLocks() })
    expect(await reopened.listFinished()).toEqual([original, old.run.result])
    expect(await reopened.listReconciliations()).toEqual([])
    if (source === 'v1-record') expect(await reopened.loadCurrent()).toBeUndefined()
    await Promise.all([reopened.appendFinished(result('after-reopen')), store.appendFinished(result('fallback-tab'))])
    expect((await store.listFinished()).map(entry => entry.shiftRunId).sort()).toEqual(['previous', 'run-1', 'after-reopen', 'fallback-tab'].sort())
    expect(await reopened.listFinished()).toEqual(await store.listFinished())
  })

  it('keeps a migrated missing history authoritative after stale legacy writes', async () => {
    const storage = new MemoryStorage()
    await seedV1TransactionRecord(null, null)
    const store = new BrowserShiftStore(storage, { locks: null })
    await store.clearCurrent()
    storage.setItem(SHIFT_STORE_KEYS.history, JSON.stringify({ version: 1, kind: 'shift-history', value: [result('stale-legacy')] }))
    expect(await new BrowserShiftStore(storage, { locks: serialLocks() }).listFinished()).toEqual([])
  })

  it.each(['web-locks', 'fallback'] as const)('preserves both settlements when another %s tab starts at the history write', async (mode) => {
    let second: BrowserShiftStore
    let competing: Promise<ShiftProgression> | undefined
    const startCompeting = () => { competing ??= second.recordSettlement(result('second'), addSettlement) }
    const storage = new MemoryStorage()
    const options = { locks: mode === 'web-locks' ? serialLocks() : null }
    const first = new BrowserShiftStore(storage, options)
    second = new BrowserShiftStore(storage, options)
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      startCompeting()
      return put.call(this, value, key)
    })
    await first.recordSettlement(result('first'), addSettlement)
    expect(competing).toBeDefined()
    await competing
    const repeated = await Promise.all([first.recordSettlement(result('first'), addSettlement), second.recordSettlement(result('second'), addSettlement)])
    const reopened = new BrowserShiftStore(storage, options)
    const progression = await reopened.loadProgression()
    expect(progression.results).toEqual([result('first'), result('second')])
    expect(progression.cumulativeSatisfied).toBe(6)
    expect(repeated).toEqual([progression, progression])
    expect(await reopened.listFinished()).toEqual(progression.results)
  })

  it.each(['legacy', 'canonical'] as const)('rolls back settlement history and progression together when a %s transaction aborts', async (source) => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage, { locks: null })
    const previous = addSettlement(await store.loadProgression(), result('previous'))
    if (source === 'canonical') {
      await store.saveProgression(previous)
      await store.appendFinished(result('previous'))
    } else {
      storage.setItem(SHIFT_STORE_KEYS.progression, JSON.stringify({ version: 1, kind: 'shift-progression', value: previous }))
      storage.setItem(SHIFT_STORE_KEYS.history, JSON.stringify({ version: 1, kind: 'shift-history', value: previous.results }))
    }
    const original = new Map(storage.values)
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      this.transaction.abort()
      this.transaction.db.close()
      return request
    })
    await expect(store.recordSettlement(result('new'), addSettlement)).rejects.toThrow()
    const reopened = new BrowserShiftStore(storage, { locks: serialLocks() })
    expect(await reopened.loadProgression()).toEqual(previous)
    expect(await reopened.listFinished()).toEqual(previous.results)
    expect(storage.values).toEqual(original)
  })

  it('rolls back Web Locks settlement and migration when the canonical commit aborts', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const previous = addSettlement(await store.loadProgression(), result('previous'))
    const current = snapshot(), queued = finalizedSnapshot('old-run')
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: current }))
    storage.setItem(SHIFT_STORE_KEYS.reconciliation, JSON.stringify({ version: 1, kind: 'shift-reconciliation', value: [queued] }))
    storage.setItem(SHIFT_STORE_KEYS.history, JSON.stringify({ version: 1, kind: 'shift-history', value: previous.results }))
    storage.setItem(SHIFT_STORE_KEYS.progression, JSON.stringify({ version: 1, kind: 'shift-progression', value: previous }))
    const original = new Map(storage.values)
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      this.transaction.abort()
      this.transaction.db.close()
      return request
    })
    await expect(store.recordSettlement(result('new'), addSettlement)).rejects.toThrow()
    const reopened = new BrowserShiftStore(storage)
    expect(await reopened.loadCurrent()).toEqual(current)
    expect(await reopened.listReconciliations()).toEqual([queued])
    expect(await reopened.listFinished()).toEqual(previous.results)
    expect(await reopened.loadProgression()).toEqual(previous)
    expect(storage.values).toEqual(original)
  })

  it.each(['legacy', 'v1-record'] as const)('migrates all four %s envelopes on Web Locks settlement without split legacy writes', async (source) => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const previous = addSettlement(await store.loadProgression(), result('previous'))
    const current = snapshot(), queued = finalizedSnapshot('old-run')
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: current }))
    storage.setItem(SHIFT_STORE_KEYS.reconciliation, JSON.stringify({ version: 1, kind: 'shift-reconciliation', value: [queued] }))
    storage.setItem(SHIFT_STORE_KEYS.history, JSON.stringify({ version: 1, kind: 'shift-history', value: previous.results }))
    storage.setItem(SHIFT_STORE_KEYS.progression, JSON.stringify({ version: 1, kind: 'shift-progression', value: previous }))
    if (source === 'v1-record') await seedV1TransactionRecord(null, null)
    const original = new Map(storage.values)
    const updated = await store.recordSettlement(result('new'), addSettlement)
    expect(storage.values).toEqual(original)
    for (const key of [SHIFT_STORE_KEYS.current, SHIFT_STORE_KEYS.reconciliation, SHIFT_STORE_KEYS.history, SHIFT_STORE_KEYS.progression]) {
      storage.setItem(key, '{stale legacy data')
    }
    const reopened = new BrowserShiftStore(storage, { locks: null })
    expect(await reopened.loadCurrent()).toEqual(source === 'legacy' ? current : undefined)
    expect(await reopened.listReconciliations()).toEqual(source === 'legacy' ? [queued] : [])
    expect(await reopened.listFinished()).toEqual(updated.results)
    expect(await reopened.loadProgression()).toEqual(updated)
  })

  it.each(['settlement', 'finalization'] as const)('rejects %s without any writes when Web Locks has no transaction coordinator', async (operation) => {
    const storage = new MemoryStorage()
    const queued = finalizedSnapshot('old-run')
    storage.setItem(SHIFT_STORE_KEYS.reconciliation, JSON.stringify({ version: 1, kind: 'shift-reconciliation', value: [queued] }))
    const original = new Map(storage.values)
    const writes = storage.writes
    const store = new BrowserShiftStore(storage, { locks: serialLocks(), transactions: null })
    await expect(operation === 'settlement'
      ? store.recordSettlement(result('new'), addSettlement)
      : store.finalizeReconciliation(queued.run.id, queued.run.result, queued.revision)).rejects.toThrow(/transaction/i)
    expect(storage.values).toEqual(original)
    expect(storage.writes).toBe(writes)
  })

  it.each(['legacy', 'v1-record'] as const)('migrates %s progression with history and preserves authority across coordination modes', async (source) => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage, { locks: null })
    const previous = addSettlement(await store.loadProgression(), result('previous'))
    storage.setItem(SHIFT_STORE_KEYS.progression, JSON.stringify({ version: 1, kind: 'shift-progression', value: previous }))
    storage.setItem(SHIFT_STORE_KEYS.history, JSON.stringify({ version: 1, kind: 'shift-history', value: previous.results }))
    if (source === 'v1-record') await seedV1TransactionRecord(null, null)
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    expect(await store.loadProgression()).toEqual(previous)
    expect(put).not.toHaveBeenCalled()
    const updated = await store.recordSettlement(result('new'), addSettlement)
    storage.setItem(SHIFT_STORE_KEYS.progression, '{stale progression')
    storage.setItem(SHIFT_STORE_KEYS.history, '{stale history')
    const reopened = new BrowserShiftStore(storage, { locks: serialLocks() })
    expect(await reopened.loadProgression()).toEqual(updated)
    expect(await reopened.listFinished()).toEqual(updated.results)
    await reopened.saveProgression({ ...updated, highestDailyScore: 99 })
    expect((await store.loadProgression()).highestDailyScore).toBe(99)
  })

  it.each(['web-locks', 'fallback'] as const)('applies %s progression reducers to the latest canonical value', async (mode) => {
    const storage = new MemoryStorage()
    const options = mode === 'web-locks' ? { locks: serialLocks(), transactions: null } : { locks: null }
    const first = new BrowserShiftStore(storage, options)
    const second = new BrowserShiftStore(storage, options)
    const increment = (progression: ShiftProgression) => ({ ...progression, highestSurvivalDay: progression.highestSurvivalDay + 1 })
    const updates = await Promise.all([first.updateProgression(increment), second.updateProgression(increment)])
    expect(updates.map(progression => progression.highestSurvivalDay)).toEqual([1, 2])
    expect((await new BrowserShiftStore(storage, options).loadProgression()).highestSurvivalDay).toBe(2)
  })

  it('preserves missing progression after migration and rejects invalid or conflicting settlement reducers without writes', async () => {
    const storage = new MemoryStorage()
    await seedV1TransactionRecord(null, null)
    const store = new BrowserShiftStore(storage, { locks: null })
    const initial = await store.loadProgression()
    await store.clearCurrent()
    storage.setItem(SHIFT_STORE_KEYS.progression, JSON.stringify({ version: 1, kind: 'shift-progression', value: { ...initial, highestDailyScore: 99 } }))
    expect(await store.loadProgression()).toEqual(initial)
    await expect(store.updateProgression(progression => ({ ...progression, survivalUnlocked: 'invalid' } as unknown as ShiftProgression))).rejects.toThrow()
    await expect(store.recordSettlement(result(), progression => progression)).rejects.toThrow()
    expect(await store.loadProgression()).toEqual(initial)
    expect(await store.listFinished()).toEqual([])
    const settled = await store.recordSettlement(result(), addSettlement)
    await expect(store.recordSettlement({ ...result(), averageScore: 99 }, addSettlement)).rejects.toThrow()
    expect(await store.loadProgression()).toEqual(settled)
    expect(await store.listFinished()).toEqual([result()])
  })

  it('rejects stale and differing equal revisions without losing persisted calibration or materials', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const current = snapshot()
    await store.saveCurrent(current)
    const stale = snapshot({ id: 'intent-1', shiftRunId: 'run-1', orderId: 'order-1', snapshotId: 'snapshot-1',
      confirmedAtMs: 1_000, nextAttempt: 1, machineId: 'quick', status: 'confirmed' })
    const writes = storage.writes - storage.leaseWrites
    await expect(store.saveCurrent({ ...stale, revision: current.revision - 1 })).rejects.toThrow(/revision|conflict/i)
    await expect(store.saveCurrent(stale)).rejects.toThrow(/revision|conflict/i)
    expect(await store.loadCurrent()).toEqual(current)
    expect(storage.writes - storage.leaseWrites).toBe(writes)
  })

  it('treats identical revisions as idempotent and supports an expected-revision precondition', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const current = snapshot()
    await store.saveCurrent(current)
    const writes = storage.writes - storage.leaseWrites
    expect(await store.saveCurrent(structuredClone(current))).toEqual(current)
    expect(storage.writes - storage.leaseWrites).toBe(writes)
    const next = { ...current, revision: current.revision + 1, savedAtMs: current.savedAtMs + 1 }
    await expect(store.saveCurrent(next, current.revision - 1)).rejects.toThrow(/revision|conflict/i)
    expect(await store.loadCurrent()).toEqual(current)
    expect(await store.saveCurrent(next, current.revision)).toEqual(next)
  })

  it.each(['web-locks', 'fallback'] as const)('allows only one branch from revision 7 to commit revision 8 under %s', async (mode) => {
    const initial = snapshot()
    const firstBranch = { ...initial, revision: 8, savedAtMs: 2_001 }
    const secondBranch = { ...initial, revision: 8, savedAtMs: 2_002 }
    const storage = new MemoryStorage()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: initial }))
    const locks = mode === 'web-locks' ? serialLocks() : null
    const first = new BrowserShiftStore(storage, { locks, ownerId: 'first-tab' })
    const second = new BrowserShiftStore(storage, { locks, ownerId: 'second-tab' })
    const results = await Promise.allSettled([first.saveCurrent(firstBranch, 7), second.saveCurrent(secondBranch, 7)])
    const winners = results.filter((entry) => entry.status === 'fulfilled')
    expect(winners).toHaveLength(1)
    const loser = results.find((entry) => entry.status === 'rejected')!
    expect(loser.status).toBe('rejected')
    if (loser.status === 'rejected') expect(loser.reason).toBeInstanceOf(ShiftStoreConflictError)
    expect(await first.loadCurrent()).toEqual(winners[0].value)
    expect(await second.loadCurrent()).toEqual(winners[0].value)
  })

  it('holds the injected lock through preserving reconciliation and replacing or clearing current state', async () => {
    let held = false
    const names: string[] = []
    class LockObservedStorage extends MemoryStorage {
      override setItem(key: string, value: string) {
        if (key === SHIFT_STORE_KEYS.current || key === SHIFT_STORE_KEYS.reconciliation) expect(held).toBe(true)
        super.setItem(key, value)
      }
      override removeItem(key: string) {
        if (key === SHIFT_STORE_KEYS.current) expect(held).toBe(true)
        super.removeItem(key)
      }
    }
    const locks = { async request<T>(name: string, action: () => T | Promise<T>): Promise<T> {
      names.push(name); held = true
      try { return await action() } finally { held = false }
    } }
    const store = new BrowserShiftStore(new LockObservedStorage(), { locks })
    await store.saveCurrent(closedSnapshot())
    await store.saveCurrent(nextSnapshot())
    await store.clearCurrent()
    expect(names).toEqual([SHIFT_STORE_KEYS.current, SHIFT_STORE_KEYS.current, SHIFT_STORE_KEYS.current])
    expect(await store.listReconciliations()).toEqual([closedSnapshot()])
  })

  it('migrates an abandoned lease without letting its old record block transactional saves', async () => {
    const storage = new MemoryStorage()
    const initial = snapshot()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: initial }))
    const leaseKey = 'rabbit-house:v1:shift-mutations:lease'
    const lease = JSON.stringify({ version: 1, kind: 'shift-lease', owner: 'paused-tab', expiresAtMs: 1 })
    storage.setItem(leaseKey, lease)
    const store = new BrowserShiftStore(storage, { locks: null, ownerId: 'other-tab', leaseNow: () => 2, leaseWait: async () => undefined, maxAttempts: 2 })
    const next = { ...initial, revision: 8 }
    expect(await store.saveCurrent(next, 7)).toEqual(next)
    expect(await new BrowserShiftStore(storage, { locks: null }).loadCurrent()).toEqual(next)
    expect(storage.getItem(leaseKey)).toBe(lease)
    await store.clearCurrent()
    expect(await new BrowserShiftStore(storage, { locks: null }).loadCurrent()).toBeUndefined()
  })

  it('fails closed without Web Locks or a transactional fallback', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage, { locks: null, transactions: null })
    await expect(store.saveCurrent(snapshot())).rejects.toThrow(/transaction|indexeddb|unavailable/i)
    expect(storage.writes).toBe(0)
  })

  it('keeps the accepted branch after a competing fallback transaction aborts at commit', async () => {
    const storage = new MemoryStorage()
    const first = new BrowserShiftStore(storage, { locks: null })
    await first.saveCurrent(snapshot())
    const second = new BrowserShiftStore(storage, { locks: null })
    const firstBranch = { ...snapshot(), revision: 8, savedAtMs: 2_001 }
    const secondBranch = { ...snapshot(), revision: 8, savedAtMs: 2_002 }
    const put = IDBObjectStore.prototype.put
    let abortNextWrite = true
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      if (abortNextWrite) {
        abortNextWrite = false
        // A crashed context loses its active transaction and database connection.
        this.transaction.abort()
        this.transaction.db.close()
      }
      return request
    })
    const outcomes = await Promise.allSettled([first.saveCurrent(firstBranch, 7), second.saveCurrent(secondBranch, 7)])
    expect(outcomes[0].status).toBe('rejected')
    expect(outcomes[1]).toEqual({ status: 'fulfilled', value: secondBranch })
    expect(await new BrowserShiftStore(storage, { locks: null }).loadCurrent()).toEqual(secondBranch)
    expect(storage.writes).toBe(0)
  })

  it.each(['web-locks', 'fallback'] as const)('holds exclusion when a competing %s save starts at the final write', async (mode) => {
    const initial = snapshot()
    const firstBranch = { ...initial, revision: 8, savedAtMs: 2_001 }
    const secondBranch = { ...initial, revision: 8, savedAtMs: 2_002 }
    let second: BrowserShiftStore
    let competing: Promise<PromiseSettledResult<ShiftSnapshot>> | undefined
    const startCompeting = () => {
      competing ??= second.saveCurrent(secondBranch, 7).then(
        (value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }),
      )
    }
    class FinalWriteStorage extends MemoryStorage {
      override setItem(key: string, value: string) {
        if (key === SHIFT_STORE_KEYS.current) startCompeting()
        super.setItem(key, value)
      }
    }
    const storage = new FinalWriteStorage()
    storage.values.set(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: initial }))
    const locks = mode === 'web-locks' ? serialLocks() : null
    const first = new BrowserShiftStore(storage, { locks })
    second = new BrowserShiftStore(storage, { locks })
    if (mode === 'fallback') {
      const put = IDBObjectStore.prototype.put
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
        startCompeting()
        return put.call(this, value, key)
      })
    }
    expect(await first.saveCurrent(firstBranch, 7)).toEqual(firstBranch)
    expect(competing).toBeDefined()
    const loser = await competing!
    expect(loser.status).toBe('rejected')
    if (loser.status === 'rejected') expect(loser.reason).toBeInstanceOf(ShiftStoreConflictError)
    expect(await new BrowserShiftStore(storage, { locks }).loadCurrent()).toEqual(firstBranch)
  })

  it.each(['replace', 'clear'] as const)('rolls back migration and reconciliation together if %s crashes before commit', async (action) => {
    const storage = new MemoryStorage()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: closedSnapshot() }))
    const original = new Map(storage.values)
    const store = new BrowserShiftStore(storage, { locks: null })
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      this.transaction.abort()
      this.transaction.db.close()
      return request
    })
    await expect(action === 'replace' ? store.saveCurrent(nextSnapshot()) : store.clearCurrent()).rejects.toThrow()
    const reopened = new BrowserShiftStore(storage, { locks: null })
    expect(await reopened.loadCurrent()).toEqual(closedSnapshot())
    expect(await reopened.listReconciliations()).toEqual([])
    expect(storage.values).toEqual(original)
    if (action === 'replace') await reopened.saveCurrent(nextSnapshot())
    else await reopened.clearCurrent()
    expect(await reopened.loadCurrent()).toEqual(action === 'replace' ? nextSnapshot() : undefined)
    expect(await reopened.listReconciliations()).toEqual([closedSnapshot()])
  })

  it('migrates both envelopes once and ignores stale legacy writes after migration', async () => {
    const storage = new MemoryStorage()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: closedSnapshot() }))
    const writes = storage.writes
    const store = new BrowserShiftStore(storage, { locks: null })
    expect(await store.loadCurrent()).toEqual(closedSnapshot())
    expect(storage.writes).toBe(writes)
    await store.saveCurrent(nextSnapshot())
    expect(storage.writes).toBe(writes)
    storage.setItem(SHIFT_STORE_KEYS.current, '{obsolete legacy write')
    const reopened = new BrowserShiftStore(storage, { locks: null })
    expect(await reopened.loadCurrent()).toEqual(nextSnapshot())
    expect(await reopened.listReconciliations()).toEqual([closedSnapshot()])
    await reopened.clearCurrent()
    expect(await new BrowserShiftStore(storage, { locks: null }).loadCurrent()).toBeUndefined()
  })

  it('keeps the migrated data source when Web Locks becomes available on reopen', async () => {
    const storage = new MemoryStorage()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: snapshot() }))
    const fallback = new BrowserShiftStore(storage, { locks: null })
    const updated = { ...snapshot(), revision: 8 }
    await fallback.saveCurrent(updated, 7)
    const reopened = new BrowserShiftStore(storage, { locks: serialLocks() })
    expect(await reopened.loadCurrent()).toEqual(updated)
    const next = { ...updated, revision: 9 }
    await reopened.saveCurrent(next, 8)
    expect(await fallback.loadCurrent()).toEqual(next)
    await reopened.clearCurrent()
    expect(await fallback.loadCurrent()).toBeUndefined()
    expect(await fallback.listReconciliations()).toEqual([next])
  })

  it('isolates a damaged current shift from cards, prints, history and progression', async () => {
    const storage = new MemoryStorage()
    const cardLibrary = new BrowserCardLibrary(storage)
    const card = await cardLibrary.save({ version: 1, paperId: 'cream', layers: [] })
    const prints = new BrowserPrintShop(storage)
    const job = await prints.startWorkshop('workshop', card.cardId)
    const store = new BrowserShiftStore(storage)
    await store.appendFinished(result())
    const progress: ShiftProgression = { ...await store.loadProgression(), completedAuthoredStages: ['tutorial'], highestDailyScore: 81 }
    await store.saveProgression(progress)
    storage.setItem(SHIFT_STORE_KEYS.current, '{damaged')
    const before = new Map(storage.values)
    const writes = storage.writes
    expect(await store.loadCurrent()).toBeUndefined()
    expect(storage.writes).toBe(writes)
    expect(storage.values).toEqual(before)
    await store.clearCurrent()
    expect(await store.loadCurrent()).toBeUndefined()
    expect(await cardLibrary.get(card.cardId)).toEqual(card)
    expect(await prints.get(job.printJobId)).toEqual(job)
    expect(await store.listFinished()).toEqual([result()])
    expect(await store.loadProgression()).toEqual(progress)
  })

  it.each([
    { version: 2, kind: 'shift-current', value: snapshot() },
    { version: 1, kind: 'shift-progression', value: snapshot() },
    { version: 1, kind: 'shift-current', value: {} },
    { version: 1, kind: 'shift-current', value: { ...snapshot(), run: { id: 'run-1' } } },
    { version: 1, kind: 'shift-current', value: { ...snapshot(), run: { ...snapshot().run, printers: null } } },
  ])('rejects unsupported or malformed current envelopes without writing: %j', async (value) => {
    const storage = new MemoryStorage()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify(value))
    const writes = storage.writes
    expect(await new BrowserShiftStore(storage).loadCurrent()).toBeUndefined()
    expect(storage.writes).toBe(writes)
  })

  it('defaults new progression independently of old story completion', async () => {
    const storage = new MemoryStorage()
    await new BrowserSessionStore('story', storage).save({ completedCommissionIds: ['chino', 'rize', 'chiya-sharo'], freeModeUnlocked: true })
    const writes = storage.writes
    const store = new BrowserShiftStore(storage)
    expect(await store.loadProgression()).toEqual({
      version: 1, completedAuthoredStages: [], survivalUnlocked: false, survivalRun: null,
      highestSurvivalDay: 0, cumulativeSatisfied: 0, highestDailyScore: 0, longestQualityStreak: 0,
      unlockedCosmeticIds: [], results: [],
    })
    expect(storage.writes).toBe(writes)
    expect(storage.getItem(BROWSER_STORE_KEYS.session('story'))).not.toBeNull()
  })

  it('validates history and progression shape independently', async () => {
    const storage = new MemoryStorage()
    storage.setItem(SHIFT_STORE_KEYS.history, JSON.stringify({ version: 1, kind: 'shift-history', value: [{ shiftRunId: 'only-id' }] }))
    storage.setItem(SHIFT_STORE_KEYS.progression, JSON.stringify({ version: 1, kind: 'shift-progression', value: { version: 1, completedAuthoredStages: ['story'], survivalUnlocked: true } }))
    const store = new BrowserShiftStore(storage)
    const writes = storage.writes
    expect(await store.listFinished()).toEqual([])
    expect((await store.loadProgression()).survivalUnlocked).toBe(false)
    expect(storage.writes).toBe(writes)
  })
})

describe('calibrated print recovery', () => {
  function mathSnapshot(definition: MathQuestion): ShiftSnapshot {
    const saved = snapshot()
    const puzzle = saved.run.puzzles['puzzle-1']
    return { ...saved, run: { ...saved.run,
      authorizations: { 'intent-1': { ...pending(), machineId: 'fine' } },
      puzzles: { 'puzzle-1': { ...puzzle, machineId: 'fine', deadlineAtMs: puzzle.startedAtMs + definition.timeLimitSeconds * 1000, definition,
        result: { status: 'succeeded', submittedAtMs: 2000, answer: definition.kind === 'math-choice'
          ? { kind: 'math-choice', optionIds: [definition.options[0].id] } : { kind: 'math-fill', text: '1' } },
      } },
      printers: {
        quick: { ...saved.run.printers.quick, reservations: [] },
        fine: { ...saved.run.printers.fine, reservations: saved.run.printers.quick.reservations.map(reservation => ({ ...reservation, machineId: 'fine' })) },
      },
    } }
  }

  const localMedia = {
    images: [{ src: '/assets/math/questions/single_14.png', alt: '风速向量示意图' }],
    table: { headers: ['级别', '风速'], rows: [['2', '1.6～3.3']] },
  }
  // Persisted puzzles hold only the public projection; answers stay on the server.
  const restoredMath = (kind: MathQuestion['kind']): MathQuestion => {
    const question = MATH_QUESTION_BANK.find(entry => entry.kind === kind)!
    return question.kind === 'math-choice'
      ? { kind: question.kind, id: question.id, prompt: question.prompt, timeLimitSeconds: question.timeLimitSeconds,
        options: question.options, multiple: question.multiple ?? question.correctOptionIds.length > 1, ...localMedia }
      : { kind: question.kind, id: question.id, prompt: question.prompt, timeLimitSeconds: question.timeLimitSeconds, ...localMedia }
  }

  it.each(['math-choice', 'math-fill'] as const)('restores a valid %s question with its registered local image and complete table', async kind => {
    const storage = new MemoryStorage()
    const saved = mathSnapshot(restoredMath(kind))
    const store = new BrowserShiftStore(storage, { locks: null })
    await store.saveCurrent(saved)
    expect(await new BrowserShiftStore(storage, { locks: serialLocks() }).loadCurrent()).toEqual(saved)
  })

  it.each((['math-choice', 'math-fill'] as const).flatMap(kind => [
    ['external image', { images: [{ src: 'https://example.com/track.png', alt: '图' }] }],
    ['unregistered local image', { images: [{ src: '/assets/math/questions/unknown.png', alt: '图' }] }],
    ['empty image alt', { images: [{ src: '/assets/math/questions/single_14.png', alt: '　' }] }],
    ['missing table object', { table: null }],
    ['incomplete table row', { table: { headers: ['甲', '乙'], rows: [['甲']] } }],
    ['non-string table cell', { table: { headers: ['甲'], rows: [[null]] } }],
  ].map(([label, patch]) => ({ kind, label, patch }))))('rejects persisted $kind $label before exposing the restored puzzle', async ({ kind, patch }) => {
    const storage = new MemoryStorage()
    const definition = { ...restoredMath(kind), ...patch as object } as unknown as MathQuestion
    const saved = mathSnapshot(definition)
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: saved }))
    const writes = storage.writes
    const store = new BrowserShiftStore(storage)
    expect((await store.inspectCurrent()).status).toBe('corrupt')
    expect(await store.loadCurrent()).toBeUndefined()
    expect(storage.writes).toBe(writes)
    await expect(store.saveCurrent(saved)).rejects.toThrow(/invalid/i)
  })

  it('rejects corrupted math media in the canonical transaction store as well as legacy storage', async () => {
    const storage = new MemoryStorage()
    const saved = mathSnapshot({ ...restoredMath('math-choice'), images: [{ src: '//example.com/track.png', alt: '图' }] })
    await seedV1TransactionRecord(JSON.stringify({ version: 1, kind: 'shift-current', value: saved }), null)
    expect((await new BrowserShiftStore(storage, { locks: null }).inspectCurrent()).status).toBe('corrupt')
  })

  it.each([
    undefined, null, {}, { color: '', shape: 'circle', direction: 'upright' },
    { color: 'red', shape: 'circle', direction: 'sideways' }, { color: 'blue', shape: 'circle', direction: 'upright' },
  ])('rejects an identify puzzle with missing or malformed target: %j', async (target) => {
    const broken = structuredClone(snapshot())
    const puzzle = broken.run.puzzles['puzzle-1'] as any
    puzzle.definition = { kind: 'identify', prompt: '找出：red、circle、正向', target, options: [
      { id: 'a', color: 'red', shape: 'circle', direction: 'upright' },
      { id: 'b', color: 'blue', shape: 'circle', direction: 'upright' },
    ] }
    puzzle.result.answer = { kind: 'identify', optionId: 'a' }
    const storage = new MemoryStorage()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: broken }))
    const gateway = new BrowserPrintShop(storage)
    gateway.findByIntent = async () => { throw new Error('must reject before service call') }
    expect(await new BrowserShiftStore(storage).loadCurrent()).toBeUndefined()
    await expect(recoverPendingShiftPrint(broken, gateway, 'intent-1')).rejects.toThrow(/snapshot|context/i)
  })
  it('recovers an interruption before start from the persisted calibration without releasing its reservation', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const gateway = new BrowserPrintShop(storage)
    expect(await store.recoverPendingPrint('intent-1', gateway)).toBeUndefined()
    expect(await gateway.list()).toEqual([])
    await store.saveCurrent(snapshot())
    const writesBefore = storage.writes - storage.leaseWrites
    const calls: string[] = []
    const originalFind = gateway.findByIntent.bind(gateway)
    const originalStart = gateway.startShift.bind(gateway)
    gateway.findByIntent = async (intentId) => { calls.push(`find:${intentId}`); return originalFind(intentId) }
    gateway.startShift = async (...args) => {
      calls.push(`start:${args.join(':')}`)
      expect((await store.loadCurrent())?.run.authorizations['intent-1'].status).toBe('calibrated_pending_start')
      return originalStart(...args)
    }
    const receipt = await store.recoverPendingPrint('intent-1', gateway)
    expect(calls).toEqual(['find:intent-1', 'start:intent-1:snapshot-1:quick:run-1'])
    expect(receipt).toMatchObject({ status: 'accepted', intentId: 'intent-1', shiftRunId: 'run-1' })
    expect((await store.loadCurrent())?.run.printers.quick.reservations).toHaveLength(1)
    expect(storage.writes - storage.leaseWrites).toBe(writesBefore + 1)
  })

  it('finds the accepted service task when its return value was locally lost', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    await store.saveCurrent(snapshot())
    const gateway = new BrowserPrintShop(storage)
    const accepted = await gateway.startShift('intent-1', 'snapshot-1', 'quick', 'run-1')
    const reopened = new BrowserPrintShop(storage)
    reopened.startShift = async () => { throw new Error('must query the existing receipt first') }
    const writes = storage.writes
    const receipt = await store.recoverPendingPrint('intent-1', reopened)
    expect(receipt).toMatchObject({ taskId: accepted.printJobId, receiptId: accepted.receiptId })
    expect(storage.writes).toBe(writes)
    expect(await reopened.list()).toHaveLength(1)
  })

  it('retries the exact intent after an unaccepted timeout, including duplicate recovery clicks', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    await store.saveCurrent(snapshot())
    const gateway = new BrowserPrintShop(storage)
    const originalStart = gateway.startShift.bind(gateway)
    let fail = true
    gateway.startShift = async (...args) => {
      if (fail) { fail = false; throw new Error('timeout') }
      return originalStart(...args)
    }
    await expect(store.recoverPendingPrint('intent-1', gateway)).rejects.toThrow('timeout')
    expect(await gateway.list()).toEqual([])
    const [first, retry] = await Promise.all([
      store.recoverPendingPrint('intent-1', gateway), store.recoverPendingPrint('intent-1', gateway),
    ])
    expect(retry).toEqual(first)
    expect(await gateway.list()).toHaveLength(1)
    expect(await store.loadCurrent()).toEqual(snapshot())
  })

  it('reconciles a closed old shift against its original run while a new shift is current', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const closed = closedSnapshot()
    await store.saveCurrent(closed)
    const old = (await store.loadCurrent())!
    const next = nextSnapshot()
    await store.saveCurrent(next)
    const gateway = new BrowserPrintShop(storage)
    const receipt = await recoverPendingShiftPrint(old, gateway, 'intent-1')
    const retry = await recoverPendingShiftPrint(old, gateway, 'intent-1')
    expect(receipt).toMatchObject({ shiftRunId: 'run-1', machineId: 'quick' })
    expect(retry).toEqual(receipt)
    expect(await gateway.list()).toHaveLength(1)
    expect(await store.loadCurrent()).toEqual(next)
    expect(old.run.printers.quick.reservations).toHaveLength(1)
  })

  it('durably recovers an old closed intent after a new current shift and a new store instance', async () => {
    const storage = new MemoryStorage()
    await new BrowserShiftStore(storage).saveCurrent(closedSnapshot())
    await new BrowserShiftStore(storage).saveCurrent(nextSnapshot())
    const reopened = new BrowserShiftStore(storage)
    const gateway = new BrowserPrintShop(storage)
    const calls: string[] = []
    const find = gateway.findByIntent.bind(gateway)
    const start = gateway.startShift.bind(gateway)
    gateway.findByIntent = async (intentId) => { calls.push(`find:${intentId}`); return find(intentId) }
    gateway.startShift = async (...args) => { calls.push(`start:${args.join(':')}`); return start(...args) }
    const receipt = await reopened.recoverPendingPrint('intent-1', gateway, 'run-1')
    expect(receipt).toMatchObject({ status: 'accepted', intentId: 'intent-1', shiftRunId: 'run-1', machineId: 'quick' })
    expect(calls).toEqual(['find:intent-1', 'start:intent-1:snapshot-1:quick:run-1'])
    expect(await reopened.loadCurrent()).toEqual(nextSnapshot())
    expect(await reopened.listReconciliations()).toEqual([closedSnapshot()])
    calls.length = 0
    expect(await new BrowserShiftStore(storage).recoverPendingPrint('intent-1', gateway, 'run-1')).toEqual(receipt)
    expect(calls).toEqual(['find:intent-1'])
    expect(await gateway.list()).toHaveLength(1)
  })

  it('keeps the reconciliation queue until receipt binding is persisted, then allows explicit removal', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserShiftStore(storage)
    const closed = closedSnapshot()
    await store.saveReconciliation(closed)
    ;(closed.run.pendingReconciliationIntentIds as string[]).length = 0
    const listed = await store.listReconciliations()
    ;(listed[0].run.pendingReconciliationIntentIds as string[]).length = 0
    const writes = storage.writes
    expect(await store.listReconciliations()).toEqual([closedSnapshot()])
    expect(storage.writes).toBe(writes)
    await expect(store.removeReconciliation('run-1')).rejects.toThrow(/pending|receipt/i)
    const receipt = (await store.recoverPendingPrint('intent-1', new BrowserPrintShop(storage), 'run-1'))!
    await expect(store.removeReconciliation('run-1')).rejects.toThrow(/pending|receipt/i)
    const original = closedSnapshot()
    const handled: ShiftSnapshot = { ...original, revision: original.revision + 1, run: {
      ...original.run, pendingReconciliationIntentIds: [],
      authorizations: { 'intent-1': { ...pending(), status: 'bound', taskId: receipt.taskId, receipt } },
      tasks: { [receipt.taskId]: { id: receipt.taskId, intentId: 'intent-1', snapshotId: 'snapshot-1', orderId: 'order-1',
        shiftRunId: 'run-1', machineId: 'quick', createdAtMs: receipt.receivedAtMs, durationMs: 10_000,
        expedited: false, status: 'unclaimed', readyAtMs: receipt.receivedAtMs, unclaimedAtMs: receipt.receivedAtMs } },
      printers: { ...original.run.printers, quick: { ...original.run.printers.quick, reservations: [] } },
    } }
    await store.saveReconciliation(handled)
    expect(JSON.parse(storage.getItem(SHIFT_STORE_KEYS.reconciliation)!)).toMatchObject({ version: 1, kind: 'shift-reconciliation' })
    await store.removeReconciliation('run-1')
    expect(await new BrowserShiftStore(storage).listReconciliations()).toEqual([])
    expect(await new BrowserPrintShop(storage).list()).toHaveLength(1)
  })

  it.each(['replace', 'clear'] as const)('queues an older unqueued current shift before %s can discard it', async (action) => {
    const storage = new MemoryStorage()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: closedSnapshot() }))
    const store = new BrowserShiftStore(storage)
    if (action === 'replace') await store.saveCurrent(nextSnapshot())
    else await store.clearCurrent()
    const reopened = new BrowserShiftStore(storage)
    const receipt = await reopened.recoverPendingPrint('intent-1', new BrowserPrintShop(storage), 'run-1')
    expect(receipt?.shiftRunId).toBe('run-1')
    expect(await reopened.listReconciliations()).toEqual([closedSnapshot()])
  })

  it('does not discard current state when persisting its reconciliation queue fails', async () => {
    class QueueFailureStorage extends MemoryStorage {
      override setItem(key: string, value: string) {
        if (key === SHIFT_STORE_KEYS.reconciliation) throw new Error('storage full')
        super.setItem(key, value)
      }
    }
    const storage = new QueueFailureStorage()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: closedSnapshot() }))
    const store = new BrowserShiftStore(storage)
    await expect(store.saveCurrent(nextSnapshot())).rejects.toThrow('storage full')
    expect(await store.loadCurrent()).toEqual(closedSnapshot())
    await expect(store.clearCurrent()).rejects.toThrow('storage full')
    expect(await store.loadCurrent()).toEqual(closedSnapshot())
  })

  it('validates every queued snapshot and never calls the service for a corrupt queue', async () => {
    const storage = new MemoryStorage()
    const broken = { ...closedSnapshot(), run: { ...closedSnapshot().run, snapshots: {} } }
    storage.setItem(SHIFT_STORE_KEYS.reconciliation, JSON.stringify({ version: 1, kind: 'shift-reconciliation', value: [broken] }))
    const gateway = new BrowserPrintShop(storage)
    gateway.findByIntent = async () => { throw new Error('must reject before query') }
    const store = new BrowserShiftStore(storage)
    const writes = storage.writes
    expect(await store.listReconciliations()).toEqual([])
    expect(await store.recoverPendingPrint('intent-1', gateway, 'run-1')).toBeUndefined()
    expect(storage.writes).toBe(writes)
  })

  it.each([
    ['dangling snapshot id', (run: any) => { run.snapshots = {} }],
    ['wrong archive kind', (run: any) => { run.snapshots['snapshot-1'].kind = 'saved-card' }],
    ['wrong archive version', (run: any) => { run.snapshots['snapshot-1'].version = 2 }],
    ['wrong archive identity', (run: any) => { run.snapshots['snapshot-1'].id = 'other' }],
    ['wrong archive run', (run: any) => { run.snapshots['snapshot-1'].shiftRunId = 'other' }],
    ['wrong archive order', (run: any) => { run.snapshots['snapshot-1'].orderId = 'other' }],
    ['missing archive draft', (run: any) => { run.snapshots['snapshot-1'].draftId = '' }],
    ['malformed design', (run: any) => { run.snapshots['snapshot-1'].design = { version: 1 } }],
    ['wrong reservation intent', (run: any) => { run.printers.quick.reservations[0].intentId = 'other' }],
    ['dangling reservation', (run: any) => { run.printers.quick.reservations = [] }],
    ['wrong reservation puzzle', (run: any) => { run.printers.quick.reservations[0].puzzleId = 'other' }],
    ['unproven calibration', (run: any) => { run.puzzles['puzzle-1'].result = { status: 'pending' } }],
    ['missing absolute patience deadline', (run: any) => { delete run.orders[0].patience.depletesAtMs }],
    ['nonfinite absolute patience deadline', (run: any) => { run.orders[0].patience.depletesAtMs = Infinity }],
    ['missing current task', (run: any) => { run.printers.quick.currentTaskId = 'missing' }],
    ['missing queued task', (run: any) => { run.printers.quick.queuedTaskIds = ['missing'] }],
    ['empty material stock', (run: any) => { run.materials.stock = {} }],
    ['negative material stock', (run: any) => { run.materials.stock.wax.available = -1 }],
    ['inconsistent reservation totals', (run: any) => { run.materials.stock.wax.reserved = 1 }],
    ['malformed material reservation', (run: any) => { run.materials.reservations.bad = { id: 'bad' } }],
    ['malformed draft stage', (run: any) => { run.drafts['draft-1'].stage = 'unknown' }],
    ['malformed draft reservations', (run: any) => { run.drafts['draft-1'].reservationIds = null }],
    ['malformed active craft', (run: any) => { run.drafts['draft-1'].stage = 'crafting'; run.drafts['draft-1'].activeCraft = {} }],
    ['dangling archive draft', (run: any) => { run.snapshots['snapshot-1'].draftId = 'missing' }],
    ['malformed task', (run: any) => { run.tasks.bad = { id: 'bad', status: 'printing' } }],
    ['malformed puzzle definition', (run: any) => { run.puzzles['puzzle-1'].definition = {} }],
    ['malformed puzzle answer', (run: any) => { run.puzzles['puzzle-1'].result.answer = {} }],
    ['malformed order requirements', (run: any) => { run.orders[0].content.requirements = {} }],
  ])('rejects %s before any recovery gateway call', async (_name, corrupt) => {
    const broken = structuredClone(snapshot())
    corrupt(broken.run)
    const storage = new MemoryStorage()
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: broken }))
    const calls: string[] = []
    const gateway = new BrowserPrintShop(storage)
    gateway.findByIntent = async () => { calls.push('find'); return undefined }
    gateway.startShift = async () => { calls.push('start'); throw new Error('unexpected service call') }
    const store = new BrowserShiftStore(storage)
    const writes = storage.writes
    expect(await store.loadCurrent()).toBeUndefined()
    expect(await store.recoverPendingPrint('intent-1', gateway)).toBeUndefined()
    await expect(recoverPendingShiftPrint(broken, gateway, 'intent-1')).rejects.toThrow(/context|snapshot/i)
    expect(calls).toEqual([])
    expect(storage.writes).toBe(writes)
  })

  it('does not start uncalibrated authorizations or an absent intent', async () => {
    const gateway = new BrowserPrintShop(new MemoryStorage())
    const confirmed: PrintAuthorization = { id: 'intent-1', shiftRunId: 'run-1', orderId: 'order-1', snapshotId: 'snapshot-1', confirmedAtMs: 1_000, nextAttempt: 1, status: 'confirmed', machineId: 'quick' }
    expect(await recoverPendingShiftPrint(snapshot(confirmed), gateway, 'intent-1')).toBeUndefined()
    expect(await recoverPendingShiftPrint(snapshot(), gateway, 'missing')).toBeUndefined()
    expect(await gateway.list()).toEqual([])
  })

  it.each([
    { id: 'different-intent' }, { shiftRunId: 'different-run' }, { snapshotId: 'different-snapshot' }, { machineId: 'fine' },
  ] as const)('fails closed before any gateway call for mismatched pending state: %j', async (change) => {
    const current = snapshot({ ...pending(), ...change })
    const calls: string[] = []
    const gateway = new BrowserPrintShop(new MemoryStorage())
    gateway.findByIntent = async () => { calls.push('find'); return undefined }
    await expect(recoverPendingShiftPrint(current, gateway, 'intent-1')).rejects.toThrow(/context/i)
    expect(calls).toEqual([])
    expect(await gateway.list()).toEqual([])
  })

  it('rejects a lookup that returns a workshop or differently pinned shift record', async () => {
    const gateway = new BrowserPrintShop(new MemoryStorage())
    const workshop = await gateway.startWorkshop('intent-1', 'snapshot-1')
    const lyingGateway: PrintShopGateway = { ...gateway, start: gateway.start.bind(gateway), startShift: gateway.startShift.bind(gateway), startWorkshop: gateway.startWorkshop.bind(gateway), list: gateway.list.bind(gateway), get: gateway.get.bind(gateway), findByIntent: async () => workshop }
    await expect(recoverPendingShiftPrint(snapshot(), lyingGateway, 'intent-1')).rejects.toThrow(/context/i)
    expect(await gateway.list()).toHaveLength(1)
  })
})
