import { describe, expect, it } from 'vitest'
import {
  BROWSER_STORE_KEYS,
  BrowserCardLibrary,
  BrowserPrintShop,
  BrowserSessionStore,
} from '../infrastructure/browser-store'
import type { CardDesign, ProgressState } from '../domain/types'
import { InMemoryPrintShop, toShiftPrintReceipt } from '../domain/gateways'

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()
  writes = 0
  printWrites = 0

  get length() {
    return this.#values.size
  }

  clear() {
    this.writes += 1
    this.#values.clear()
  }

  getItem(key: string) {
    return this.#values.get(key) ?? null
  }

  key(index: number) {
    return [...this.#values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.writes += 1
    this.#values.delete(key)
  }

  setItem(key: string, value: string) {
    this.writes += 1
    if (key === BROWSER_STORE_KEYS.prints || key.startsWith('rabbit-house:v2:print-intent:')) this.printWrites += 1
    this.#values.set(key, value)
  }

  keys() {
    return [...this.#values.keys()]
  }
}

const design = (): CardDesign => ({
  version: 1,
  paperId: 'cream',
  layers: [
    {
      kind: 'sticker',
      id: 'rabbit',
      assetId: 'small-rabbit',
      x: 0.5,
      y: 0.5,
      scale: 0.12,
      rotation: 0,
    },
  ],
})

describe('BrowserCardLibrary', () => {
  it('persists isolated card snapshots under its own versioned key', async () => {
    const storage = new MemoryStorage()
    const firstPage = new BrowserCardLibrary(storage, () => '2026-10-13T12:00:00.000Z')
    const draft = design()

    const saved = await firstPage.save({ requestId: 'save-isolated', design: draft, commissionId: 'chino' })
    ;(draft.layers[0] as { x: number }).x = 0.9
    ;(saved.design.layers[0] as { x: number }).x = 0.8

    const reopenedPage = new BrowserCardLibrary(storage)
    const reopened = await reopenedPage.get(saved.cardId)
    ;(reopened!.design.layers[0] as { x: number }).x = 0.7

    expect((await reopenedPage.get(saved.cardId))?.design.layers[0]).toMatchObject({ x: 0.5 })
    expect(storage.keys()).toEqual([BROWSER_STORE_KEYS.cardLibrary])
    expect(JSON.parse(storage.getItem(BROWSER_STORE_KEYS.cardLibrary)!)).toMatchObject({
      version: 2, kind: 'card-library', cards: [{ cardId: saved.cardId }],
    })
  })

  it('keeps get and list as pure queries', async () => {
    const storage = new MemoryStorage()
    const library = new BrowserCardLibrary(storage)
    const saved = await library.save({ requestId: 'save-query', design: design() })
    const writesAfterSave = storage.writes

    await library.get(saved.cardId)
    await library.get(saved.cardId)
    await library.list()
    await library.list()

    expect(storage.writes).toBe(writesAfterSave)
  })

  it('reads v1 cards without writing and migrates only on the next save', async () => {
    const storage = new MemoryStorage()
    const old = { cardId: 'card-7', design: design(), savedAt: '2026-10-13T12:00:00.000Z' }
    storage.setItem(BROWSER_STORE_KEYS.cards, JSON.stringify([old]))
    const library = new BrowserCardLibrary(storage)
    const writes = storage.writes
    const migrated = { ...old, source: { kind: 'native' } }
    expect(await library.get('card-7')).toEqual(migrated)
    expect(await library.list()).toEqual([migrated])
    expect(storage.writes).toBe(writes)
    const saved = await library.save({ requestId: 'save-migration', design: design() })
    expect(saved.cardId).toBe('card-8')
    expect(await library.list()).toHaveLength(2)
    expect(storage.getItem(BROWSER_STORE_KEYS.cards)).toBe(JSON.stringify([old]))
    expect(JSON.parse(storage.getItem(BROWSER_STORE_KEYS.cardLibrary)!)).toMatchObject({ version: 2 })
  })

  it('rejects damaged new envelopes without falling back to stale legacy cards or writing', async () => {
    const storage = new MemoryStorage()
    storage.setItem(BROWSER_STORE_KEYS.cards, JSON.stringify([{ cardId: 'old', design: design(), savedAt: 'old' }]))
    storage.setItem(BROWSER_STORE_KEYS.cardLibrary, JSON.stringify({ version: 9, kind: 'card-library', cards: [] }))
    const writes = storage.writes
    expect(await new BrowserCardLibrary(storage).list()).toEqual([])
    expect(storage.writes).toBe(writes)
  })

  it('saving artwork never starts a print', async () => {
    const storage = new MemoryStorage()
    await new BrowserCardLibrary(storage).save({ requestId: 'save-only', design: design() })
    expect(await new BrowserPrintShop(storage).list()).toEqual([])
    expect(storage.keys()).toEqual([BROWSER_STORE_KEYS.cardLibrary])
  })

  it.each(['{broken', JSON.stringify({ version: 9, kind: 'card-library', cards: [] })])('preserves corrupt card envelopes on mutation: %s', async (raw) => {
    const storage = new MemoryStorage()
    storage.setItem(BROWSER_STORE_KEYS.cardLibrary, raw)
    const writes = storage.writes
    await expect(new BrowserCardLibrary(storage).save({ requestId: 'save-corrupt', design: design() })).rejects.toThrow(/corrupt|invalid/i)
    expect(storage.getItem(BROWSER_STORE_KEYS.cardLibrary)).toBe(raw)
    expect(storage.writes).toBe(writes)
  })
})

describe('BrowserPrintShop', () => {
  it('persists intent idempotency while allowing a new intent to print again', async () => {
    const storage = new MemoryStorage()
    const firstPage = new BrowserPrintShop(storage, () => '2026-10-13T12:00:00.000Z')
    const first = await firstPage.startWorkshop('confirm-1', 'card-1')

    const reopenedPage = new BrowserPrintShop(storage)
    const retried = await reopenedPage.startWorkshop('confirm-1', 'card-1')
    const anotherCopy = await reopenedPage.startWorkshop('confirm-2', 'card-1')

    expect(retried).toEqual(first)
    expect(anotherCopy.printJobId).not.toBe(first.printJobId)
    expect(await reopenedPage.list()).toHaveLength(2)
    expect(storage.keys()).toEqual([BROWSER_STORE_KEYS.printIntent('confirm-1'), BROWSER_STORE_KEYS.printIntent('confirm-2')])
    expect(first.context).toEqual({ kind: 'workshop' })
    expect(JSON.parse(storage.getItem(BROWSER_STORE_KEYS.printIntent('confirm-1'))!)).toMatchObject({
      version: 2, kind: 'print-intent', record: { intentId: 'confirm-1', printJobId: first.printJobId },
    })
  })

  it('advances a persisted job without creating another job', async () => {
    const storage = new MemoryStorage()
    const shop = new BrowserPrintShop(storage)
    const queued = await shop.startWorkshop('confirm-1', 'card-1')

    const processing = await shop.advance(queued.printJobId, 'processing')
    const succeeded = await shop.advance(queued.printJobId, 'succeeded')

    expect(processing?.status).toBe('processing')
    expect(succeeded?.status).toBe('succeeded')
    expect((await new BrowserPrintShop(storage).get(queued.printJobId))?.status).toBe('succeeded')
    expect(await shop.list()).toHaveLength(1)
  })

  it('returns deep copies and never writes during get or list', async () => {
    const storage = new MemoryStorage()
    const shop = new BrowserPrintShop(storage)
    const started = await shop.startShift('confirm-1', 'snapshot-1', 'quick', 'shift-1')
    ;(started as { status: string }).status = 'failed'
    const fetched = await shop.get(started.printJobId)
    ;(fetched as { status: string }).status = 'failed'
    const writesAfterStart = storage.writes

    const stored = await shop.get(started.printJobId)
    await shop.list()
    await shop.list()
    const found = await shop.findByIntent('confirm-1')
    ;(found!.context as { shiftRunId: string }).shiftRunId = 'tampered'
    expect((await shop.findByIntent('confirm-1'))?.context).toEqual({ kind: 'shift', machineId: 'quick', shiftRunId: 'shift-1' })

    expect(stored?.status).toBe('queued')
    expect(storage.writes).toBe(writesAfterStart)
  })

  it('commits the fallback task and intent in one write when concurrent retries reuse the same immutable context', async () => {
    const storage = new MemoryStorage()
    const firstPage = new BrowserPrintShop(storage, undefined, { locks: null })
    const secondPage = new BrowserPrintShop(storage, undefined, { locks: null })
    const [first, second] = await Promise.all([
      firstPage.startShift('intent', 'snapshot', 'fine', 'run'),
      secondPage.startShift('intent', 'snapshot', 'fine', 'run'),
    ])
    expect(second).toEqual(first)
    expect(storage.printWrites).toBe(1)
    expect(await secondPage.list()).toEqual([first])
    expect(await secondPage.findByIntent('intent')).toEqual(first)
  })

  it.each([
    ['snapshot-2', 'quick', 'run-1'],
    ['snapshot-1', 'fine', 'run-1'],
    ['snapshot-1', 'quick', 'run-2'],
  ] as const)('rejects an already persisted fallback intent rebinding to %s / %s / %s', async (snapshotId, machineId, shiftRunId) => {
    const storage = new MemoryStorage()
    const shop = new BrowserPrintShop(storage, undefined, { locks: null })
    await shop.startShift('intent', 'snapshot-1', 'quick', 'run-1')
    await expect(shop.startShift('intent', snapshotId, machineId, shiftRunId)).rejects.toThrow(/intent.*context/i)
    await expect(shop.startWorkshop('intent', 'snapshot-1')).rejects.toThrow(/intent.*context/i)
    expect(storage.printWrites).toBe(1)
  })

  it('maps a shift record to an accepted receipt with stable service IDs only', async () => {
    const shop = new BrowserPrintShop(new MemoryStorage(), () => '2026-10-14T00:00:00.000Z')
    const job = await shop.startShift('intent', 'snapshot', 'fine', 'run')
    expect(toShiftPrintReceipt(job)).toEqual({
      status: 'accepted', receiptId: job.receiptId, taskId: job.printJobId,
      intentId: 'intent', snapshotId: 'snapshot', machineId: 'fine', shiftRunId: 'run',
      receivedAtMs: Date.parse(job.createdAt), authority: 'local', details: null,
    })
    expect(() => toShiftPrintReceipt({ ...job, context: { kind: 'shift', machineId: 'invalid', shiftRunId: 'run' } } as never)).toThrow(/shift/i)
    const workshop = await shop.startWorkshop('workshop', 'card')
    expect(() => toShiftPrintReceipt(workshop)).toThrow(/shift/i)
  })

  it('uses an injected exclusive lock for mutations but not queries', async () => {
    const names: string[] = []
    const locks = { async request<T>(name: string, action: () => T | Promise<T>): Promise<T> {
      names.push(name)
      return action()
    } }
    const shop = new BrowserPrintShop(new MemoryStorage(), undefined, { locks })
    const job = await shop.startWorkshop('intent', 'card')
    await shop.advance(job.printJobId, 'processing')
    await shop.findByIntent('intent')
    await shop.get(job.printJobId)
    await shop.list()
    expect(names).toEqual([BROWSER_STORE_KEYS.prints, BROWSER_STORE_KEYS.prints])
  })

  it('retries a conflicting write and preserves the competing task', async () => {
    const competitorStorage = new MemoryStorage()
    const locks = { async request<T>(_name: string, action: () => T | Promise<T>): Promise<T> { return action() } }
    const competitor = await new BrowserPrintShop(competitorStorage, undefined, { locks }).startWorkshop('other-intent', 'other-card')
    class ConflictingStorage extends MemoryStorage {
      conflict = true
      override setItem(key: string, value: string) {
        super.setItem(key, value)
        if (key === BROWSER_STORE_KEYS.prints && this.conflict) {
          this.conflict = false
          super.setItem(key, competitorStorage.getItem(key)!)
        }
      }
    }
    const storage = new ConflictingStorage()
    const shop = new BrowserPrintShop(storage, undefined, { locks, maxAttempts: 3 })
    const job = await shop.startWorkshop('intent', 'card')
    expect(await shop.findByIntent('intent')).toEqual(job)
    expect(await shop.findByIntent('other-intent')).toEqual(competitor)
    expect(await shop.list()).toHaveLength(2)
    expect(storage.printWrites).toBe(3)
  })

  it('bounds conflict retries and can later retry the same intent', async () => {
    class ConflictingStorage extends MemoryStorage {
      conflict = true
      override setItem(key: string, value: string) {
        super.setItem(key, value)
        if (key === BROWSER_STORE_KEYS.prints && this.conflict) {
          super.setItem(key, JSON.stringify({ version: 2, kind: 'prints', revision: 0, jobs: [], intents: {} }))
        }
      }
    }
    const storage = new ConflictingStorage()
    const locks = { async request<T>(_name: string, action: () => T | Promise<T>): Promise<T> { return action() } }
    const shop = new BrowserPrintShop(storage, undefined, { locks, maxAttempts: 2 })
    await expect(shop.startShift('intent', 'snapshot', 'quick', 'run')).rejects.toThrow(/conflict/i)
    expect(storage.printWrites).toBe(4)
    storage.conflict = false
    const retried = await shop.startShift('intent', 'snapshot', 'quick', 'run')
    expect(await shop.findByIntent('intent')).toEqual(retried)
    expect(await shop.list()).toHaveLength(1)
  })

  it('recovers a persisted task when the storage accepted it but the caller saw a timeout', async () => {
    class LostReturnStorage extends MemoryStorage {
      fail = true
      override setItem(key: string, value: string) {
        super.setItem(key, value)
        if (this.fail && key === BROWSER_STORE_KEYS.printIntent('intent')) { this.fail = false; throw new Error('timeout after acceptance') }
      }
    }
    const storage = new LostReturnStorage()
    const shop = new BrowserPrintShop(storage)
    await expect(shop.startShift('intent', 'snapshot', 'fine', 'run')).rejects.toThrow('timeout')
    const reopened = new BrowserPrintShop(storage)
    const accepted = await reopened.findByIntent('intent')
    expect(accepted).toBeDefined()
    expect(await reopened.startShift('intent', 'snapshot', 'fine', 'run')).toEqual(accepted)
    expect(await reopened.list()).toHaveLength(1)
    expect(storage.printWrites).toBe(1)
  })

  it('migrates v1 jobs and tokens on mutation, preserving orphan job visibility', async () => {
    const storage = new MemoryStorage()
    const jobs = [1, 2].map((id) => ({ printJobId: `print-${id}`, cardId: `card-${id}`, status: 'queued', createdAt: '2026-10-13T12:00:00.000Z' }))
    storage.setItem(BROWSER_STORE_KEYS.printJobs, JSON.stringify(jobs))
    storage.setItem(BROWSER_STORE_KEYS.printTokens, JSON.stringify([{ requestToken: 'old-intent', printJobId: 'print-1' }]))
    const shop = new BrowserPrintShop(storage)
    const writes = storage.writes
    expect(await shop.list()).toHaveLength(2)
    const old = await shop.findByIntent('old-intent')
    expect(old).toMatchObject({ printJobId: 'print-1', context: { kind: 'workshop' } })
    expect(await shop.get('print-2')).toMatchObject({ context: { kind: 'workshop' } })
    expect(storage.writes).toBe(writes)
    expect(await shop.startWorkshop('old-intent', 'card-1')).toEqual(old)
    expect(storage.writes).toBe(writes)
    await shop.startWorkshop('new-intent', 'card-1')
    expect(storage.printWrites).toBe(1)
    expect(await shop.list()).toHaveLength(3)
    expect(storage.getItem(BROWSER_STORE_KEYS.printJobs)).toBe(JSON.stringify(jobs))
    expect(JSON.parse(storage.getItem(BROWSER_STORE_KEYS.printIntent('new-intent'))!)).toMatchObject({ version: 2, kind: 'print-intent' })
  })

  it.each([
    { version: 3, kind: 'prints', revision: 0, jobs: [], intents: {} },
    { version: 2, kind: 'cards', revision: 0, jobs: [], intents: {} },
    { version: 2, kind: 'prints', revision: 0, jobs: [{}], intents: {} },
    { version: 2, kind: 'prints', revision: 0, jobs: [], intents: { dangling: 'missing' } },
  ])('ignores corrupt print envelopes on pure queries: %j', async (value) => {
    const storage = new MemoryStorage()
    storage.setItem(BROWSER_STORE_KEYS.prints, JSON.stringify(value))
    const writes = storage.writes
    const shop = new BrowserPrintShop(storage)
    expect(await shop.list()).toEqual([])
    expect(await shop.findByIntent('dangling')).toBeUndefined()
    expect(storage.writes).toBe(writes)
  })

  it('serializes two tabs when one reads stale state before the other commits', async () => {
    let competing: Promise<Awaited<ReturnType<BrowserPrintShop['startWorkshop']>>> | undefined
    let secondPage: BrowserPrintShop
    class StaleReadStorage extends MemoryStorage {
      armed = false
      reads = 0
      override getItem(key: string) {
        const snapshotBeforeCompetingWrite = super.getItem(key)
        if (this.armed && key === BROWSER_STORE_KEYS.prints && ++this.reads === 2) {
          this.armed = false
          competing = secondPage.startWorkshop('other-intent', 'other-card')
        }
        return snapshotBeforeCompetingWrite
      }
    }
    const storage = new StaleReadStorage()
    const firstPage = new BrowserPrintShop(storage, undefined, { locks: null, ownerId: 'first-tab' })
    secondPage = new BrowserPrintShop(storage, undefined, { locks: null, ownerId: 'second-tab' })
    await firstPage.startWorkshop('seed-intent', 'seed-card')
    storage.armed = true
    const first = await firstPage.startWorkshop('intent', 'card')
    const second = await competing!
    expect(second).toBeDefined()
    expect(await firstPage.findByIntent('intent')).toEqual(first)
    expect(await firstPage.findByIntent('other-intent')).toEqual(second)
    expect(await firstPage.list()).toHaveLength(3)
    expect(storage.getItem(BROWSER_STORE_KEYS.printLease)).toBeNull()
  })

  it('bounds lease contention, leaves another owner intact and recovers an expired lease', async () => {
    const storage = new MemoryStorage()
    let time = 100
    let waits = 0
    const foreignLease = { version: 1, kind: 'print-lease', owner: 'another-tab', expiresAtMs: 1_000 }
    storage.setItem(BROWSER_STORE_KEYS.printLease, JSON.stringify(foreignLease))
    const shop = new BrowserPrintShop(storage, undefined, {
      locks: null, maxAttempts: 2, ownerId: 'this-tab', leaseNow: () => time,
      leaseWait: async () => { waits += 1 },
    })
    await expect(shop.startWorkshop('intent', 'card')).rejects.toThrow(/lease|lock|timeout/i)
    expect(waits).toBeLessThanOrEqual(2)
    expect(storage.printWrites).toBe(0)
    expect(JSON.parse(storage.getItem(BROWSER_STORE_KEYS.printLease)!)).toEqual(foreignLease)
    time = 1_001
    const accepted = await shop.startWorkshop('intent', 'card')
    expect(await shop.findByIntent('intent')).toEqual(accepted)
    expect(storage.getItem(BROWSER_STORE_KEYS.printLease)).toBeNull()
  })

  it('rechecks lease ownership before committing and never releases a replacement owner', async () => {
    const storage = new MemoryStorage()
    let time = 100
    let replacementInstalled = false
    const replacement = { version: 1, kind: 'print-lease', owner: 'replacement-tab', expiresAtMs: 10_000 }
    const shop = new BrowserPrintShop(storage, () => {
      // Candidate creation is between the protected read and write. Simulate expiry/tab resumption here.
      if (!replacementInstalled) {
        replacementInstalled = true
        time = 2_000
        storage.setItem(BROWSER_STORE_KEYS.printLease, JSON.stringify(replacement))
      }
      return '2026-10-14T00:00:00.000Z'
    }, { locks: null, maxAttempts: 2, ownerId: 'expired-tab', leaseNow: () => time, leaseWait: async () => undefined })
    await expect(shop.startWorkshop('intent', 'card')).rejects.toThrow(/lease|lock|timeout/i)
    expect(storage.printWrites).toBe(0)
    expect(JSON.parse(storage.getItem(BROWSER_STORE_KEYS.printLease)!)).toEqual(replacement)
  })

  it('retains both intents when an expired owner writes after its final ownership check', async () => {
    const competitorStorage = new MemoryStorage()
    const competitor = await new BrowserPrintShop(competitorStorage, undefined, { locks: null }).startWorkshop('other-intent', 'other-card')
    class LateWriterStorage extends MemoryStorage {
      armed = true
      override setItem(key: string, value: string) {
        if (this.armed && (key === BROWSER_STORE_KEYS.prints || key === 'rabbit-house:v2:print-intent:intent')) {
          this.armed = false
          // Another tab takes the lease and commits after the last check, before this write.
          super.setItem(BROWSER_STORE_KEYS.printLease, JSON.stringify({ version: 1, kind: 'print-lease', owner: 'replacement', expiresAtMs: Date.now() + 60_000 }))
          for (const competingKey of competitorStorage.keys()) super.setItem(competingKey, competitorStorage.getItem(competingKey)!)
        }
        super.setItem(key, value)
      }
    }
    const storage = new LateWriterStorage()
    const first = new BrowserPrintShop(storage, undefined, { locks: null, maxAttempts: 1 })
    await first.startWorkshop('intent', 'card').catch(() => undefined)
    const reopened = new BrowserPrintShop(storage)
    expect(await reopened.findByIntent('intent')).toMatchObject({ intentId: 'intent', snapshotId: 'card' })
    expect(await reopened.findByIntent('other-intent')).toEqual(competitor)
    expect((await reopened.list()).map((record) => record.intentId).sort()).toEqual(['intent', 'other-intent'])
  })

  it.each(['{broken', JSON.stringify({ version: 2, kind: 'prints', revision: 0, jobs: [], intents: { dangling: 'missing' } })])('preserves corrupt print envelopes on every mutation: %s', async (raw) => {
    const storage = new MemoryStorage()
    storage.setItem(BROWSER_STORE_KEYS.prints, raw)
    const shop = new BrowserPrintShop(storage)
    const writes = storage.writes
    await expect(shop.startWorkshop('intent', 'card')).rejects.toThrow(/corrupt|invalid/i)
    await expect(shop.advance('missing', 'processing')).rejects.toThrow(/corrupt|invalid/i)
    expect(storage.getItem(BROWSER_STORE_KEYS.prints)).toBe(raw)
    expect(storage.writes).toBe(writes)
  })

  it('preserves a corrupt per-intent envelope instead of recreating its task', async () => {
    const storage = new MemoryStorage()
    const key = 'rabbit-house:v2:print-intent:intent'
    const raw = '{broken'
    storage.setItem(key, raw)
    const writes = storage.writes
    await expect(new BrowserPrintShop(storage).startWorkshop('intent', 'card')).rejects.toThrow(/corrupt|invalid/i)
    expect(storage.getItem(key)).toBe(raw)
    expect(storage.writes).toBe(writes)
  })

  it.each([
    { ownerId: '' }, { ownerId: '   ' }, { leaseNow: 1 }, { leaseWait: 1 }, { leaseDurationMs: NaN },
  ])('rejects invalid lease options before storage writes: %j', async (options) => {
    const storage = new MemoryStorage()
    await expect(async () => {
      const shop = new BrowserPrintShop(storage, undefined, { locks: null, ...options } as never)
      await shop.startWorkshop('intent', 'card')
    }).rejects.toThrow(/lease|owner|clock|wait/i)
    expect(storage.writes).toBe(0)
  })

  it.each([NaN, Infinity, -1])('rejects an invalid lease clock result before storage writes: %s', async (time) => {
    const storage = new MemoryStorage()
    const shop = new BrowserPrintShop(storage, undefined, { locks: null, leaseNow: () => time, leaseWait: async () => undefined })
    await expect(shop.startWorkshop('intent', 'card')).rejects.toThrow(/lease|clock/i)
    expect(storage.writes).toBe(0)
  })
})

describe('InMemoryPrintShop contract', () => {
  it('keeps the same distinct starts and rejects rebinding', async () => {
    const shop = new InMemoryPrintShop()
    const workshop = await shop.startWorkshop('workshop', 'card')
    const shift = await shop.startShift('shift', 'snapshot', 'fine', 'run')
    expect(workshop.context).toEqual({ kind: 'workshop' })
    expect(shift.context).toEqual({ kind: 'shift', machineId: 'fine', shiftRunId: 'run' })
    expect(await shop.findByIntent('shift')).toEqual(shift)
    expect(await shop.startShift('shift', 'snapshot', 'fine', 'run')).toEqual(shift)
    await expect(shop.startWorkshop('shift', 'snapshot')).rejects.toThrow(/intent.*context/i)
    expect(await shop.list()).toHaveLength(2)
  })
})

describe('BrowserSessionStore', () => {
  it('keeps story and draft sessions in separate versioned keys', async () => {
    const storage = new MemoryStorage()
    const story = new BrowserSessionStore<ProgressState>('story', storage)
    const draft = new BrowserSessionStore<CardDesign>('draft', storage)
    const progress: ProgressState = {
      mode: 'story',
      tutorialCompleted: true,
      currentCommissionId: 'chino',
      completedCommissionIds: [],
      unlockedAssetIds: [],
      freeModeUnlocked: false,
      dialogueNodeId: 'chino-order',
      readNodeIds: [],
    }

    expect(await story.load()).toBeUndefined()
    await story.save(progress)
    await draft.save(design())
    ;(progress.completedCommissionIds as string[]).push('chino')

    expect((await story.load())?.completedCommissionIds).toEqual([])
    expect((await draft.load())?.paperId).toBe('cream')
    expect(storage.keys().sort()).toEqual(
      [BROWSER_STORE_KEYS.session('draft'), BROWSER_STORE_KEYS.session('story')].sort(),
    )
    expect(BROWSER_STORE_KEYS.session('story')).toContain(':v1:session:story')
  })

  it('clears only its own session', async () => {
    const storage = new MemoryStorage()
    const story = new BrowserSessionStore<{ node: string }>('story', storage)
    const draft = new BrowserSessionStore<{ dirty: boolean }>('draft', storage)
    await story.save({ node: 'opening' })
    await draft.save({ dirty: true })

    await story.clear()

    expect(await story.load()).toBeUndefined()
    expect(await draft.load()).toEqual({ dirty: true })
  })
})
