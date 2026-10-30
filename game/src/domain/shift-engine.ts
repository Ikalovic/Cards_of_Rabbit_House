import { BORDERS, DECORATIONS, isComplexOrder, LAYOUTS, MATERIALS, MOTIFS, PAPERS, SHAPES, SURFACE_FINISHES, WORD_STAMPS } from '../content/production'
import { evaluateOrder } from './shift-evaluation'
import { validatePublicPuzzleDefinition } from './puzzle-public'
import type { PuzzleCreationInput } from './puzzle-public'
import { TUTORIAL_STATION_TRIGGERS } from './shift-types'
import type {
  CatalogItem, ConsumptionTrigger, CustomerOrder, ElementKind, MachineId, MaterialCost, MaterialLedger, PreparationSelection, PrintAuthorization, PrintReceipt, PrinterState, ProductionDraft, PuzzleAnswer,
  PuzzleInstance, PuzzleResult, ShiftAction, ShiftCardSnapshot, ShiftRun, StageDefinition,
} from './shift-types'

/** The engine never consults an ambient clock. Callers supply wall-clock timestamps. */
export type ShiftEngineAction = ShiftAction
export type ShiftPuzzleServices = Readonly<{
  createPuzzle: (input: PuzzleCreationInput) => PuzzleInstance
  gradePuzzle: (instance: PuzzleInstance, answer: PuzzleAnswer, submittedAtMs: number) => PuzzleResult
}>
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[]
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T
type Run = Mutable<ShiftRun>
const clone = <T>(value: T): Mutable<T> => structuredClone(value) as Mutable<T>
const machineIds: readonly MachineId[] = ['quick', 'fine']
const rounded = (value: number) => Math.round(value * 1e6) / 1e6

/** Live deadlines use logical time: wall time plus the persisted inspection cost. */
export function shiftTimeAt(state: ShiftRun, wallNowMs: number): number {
  const at = wallNowMs + (state.inspectionTimeOffsetMs ?? 0)
  if (!Number.isFinite(wallNowMs) || !Number.isFinite(at)) throw new RangeError('Invalid clock')
  return at
}

export function initializeShift(stage: StageDefinition, id: string, startedAtMs: number): ShiftRun {
  if (!Number.isFinite(startedAtMs) || !id) throw new RangeError('Invalid shift identity or start time')
  const printer = (machineId: MachineId): PrinterState => ({ machineId, currentTaskId: null, queuedTaskIds: [], reservations: [], orderLockUntilMs: {}, estimatedFreeAtMs: null })
  const stock = Object.fromEntries(MATERIALS.map(({ id }) => [id, { available: stage.inventory[id], reserved: 0, consumed: 0 }])) as MaterialLedger['stock']
  return clone({
    version: 1, id, stage, seed: stage.seed, startedAtMs, deadlineAtMs: startedAtMs + stage.durationSeconds * 1000,
    lastProcessedAtMs: startedAtMs, inspectionTimeOffsetMs: 0, pauses: [], seenTutorialTriggers: [], status: 'running',
    orders: stage.customers.map((customer): CustomerOrder => ({
      id: customer.id, shiftRunId: id, content: customer.order, arrivalAtMs: startedAtMs + customer.arrivalSeconds * 1000,
      acceptedAtMs: null, basePatienceSeconds: customer.basePatienceSeconds, lastWaitSeconds: customer.lastWaitSeconds,
      position: 'door_waiting', outcome: { status: 'pending' }, remedy: 'none',
      patience: { phase: 'normal', depletesAtMs: startedAtMs + customer.arrivalSeconds * 1000 + customer.basePatienceSeconds * 1000 / 0.35,
        remainingSeconds: customer.basePatienceSeconds, updatedAtMs: startedAtMs + customer.arrivalSeconds * 1000 },
    })),
    activeOrderIds: [], selectedOrderId: null, station: 'reception', drafts: {}, snapshotIds: [], snapshots: {},
    materials: { stock, reservations: {} }, authorizations: {}, puzzles: {}, tasks: {},
    printers: { quick: printer('quick'), fine: printer('fine') }, inspectionsRemaining: stage.inspections,
    freeDemoInspectionsRemaining: stage.freeDemoInspections,
    remedies: { explainProgressAvailable: true, expediteAvailable: true }, pendingReconciliationIntentIds: [],
  } satisfies ShiftRun)
}

function releaseOrderMaterials(run: Run, orderId: string, at: number): void {
  for (const reservation of Object.values(run.materials.reservations)) {
    if (reservation.status !== 'reserved' || run.drafts[reservation.draftId]?.orderId !== orderId) continue
    const stock = run.materials.stock[reservation.materialId]
    stock.available += reservation.quantity
    stock.reserved -= reservation.quantity
    run.materials.reservations[reservation.id] = { ...reservation, status: 'released', releasedAtMs: at }
  }
}

function expireOrderAuthorizations(run: Run, orderId: string, at: number): void {
  for (const authorization of Object.values(run.authorizations)) {
    if (authorization.orderId !== orderId || !['confirmed', 'calibrating', 'failed'].includes(authorization.status)) continue
    if (authorization.status === 'calibrating') {
      run.puzzles[authorization.puzzleId].result = { status: 'failed', failedAtMs: at, reason: 'exit', answer: null }
    }
    removePrinterReservation(run, authorization.id)
    run.authorizations[authorization.id] = { ...authorizationBase(authorization), status: 'expired_unprinted', expiredAtMs: at }
  }
}

function leave(run: Run, order: Mutable<CustomerOrder>, at: number, reason: 'patience' | 'closing'): void {
  order.position = 'closed'
  order.outcome = { status: 'left', leftAtMs: at, reason }
  if (reason === 'patience') order.patience = { phase: 'expired', expiredAtMs: at }
  run.activeOrderIds = run.activeOrderIds.filter((id) => id !== order.id)
  if (run.selectedOrderId === order.id) run.selectedOrderId = run.activeOrderIds[0] ?? null
  releaseOrderMaterials(run, order.id, at)
  expireOrderAuthorizations(run, order.id, at)
  for (const task of Object.values(run.tasks)) {
    if (task.orderId === order.id && task.status === 'ready') run.tasks[task.id] = { ...task, status: 'unclaimed', unclaimedAtMs: at }
  }
}

function settle(run: Run, at: number): void {
  for (const order of run.orders) if (order.outcome.status === 'pending') leave(run, order, at, 'closing')
  for (const authorization of Object.values(run.authorizations)) {
    if (authorization.status === 'calibrated_pending_start') {
      if (!run.pendingReconciliationIntentIds.includes(authorization.id)) run.pendingReconciliationIntentIds.push(authorization.id)
    } else if (['confirmed', 'calibrating', 'failed'].includes(authorization.status)) {
      removePrinterReservation(run, authorization.id)
      run.authorizations[authorization.id] = { ...authorizationBase(authorization), status: 'expired_unprinted', expiredAtMs: at }
    }
  }
  const handoffs = run.orders.flatMap((order) => order.outcome.status === 'delivered' ? [order.outcome] : [])
    .sort((first, second) => first.deliveredAtMs - second.deliveredAtMs)
  let qualityStreak = 0
  let longestQualityStreak = 0
  for (const { evaluation } of handoffs) {
    qualityStreak = evaluation.satisfied && (evaluation.grade === 'A' || evaluation.grade === 'S') ? qualityStreak + 1 : 0
    longestQualityStreak = Math.max(longestQualityStreak, qualityStreak)
  }
  const delivered = handoffs.map(({ evaluation }) => evaluation)
  const satisfied = delivered.filter((evaluation) => evaluation.satisfied).length
  const left = run.orders.filter((order) => order.outcome.status === 'left').length
  const thresholds = run.stage.thresholds
  const failureReasons: ('deliveries' | 'satisfaction' | 'departures')[] = []
  const minDelivered = thresholds.kind === 'authored' ? thresholds.minDelivered : Math.ceil(run.orders.length * thresholds.minDeliveredRatio)
  if (delivered.length < minDelivered) failureReasons.push('deliveries')
  if (thresholds.kind === 'authored' ? satisfied < thresholds.minSatisfied : satisfied <= delivered.length * thresholds.satisfiedRatioExclusive) failureReasons.push('satisfaction')
  if (left > thresholds.maxLeft) failureReasons.push('departures')
  Object.assign(run, { status: 'settled', result: {
    shiftRunId: run.id, stageId: run.stage.id, day: run.stage.day, closedAtMs: at,
    delivered: delivered.length, satisfied, left, averageScore: delivered.length ? delivered.reduce((total, evaluation) => total + evaluation.score, 0) / delivered.length : 0,
    longestQualityStreak, passed: failureReasons.length === 0, failureReasons,
  } })
}

function patienceCrossing(order: CustomerOrder): number {
  const patience = order.patience
  if (patience.phase === 'last_wait') return patience.deadlineAtMs
  if (patience.phase === 'expired') return Infinity
  return patience.depletesAtMs
}

function advanceMutable(run: Run, nowMs: number): void {
  if (run.status !== 'running' || nowMs < run.lastProcessedAtMs) return
  const end = Math.min(nowMs, run.deadlineAtMs)
  while (true) {
    let next = end
    for (const order of run.orders) if (order.outcome.status === 'pending') {
      if (order.arrivalAtMs > run.lastProcessedAtMs) next = Math.min(next, order.arrivalAtMs)
      next = Math.min(next, patienceCrossing(order))
    }
    for (const authorization of Object.values(run.authorizations)) {
      if (authorization.status === 'calibrating') {
        const deadline = run.puzzles[authorization.puzzleId].deadlineAtMs
        // Equality remains open for a submission. Once the clock moves beyond it,
        // consume the timeout at its original event time, including after a boundary tick.
        if (deadline < end) next = Math.min(next, Math.max(run.lastProcessedAtMs, deadline))
      }
    }
    for (const machineId of machineIds) {
      const printer = run.printers[machineId]
      const task = printer.currentTaskId ? run.tasks[printer.currentTaskId] : undefined
      if (task?.status === 'printing') next = Math.min(next, task.completesAtMs)
      for (const until of Object.values(printer.orderLockUntilMs)) next = Math.min(next, until)
    }
    for (const order of run.orders) {
      if (order.outcome.status !== 'pending') continue
      const patience = order.patience
      // Future arrivals retain their full patience until their scheduled event.
      if (patience.phase === 'normal' && next >= patience.updatedAtMs) {
        const crossing = patienceCrossing(order)
        // The deadline is canonical; display values never feed a later recovery calculation.
        patience.remainingSeconds = rounded(Math.max(0, (patience.depletesAtMs - next) / 1000 * (order.position === 'active' ? 1 : 0.35)))
        patience.updatedAtMs = next
        if (crossing <= next) order.patience = { phase: 'last_wait', startedAtMs: next, deadlineAtMs: next + order.lastWaitSeconds * 1000, originalDurationSeconds: order.lastWaitSeconds }
      } else if (patience.phase === 'last_wait' && patience.deadlineAtMs <= next) leave(run, order, patience.deadlineAtMs, 'patience')
    }
    for (const authorization of Object.values(run.authorizations)) {
      if (authorization.status === 'calibrating' && run.puzzles[authorization.puzzleId].deadlineAtMs < end
        && run.puzzles[authorization.puzzleId].deadlineAtMs <= next) {
        failCalibration(run, authorization, run.puzzles[authorization.puzzleId].deadlineAtMs, 'timeout', null)
      }
    }
    finishDuePrinting(run, next)
    for (const machineId of machineIds) {
      const printer = run.printers[machineId]
      for (const [id, until] of Object.entries(printer.orderLockUntilMs)) if (until <= next) delete printer.orderLockUntilMs[id]
    }
    for (const authorization of Object.values(run.authorizations)) {
      if (authorization.status === 'failed' && authorization.machineLockUntilMs <= next) run.authorizations[authorization.id] = { ...authorizationBase(authorization), status: 'confirmed', machineId: authorization.machineId }
    }
    run.lastProcessedAtMs = next
    if (next === run.deadlineAtMs) { settle(run, next); break }
    if (next >= end) break
  }
}

/** Replays due transitions at their original event times, never at recovery time. */
export function advanceShift(state: ShiftRun, nowMs: number): ShiftRun {
  nowMs = shiftTimeAt(state, nowMs)
  if (state.status !== 'running' || nowMs < state.lastProcessedAtMs) return state
  const run = clone(state)
  advanceMutable(run, nowMs)
  return run
}

function shiftLiveClocks(run: Run, delta: number, at: number): void {
  run.deadlineAtMs += delta
  for (const order of run.orders) {
    if (order.outcome.status !== 'pending') continue
    if (order.arrivalAtMs > at) order.arrivalAtMs += delta
    if (order.patience.phase === 'normal') {
      order.patience.updatedAtMs += delta
      order.patience.depletesAtMs += delta
    }
    if (order.patience.phase === 'last_wait') {
      order.patience.startedAtMs += delta
      order.patience.deadlineAtMs += delta
    }
  }
  for (const machineId of machineIds) {
    const printer = run.printers[machineId]
    for (const [id, until] of Object.entries(printer.orderLockUntilMs)) if (until > at) printer.orderLockUntilMs[id] += delta
    for (const reservation of printer.reservations) if (reservation.status === 'calibrating') reservation.deadlineAtMs += delta
  }
  for (const puzzle of Object.values(run.puzzles)) if (puzzle.result.status === 'pending') { puzzle.startedAtMs += delta; puzzle.deadlineAtMs += delta }
  for (const task of Object.values(run.tasks)) if (task.status === 'printing') { task.startedAtMs += delta; task.completesAtMs += delta }
  for (const authorization of Object.values(run.authorizations)) if (authorization.status === 'failed' && authorization.machineLockUntilMs > at) authorization.machineLockUntilMs += delta
  refreshEstimates(run)
}

function newDraft(run: Run, orderId: string): ProductionDraft {
  return { id: `${run.id}:draft:${orderId}:1`, shiftRunId: run.id, orderId, revision: 1, derivedFromSnapshotId: null,
    design: { version: 1, preparation: { paperId: null, paperMaterialId: null, shapeId: null, orientation: 'landscape', layoutId: null, surfaceFinishId: 'matte' }, elements: [], crafts: [] },
    stage: 'not_started', reservationIds: [], inspections: [] }
}

function liveDraft(run: Run, id: string): Mutable<ProductionDraft> | undefined {
  const draft = run.drafts[id]
  const order = run.orders.find((order) => order.id === draft?.orderId)
  return order?.position === 'active' && order.outcome.status === 'pending' ? draft : undefined
}

function editDraft(run: Run, draft: Mutable<ProductionDraft>): Mutable<ProductionDraft> {
  const revision = Math.max(...Object.values(run.drafts).filter((entry) => entry.orderId === draft.orderId).map((entry) => entry.revision)) + 1
  if (draft.stage === 'archived') {
    const { snapshotId, stage: _stage, ...base } = draft
    const derived: Mutable<ProductionDraft> = { ...clone(base), id: `${run.id}:draft:${draft.orderId}:${revision}`, revision,
      derivedFromSnapshotId: snapshotId, reservationIds: [], stage: 'preparing' }
    run.drafts[derived.id] = derived
    return derived
  }
  draft.revision = revision
  return draft
}

function releaseReservations(run: Run, draftId: string, operationId: string | undefined, at: number): void {
  for (const reservation of Object.values(run.materials.reservations)) {
    if (reservation.draftId !== draftId || (operationId !== undefined && reservation.operationId !== operationId) || reservation.status !== 'reserved') continue
    const stock = run.materials.stock[reservation.materialId]
    stock.available += reservation.quantity
    stock.reserved -= reservation.quantity
    run.materials.reservations[reservation.id] = { ...reservation, status: 'released', releasedAtMs: at }
  }
}

function reopenAssembly(run: Run, draft: Mutable<ProductionDraft>, at: number): Mutable<ProductionDraft> {
  if (draft.stage === 'crafting' && draft.activeCraft) releaseReservations(run, draft.id, draft.activeCraft.operationId, at)
  const { activeCraft: _activeCraft, ...base } = { ...draft, activeCraft: null }
  return { ...base, stage: 'assembling' }
}

/** A selected premium finish becomes real only after one matching, paid craft operation. */
export function hasCompletedSurfaceFinish(run: ShiftRun, draft: ProductionDraft): boolean {
  const finish = SURFACE_FINISHES.find((item) => item.id === draft.design.preparation.surfaceFinishId)
  if (!finish) return false
  if (!finish.materialCosts.length) return true
  const kind = finish.id === 'foil' ? 'foil' : finish.id === 'wax' ? 'wax' : 'stamp'
  return draft.design.crafts.some((craft) => craft.kind === kind && finish.materialCosts.every((cost) =>
    Object.values(run.materials.reservations).filter((reservation) => reservation.status === 'consumed'
      && reservation.operationId === craft.id && reservation.materialId === cost.materialId
      && run.drafts[reservation.draftId]?.orderId === draft.orderId)
      .reduce((quantity, reservation) => quantity + reservation.quantity, 0) >= cost.quantity))
}

function validPreparation(selection: PreparationSelection): boolean {
  return (selection.paperId === null || PAPERS.some((paper) => paper.id === selection.paperId))
    && (selection.paperMaterialId === null || PAPERS.some((paper) => paper.materialId === selection.paperMaterialId))
    && (selection.shapeId === null || SHAPES.some((shape) => shape.id === selection.shapeId))
    && (selection.orientation === 'landscape' || selection.orientation === 'portrait')
    && (selection.layoutId === null || LAYOUTS.some((layout) => layout.id === selection.layoutId))
    && SURFACE_FINISHES.some((finish) => finish.id === selection.surfaceFinishId)
}

function reserve(run: Run, draft: Mutable<ProductionDraft>, operationId: string, costs: readonly MaterialCost[], at: number): boolean {
  releaseReservations(run, draft.id, operationId, at)
  const demand = new Map<MaterialCost['materialId'], number>()
  for (const cost of costs) demand.set(cost.materialId, (demand.get(cost.materialId) ?? 0) + cost.quantity)
  if ([...demand].some(([id, quantity]) => run.materials.stock[id].available < quantity)) return false
  for (const [materialId, quantity] of demand) {
    const id = `${draft.id}:material:${Object.keys(run.materials.reservations).length + 1}`
    const stock = run.materials.stock[materialId]
    stock.available -= quantity
    stock.reserved += quantity
    run.materials.reservations[id] = { id, materialId, quantity, draftId: draft.id, draftRevision: draft.revision,
      consumeOn: MATERIALS.find((material) => material.id === materialId)!.consumeOn, operationId, reservedAtMs: at, status: 'reserved' }
    draft.reservationIds.push(id)
  }
  return true
}

function consume(run: Run, draft: ProductionDraft, trigger: ConsumptionTrigger, at: number, operationId?: string): void {
  for (const reservation of Object.values(run.materials.reservations)) {
    if (reservation.draftId !== draft.id || reservation.status !== 'reserved' || reservation.consumeOn !== trigger
      || (operationId !== undefined && reservation.operationId !== operationId)) continue
    const stock = run.materials.stock[reservation.materialId]
    stock.reserved -= reservation.quantity
    stock.consumed += reservation.quantity
    run.materials.reservations[reservation.id] = { ...reservation, status: 'consumed', consumedAtMs: at }
  }
}

function snapshotOf(run: Run, draft: ProductionDraft, id: string, at: number): ShiftCardSnapshot {
  return clone({ kind: 'production-card', version: 1, id, shiftRunId: run.id, orderId: draft.orderId,
    draftId: draft.id, draftRevision: draft.revision, savedAtMs: at, design: draft.design })
}

const elementCatalogs: Record<ElementKind, readonly CatalogItem[]> = { motif: MOTIFS, decoration: DECORATIONS, border: BORDERS, 'word-stamp': WORD_STAMPS }

function authorizationBase(authorization: PrintAuthorization) {
  const { id, shiftRunId, orderId, snapshotId, confirmedAtMs, nextAttempt } = authorization
  return { id, shiftRunId, orderId, snapshotId, confirmedAtMs, nextAttempt }
}

function removePrinterReservation(run: Run, intentId: string): void {
  for (const machineId of machineIds) run.printers[machineId].reservations = run.printers[machineId].reservations.filter((reservation) => reservation.intentId !== intentId)
}

function failCalibration(run: Run, authorization: Extract<PrintAuthorization, { status: 'calibrating' }>, at: number, reason: 'wrong' | 'timeout' | 'exit', answer: PuzzleAnswer | null): void {
  // Capacity is released in the same transaction before the order-machine lock is installed.
  removePrinterReservation(run, authorization.id)
  run.puzzles[authorization.puzzleId].result = { status: 'failed', failedAtMs: at, reason, answer: clone(answer) }
  const machineLockUntilMs = at + 30_000
  run.printers[authorization.machineId].orderLockUntilMs[authorization.orderId] = machineLockUntilMs
  run.authorizations[authorization.id] = { ...authorizationBase(authorization), status: 'failed', machineId: authorization.machineId, machineLockUntilMs, puzzleId: authorization.puzzleId }
}

function refreshEstimates(run: Run): void {
  for (const machineId of machineIds) {
    const printer = run.printers[machineId]
    const current = printer.currentTaskId ? run.tasks[printer.currentTaskId] : undefined
    printer.estimatedFreeAtMs = current?.status === 'printing'
      ? current.completesAtMs + printer.queuedTaskIds.reduce((sum, id) => sum + run.tasks[id].durationMs, 0) : null
  }
}

function startNextTask(run: Run, machineId: MachineId, at: number): void {
  const printer = run.printers[machineId]
  if (printer.currentTaskId || !printer.queuedTaskIds.length) return
  const id = printer.queuedTaskIds.shift()!
  const task = run.tasks[id]
  // A queued task, including a late reconciled receipt, cannot start before creation.
  const startedAtMs = Math.max(at, task.createdAtMs)
  run.tasks[id] = { ...task, status: 'printing', startedAtMs, completesAtMs: startedAtMs + task.durationMs }
  printer.currentTaskId = id
}

function finishDuePrinting(run: Run, at: number): void {
  for (const machineId of machineIds) {
    const printer = run.printers[machineId]
    while (printer.currentTaskId) {
      const task = run.tasks[printer.currentTaskId]
      if (task.status !== 'printing' || task.completesAtMs > at) break
      const customer = run.orders.find((order) => order.id === task.orderId)
      run.tasks[task.id] = customer?.outcome.status === 'pending'
        ? { ...task, status: 'ready', readyAtMs: task.completesAtMs }
        : { ...task, status: 'unclaimed', readyAtMs: task.completesAtMs, unclaimedAtMs: task.completesAtMs }
      printer.currentTaskId = null
      startNextTask(run, machineId, task.completesAtMs)
    }
  }
  refreshEstimates(run)
}

function recordReceipt(run: Run, receipt: PrintReceipt, at: number): void {
  const authorization = run.authorizations[receipt.intentId]
  if (!authorization || authorization.status !== 'calibrated_pending_start'
    || receipt.shiftRunId !== run.id || receipt.shiftRunId !== authorization.shiftRunId
    || receipt.snapshotId !== authorization.snapshotId || receipt.machineId !== authorization.machineId) return
  const printer = run.printers[authorization.machineId]
  const reservation = printer.reservations.find((reservation) => reservation.id === authorization.reservationId
    && reservation.intentId === authorization.id && reservation.orderId === authorization.orderId
    && reservation.shiftRunId === run.id && reservation.machineId === authorization.machineId
    && reservation.puzzleId === authorization.puzzleId && reservation.status === 'calibrated_pending_start')
  if (!reservation) return
  removePrinterReservation(run, authorization.id)
  run.pendingReconciliationIntentIds = run.pendingReconciliationIntentIds.filter((id) => id !== authorization.id)
  if (receipt.status === 'rejected') {
    run.authorizations[authorization.id] = { ...authorizationBase(authorization), status: 'rejected', machineId: authorization.machineId, receipt: clone(receipt) }
    return
  }
  const existing = run.tasks[receipt.taskId]
  if (existing && (existing.intentId !== authorization.id || existing.snapshotId !== authorization.snapshotId
    || existing.orderId !== authorization.orderId || existing.shiftRunId !== run.id || existing.machineId !== authorization.machineId)) {
    // This is a local integrity failure, not a refusal claimed on behalf of the
    // print service. Preserve its complete accepted receipt for investigation.
    run.authorizations[authorization.id] = { ...authorizationBase(authorization), status: 'rejected', machineId: authorization.machineId,
      receipt: { receiptId: `${receipt.receiptId}:task-id-conflict`, intentId: receipt.intentId, snapshotId: receipt.snapshotId,
        machineId: receipt.machineId, shiftRunId: receipt.shiftRunId, receivedAtMs: at, authority: 'local', status: 'rejected',
        reasonCode: 'task-id-conflict', message: 'Local integrity failure: the accepted task ID belongs to different print context.',
        details: { originalReceipt: clone(receipt), existingTask: clone(existing) } } }
    if (run.status !== 'settled') settle(run, at)
    if (run.status === 'settled') {
      run.result.passed = false
      if (!run.result.failureReasons.includes('corrupt-save')) run.result.failureReasons.push('corrupt-save')
    }
    return
  }
  run.authorizations[authorization.id] = { ...authorizationBase(authorization), status: 'bound', machineId: authorization.machineId, taskId: receipt.taskId, receipt: clone(receipt) }
  if (existing) return
  const customer = run.orders.find((order) => order.id === authorization.orderId)!
  const durationMs = (authorization.machineId === 'quick' ? (isComplexOrder(customer.content) ? 60 : 45) : (isComplexOrder(customer.content) ? 85 : 65)) * 1000
  run.tasks[receipt.taskId] = { id: receipt.taskId, intentId: authorization.id, snapshotId: authorization.snapshotId,
    orderId: authorization.orderId, shiftRunId: run.id, machineId: authorization.machineId, createdAtMs: at, durationMs, expedited: false, status: 'queued' }
  printer.queuedTaskIds.push(receipt.taskId)
  startNextTask(run, authorization.machineId, at)
  refreshEstimates(run)
}

/** Explicit night-time fast-forward, after the settlement screen. Pending receipts remain reconcilable. */
export function finishClosedShiftPrints(state: ShiftRun): ShiftRun {
  if (state.status !== 'settled') return state
  const run = clone(state)
  while (true) {
    const events = Object.values(run.tasks).flatMap((task) => task.status === 'printing' ? [task.completesAtMs] : [])
    if (!events.length) break
    const next = Math.min(...events)
    finishDuePrinting(run, next)
    run.lastProcessedAtMs = Math.max(run.lastProcessedAtMs, next)
  }
  return run
}

/** One immutable, serializable domain transaction. Rejected actions still account for elapsed time. */
export function transitionShift(state: ShiftRun, action: ShiftEngineAction, nowMs: number, puzzleServices?: ShiftPuzzleServices): ShiftRun {
  if (!Number.isFinite(nowMs)) throw new RangeError('Invalid clock')
  if (action.type === 'advance-time') return advanceShift(state, action.nowMs)
  nowMs = shiftTimeAt(state, nowMs)
  if (state.status === 'paused') {
    if ((action.type !== 'resume' && action.type !== 'dismiss-tutorial') || nowMs < state.pause.startedAtMs) return state
    if (action.type === 'dismiss-tutorial' && (state.pause.reason !== 'tutorial' || state.stage.id !== 'tutorial'
      || action.trigger !== TUTORIAL_STATION_TRIGGERS[state.station])) return state
    const run = clone(state)
    if (action.type === 'dismiss-tutorial' && !run.seenTutorialTriggers.includes(action.trigger)) run.seenTutorialTriggers.push(action.trigger)
    const delta = nowMs - state.pause.startedAtMs
    shiftLiveClocks(run, delta, state.pause.startedAtMs)
    run.pauses.push({ ...state.pause, endedAtMs: nowMs })
    delete (run as Partial<typeof run>).pause
    Object.assign(run, { status: 'running', lastProcessedAtMs: nowMs })
    return run as ShiftRun
  }
  const current = clone(state)
  advanceMutable(current, nowMs)
  const run = clone(current)
  if (run.status !== 'running') {
    if (run.status === 'settled' && action.type === 'record-receipt') recordReceipt(run, action.receipt, Math.max(nowMs, run.lastProcessedAtMs))
    return run
  }
  const at = run.lastProcessedAtMs
  switch (action.type) {
    case 'pause':
      if (['story', 'tutorial', 'settlement'].includes(action.reason)) Object.assign(run, { status: 'paused', pause: { reason: action.reason, startedAtMs: at } })
      break
    case 'resume':
    case 'dismiss-tutorial': break
    case 'close-shift':
      if (run.orders.every((order) => order.outcome.status !== 'pending')) settle(run, at)
      break
    case 'accept-order': {
      const order = run.orders.find((order) => order.id === action.orderId)
      if (!order || order.arrivalAtMs > at || order.outcome.status !== 'pending' || order.position !== 'door_waiting' || run.activeOrderIds.length >= 3) break
      for (const authorization of Object.values(run.authorizations)) {
        if (authorization.status === 'calibrating' && authorization.orderId !== order.id) failCalibration(run, authorization, at, 'exit', null)
      }
      order.position = 'active'
      order.acceptedAtMs = at
      if (order.patience.phase === 'normal') order.patience.depletesAtMs = at + (order.patience.depletesAtMs - at) * 0.35
      run.activeOrderIds.push(order.id)
      run.selectedOrderId = order.id
      const draft = newDraft(run, order.id)
      run.drafts[draft.id] = clone(draft)
      break
    }
    case 'switch-station':
      if (action.station !== 'print') for (const authorization of Object.values(run.authorizations)) {
        if (authorization.status === 'calibrating') failCalibration(run, authorization, at, 'exit', null)
      }
      run.station = action.station
      break
    case 'select-order':
      if (run.activeOrderIds.includes(action.orderId)) {
        for (const authorization of Object.values(run.authorizations)) {
          if (authorization.status === 'calibrating' && authorization.orderId !== action.orderId) failCalibration(run, authorization, at, 'exit', null)
        }
        run.selectedOrderId = action.orderId
      }
      break
    case 'explain-progress': {
      const order = run.orders.find((order) => order.id === action.orderId)
      if (!order || order.arrivalAtMs > at || order.outcome.status !== 'pending' || order.remedy !== 'none' || !run.remedies.explainProgressAvailable) break
      order.remedy = 'explain-progress'
      run.remedies.explainProgressAvailable = false
      if (order.patience.phase === 'normal') {
        order.patience.depletesAtMs += 25_000
        order.patience.remainingSeconds = rounded((order.patience.depletesAtMs - at) / 1000 * (order.position === 'active' ? 1 : 0.35))
        order.patience.updatedAtMs = at
      } else if (order.patience.phase === 'last_wait') order.patience.deadlineAtMs += 25_000
      break
    }
    case 'select-preparation': {
      const source = liveDraft(run, action.draftId)
      if (!source) break
      const previous = source.design.preparation
      const selection = { ...previous, ...action.selection }
      if ('paperId' in action.selection && !('paperMaterialId' in action.selection)) selection.paperMaterialId = PAPERS.find((paper) => paper.id === selection.paperId)?.materialId ?? null
      if (!validPreparation(selection)) return current
      const afterCut = source.stage === 'assembling' || source.stage === 'crafting' || source.stage === 'archived'
      const replaceBlank = afterCut && ['paperId', 'paperMaterialId', 'shapeId', 'orientation'].some((field) => field in action.selection)
      const draft = editDraft(run, source)
      // Replacement pays for the whole new blank; consumed stock stays spent.
      // Failed reservations return the untouched action input below.
      if (replaceBlank) releaseReservations(run, draft.id, undefined, at)
      if (replaceBlank || 'paperId' in action.selection || 'paperMaterialId' in action.selection) {
        const costs: MaterialCost[] = selection.paperMaterialId === 'pearl' ? [{ materialId: 'pearl-paper', quantity: 1 }]
          : selection.paperMaterialId === 'linen' ? [{ materialId: 'linen-paper', quantity: 1 }] : []
        if (!reserve(run, draft, 'paper', costs, at)) return current
      }
      if ((replaceBlank || 'shapeId' in action.selection)
        && !reserve(run, draft, 'shape', SHAPES.find((shape) => shape.id === selection.shapeId)?.materialCosts ?? [], at)) return current
      draft.design.preparation = selection
      const { activeCraft, ...base } = { ...draft, activeCraft: draft.stage === 'crafting' ? draft.activeCraft : null }
      if (replaceBlank || !afterCut) {
        if (replaceBlank) { draft.design.elements = []; draft.design.crafts = [] }
        run.drafts[draft.id] = { ...base, stage: 'preparing' }
      } else if (selection.layoutId !== previous.layoutId) {
        releaseReservations(run, draft.id, undefined, at)
        draft.design.elements = []
        draft.design.crafts = []
        run.drafts[draft.id] = { ...base, stage: 'assembling' }
      } else {
        let retainedCraft = activeCraft
        if (selection.surfaceFinishId !== previous.surfaceFinishId) {
          const affectedKinds = SURFACE_FINISHES.filter((finish) => finish.materialCosts.length
            && (finish.id === previous.surfaceFinishId || finish.id === selection.surfaceFinishId))
            .map((finish) => finish.id === 'foil' ? 'foil' : finish.id === 'wax' ? 'wax' : 'stamp')
          const affected = (craft: { requirementId: string; kind: string }) => craft.requirementId === 'surface-finish' || affectedKinds.some((kind) => kind === craft.kind)
          draft.design.crafts = draft.design.crafts.filter((craft) => !affected(craft))
          if (retainedCraft && affected(retainedCraft)) {
            releaseReservations(run, draft.id, retainedCraft.operationId, at)
            retainedCraft = null
          }
        }
        run.drafts[draft.id] = source.stage === 'assembling' ? { ...base, stage: 'assembling' }
          : { ...base, stage: 'crafting', activeCraft: retainedCraft }
      }
      break
    }
    case 'cut-blank': {
      const source = liveDraft(run, action.draftId)
      if (!source || source.stage !== 'preparing') break
      const selection = source.design.preparation
      if (!validPreparation(selection) || selection.paperId === null || selection.paperMaterialId === null || selection.shapeId === null || selection.layoutId === null) break
      consume(run, source, 'cut-blank', at)
      run.drafts[source.id] = { ...source, stage: 'assembling' }
      break
    }
    case 'place-element': {
      const source = liveDraft(run, action.draftId)
      const asset = elementCatalogs[action.element.kind].find((asset) => asset.id === action.element.assetId)
      if (!source || !asset) break
      const draft = editDraft(run, source)
      if (!reserve(run, draft, `element:${action.element.id}`, asset.materialCosts, at)) return current
      draft.design.elements = [...draft.design.elements.filter((element) => element.id !== action.element.id), clone(action.element)]
      run.drafts[draft.id] = reopenAssembly(run, draft, at)
      break
    }
    case 'remove-element': {
      const source = liveDraft(run, action.draftId)
      if (!source || !source.design.elements.some((element) => element.id === action.elementId)) break
      const draft = editDraft(run, source)
      releaseReservations(run, draft.id, `element:${action.elementId}`, at)
      draft.design.elements = draft.design.elements.filter((element) => element.id !== action.elementId)
      run.drafts[draft.id] = reopenAssembly(run, draft, at)
      break
    }
    case 'fix-assembly': {
      const source = liveDraft(run, action.draftId)
      if (!source || source.stage === 'archived') break
      consume(run, source, 'fix-assembly', at)
      run.drafts[source.id] = { ...source, stage: 'crafting', activeCraft: null }
      break
    }
    case 'select-craft': {
      const source = liveDraft(run, action.draftId)
      if (!source) break
      const order = run.orders.find((order) => order.id === source.orderId)!
      const requirement = order.content.requirements.crafts.find((craft) => craft.id === action.craftId)
      const finish = SURFACE_FINISHES.find((finish) => finish.id === source.design.preparation.surfaceFinishId)!
      const finishKind = finish.id === 'foil' ? 'foil' : finish.id === 'wax' ? 'wax' : 'stamp'
      if (!requirement && (action.craftId !== 'surface-finish' || !finish.materialCosts.length)) break
      if (Object.values(run.materials.reservations).some((reservation) => reservation.operationId === action.operationId && reservation.draftId === source.id)
        || source.design.crafts.some((craft) => craft.id === action.operationId)) break
      const draft = editDraft(run, source)
      if (draft.stage === 'crafting' && draft.activeCraft) releaseReservations(run, draft.id, draft.activeCraft.operationId, at)
      const costs = [...(requirement?.materialCosts ?? [])]
      const kind = requirement?.kind ?? finishKind
      if (kind === finishKind) for (const cost of finish.materialCosts) if (!costs.some((existing) => existing.materialId === cost.materialId)) costs.push(cost)
      if (!reserve(run, draft, action.operationId, costs, at)) return current
      run.drafts[draft.id] = { ...draft, stage: 'crafting', activeCraft: {
        status: 'selected', operationId: action.operationId, requirementId: action.craftId, kind, discrete: clone(action.discrete),
        reservationIds: draft.reservationIds.filter((id) => run.materials.reservations[id].operationId === action.operationId),
        progress: { measurements: {}, completedSteps: [], coverageCells: [], trace: [] },
      } }
      break
    }
    case 'begin-craft':
    case 'cancel-craft':
    case 'update-craft':
    case 'finish-craft': {
      const draft = liveDraft(run, action.draftId)
      if (!draft || draft.stage !== 'crafting' || !draft.activeCraft || draft.activeCraft.requirementId !== action.craftId) break
      const operation = draft.activeCraft
      if (action.type === 'cancel-craft') {
        releaseReservations(run, draft.id, operation.operationId, at)
        draft.activeCraft = null
        draft.revision++
      } else if (action.type === 'begin-craft' && operation.status === 'selected') {
        consume(run, draft, 'first-craft-action', at, operation.operationId)
        draft.activeCraft = { ...operation, status: 'in_progress', startedAtMs: at, irreversibleActionAtMs: at }
        draft.revision++
      } else if (action.type === 'update-craft' && operation.status === 'in_progress') {
        operation.progress = clone(action.progress)
        draft.revision++
      } else if (action.type === 'finish-craft' && operation.status === 'in_progress') {
        draft.design.crafts.push({ id: operation.operationId, requirementId: operation.requirementId, kind: operation.kind,
          measurements: clone(action.measurements), discrete: clone(action.discrete), completedAtMs: at })
        draft.activeCraft = null
        draft.revision++
      }
      break
    }
    case 'archive': {
      const draft = liveDraft(run, action.draftId)
      if (!draft || draft.stage === 'archived' || run.snapshots[action.snapshotId]
        || (draft.stage === 'crafting' && draft.activeCraft)
        || !hasCompletedSurfaceFinish(run, draft)
        || draft.reservationIds.some((id) => run.materials.reservations[id]?.status === 'reserved')) break
      run.snapshots[action.snapshotId] = clone(snapshotOf(run, draft, action.snapshotId, at))
      run.snapshotIds.push(action.snapshotId)
      run.drafts[draft.id] = { ...draft, stage: 'archived', snapshotId: action.snapshotId }
      break
    }
    case 'inspect': {
      const draft = liveDraft(run, action.draftId)
      if (!draft || (action.freeDemo ? run.freeDemoInspectionsRemaining : run.inspectionsRemaining) <= 0) break
      const customer = run.orders.find((order) => order.id === draft.orderId)!
      const evaluation = evaluateOrder(customer.content, snapshotOf(run, draft, 'inspection', at), {
        machineId: 'fine', patience: { phase: 'normal', initialSeconds: customer.basePatienceSeconds, remainingSeconds: customer.basePatienceSeconds },
      })
      draft.inspections.push({ id: `${draft.id}:inspection:${draft.inspections.length + 1}`, draftRevision: draft.revision, checkedAtMs: at,
        freeDemo: action.freeDemo, issues: evaluation.issues.map((issue) => ({ code: issue.code, label: issue.code, ...('elementId' in issue ? { elementId: issue.elementId } : {}) })) })
      if (action.freeDemo) run.freeDemoInspectionsRemaining--
      else run.inspectionsRemaining--
      // Persist the cost so the next wall-clock tick continues from the advanced
      // logical time, including after reload. Event deadlines remain canonical.
      run.inspectionTimeOffsetMs = (run.inspectionTimeOffsetMs ?? 0) + 5000
      advanceMutable(run, at + 5000)
      break
    }
    case 'confirm-print': {
      const snapshot = run.snapshots[action.snapshotId]
      const customer = run.orders.find((order) => order.id === snapshot?.orderId)
      const printer = run.printers[action.machineId]
      if (!snapshot || snapshot.shiftRunId !== run.id || customer?.outcome.status !== 'pending' || run.authorizations[action.intentId]
        || printer.orderLockUntilMs[customer.id] > at
        || Number(Boolean(printer.currentTaskId)) + printer.queuedTaskIds.length + printer.reservations.length >= 3) break
      run.authorizations[action.intentId] = { id: action.intentId, shiftRunId: run.id, orderId: snapshot.orderId, snapshotId: snapshot.id,
        confirmedAtMs: at, nextAttempt: 1, status: 'confirmed', machineId: action.machineId }
      break
    }
    case 'begin-calibration': {
      if (!puzzleServices) break
      let authorization = run.authorizations[action.intentId]
      // A confirmation save may finish after the player has moved to another ticket or station.
      if (!authorization || run.station !== 'print' || run.selectedOrderId !== authorization.orderId) break
      if (authorization?.status === 'calibrating' && authorization.machineId !== action.machineId) {
        failCalibration(run, authorization, at, 'exit', null)
        authorization = run.authorizations[action.intentId]
      }
      if (!authorization || (authorization.status !== 'confirmed' && authorization.status !== 'failed')
        || (authorization.nextAttempt === 1 && authorization.machineId !== action.machineId)) break
      const customer = run.orders.find((order) => order.id === authorization.orderId)
      const printer = run.printers[action.machineId]
      if (customer?.outcome.status !== 'pending' || printer.orderLockUntilMs[authorization.orderId] > at
        || Number(Boolean(printer.currentTaskId)) + printer.queuedTaskIds.length + printer.reservations.length >= 3) break
      const calibrationPlan = run.stage.customers.find((scheduled) => scheduled.id === authorization.orderId)?.calibrationPlan
      const puzzle = puzzleServices.createPuzzle({ difficulty: run.stage.kind === 'survival' ? run.stage.hardPuzzleWeight : run.stage.puzzleDifficulty ?? 0,
        calibrationKind: calibrationPlan?.[action.machineId],
        shiftSeed: run.seed, shiftRunId: run.id, orderId: authorization.orderId,
        intentId: authorization.id, machineId: action.machineId, attempt: authorization.nextAttempt, startedAtMs: at })
      if (run.puzzles[puzzle.id] || puzzle.shiftRunId !== run.id || puzzle.orderId !== authorization.orderId || puzzle.intentId !== authorization.id
        || puzzle.machineId !== action.machineId || puzzle.attempt !== authorization.nextAttempt || puzzle.startedAtMs !== at
        || !Number.isFinite(puzzle.deadlineAtMs) || puzzle.deadlineAtMs <= at || puzzle.result.status !== 'pending'
        || !validatePublicPuzzleDefinition(puzzle.definition).valid) break
      const reservationId = `${authorization.id}:reservation:${puzzle.attempt}`
      run.puzzles[puzzle.id] = clone(puzzle)
      printer.reservations.push({ id: reservationId, intentId: authorization.id, orderId: authorization.orderId, shiftRunId: run.id,
        machineId: action.machineId, puzzleId: puzzle.id, status: 'calibrating', deadlineAtMs: puzzle.deadlineAtMs })
      run.authorizations[authorization.id] = { ...authorizationBase(authorization), nextAttempt: authorization.nextAttempt + 1,
        status: 'calibrating', machineId: action.machineId, attempt: puzzle.attempt, reservationId, puzzleId: puzzle.id }
      run.station = 'print'
      break
    }
    case 'submit-puzzle':
    case 'exit-puzzle': {
      const puzzle = run.puzzles[action.puzzleId]
      const authorization = puzzle ? run.authorizations[puzzle.intentId] : undefined
      if (!puzzle || puzzle.result.status !== 'pending' || !authorization || authorization.status !== 'calibrating'
        || authorization.puzzleId !== puzzle.id || authorization.orderId !== puzzle.orderId || authorization.shiftRunId !== puzzle.shiftRunId
        || authorization.machineId !== puzzle.machineId || authorization.attempt !== puzzle.attempt) break
      const reservation = run.printers[authorization.machineId].reservations.find((reservation) => reservation.id === authorization.reservationId
        && reservation.intentId === authorization.id && reservation.orderId === authorization.orderId && reservation.shiftRunId === run.id
        && reservation.machineId === authorization.machineId && reservation.puzzleId === puzzle.id && reservation.status === 'calibrating')
      if (!reservation) break
      if (action.type === 'exit-puzzle') { failCalibration(run, authorization, at, 'exit', null); break }
      if (!puzzleServices) break
      const result = puzzleServices.gradePuzzle(puzzle, action.answer, at)
      if (result.status === 'failed') failCalibration(run, authorization, result.failedAtMs, result.reason, result.answer)
      else if (result.status === 'succeeded') {
        puzzle.result = clone(result)
        // The grading time is authoritative; the response can arrive on a later clock tick.
        const calibratedAtMs = result.submittedAtMs
        run.authorizations[authorization.id] = { ...authorizationBase(authorization), status: 'calibrated_pending_start', machineId: authorization.machineId,
          reservationId: reservation.id, puzzleId: puzzle.id, calibratedAtMs }
        const printer = run.printers[authorization.machineId]
        printer.reservations = printer.reservations.map((entry) => entry.id === reservation.id
          ? { id: entry.id, intentId: entry.intentId, orderId: entry.orderId, shiftRunId: entry.shiftRunId, machineId: entry.machineId, puzzleId: entry.puzzleId,
            status: 'calibrated_pending_start', calibratedAtMs } : entry)
      }
      break
    }
    case 'record-receipt': recordReceipt(run, action.receipt, at); break
    case 'reorder-queue': {
      const printer = run.printers[action.machineId]
      if (action.taskIds.length !== printer.queuedTaskIds.length || new Set(action.taskIds).size !== action.taskIds.length
        || action.taskIds.some((id) => !printer.queuedTaskIds.includes(id) || run.tasks[id].machineId !== action.machineId)) break
      printer.queuedTaskIds = [...action.taskIds]
      refreshEstimates(run)
      break
    }
    case 'expedite': {
      const task = run.tasks[action.taskId]
      const customer = run.orders.find((order) => order.id === task?.orderId)
      const authorization = task ? run.authorizations[task.intentId] : undefined
      if (!task || !customer || customer.outcome.status !== 'pending' || customer.remedy !== 'none' || !run.remedies.expediteAvailable
        || !authorization || authorization.status !== 'bound' || authorization.taskId !== task.id || !['queued', 'printing'].includes(task.status)) break
      const printer = run.printers[task.machineId]
      if (task.status === 'queued') {
        task.durationMs /= 2
        printer.queuedTaskIds = [task.id, ...printer.queuedTaskIds.filter((id) => id !== task.id)]
      } else if (task.status === 'printing') {
        task.completesAtMs = at + (task.completesAtMs - at) / 2
        task.durationMs = task.completesAtMs - task.startedAtMs
      }
      task.expedited = true
      customer.remedy = 'expedite'
      run.remedies.expediteAvailable = false
      refreshEstimates(run)
      break
    }
    case 'deliver': {
      const task = run.tasks[action.taskId]
      const customer = run.orders.find((order) => order.id === task?.orderId)
      const snapshot = task ? run.snapshots[task.snapshotId] : undefined
      const authorization = task ? run.authorizations[task.intentId] : undefined
      if (!task || task.status !== 'ready' || !customer || customer.outcome.status !== 'pending' || customer.patience.phase === 'expired'
        || !snapshot || snapshot.orderId !== customer.id || snapshot.shiftRunId !== run.id || task.shiftRunId !== run.id
        || !authorization || authorization.status !== 'bound' || authorization.taskId !== task.id || authorization.orderId !== customer.id) break
      const patience = customer.patience
      const evaluation = evaluateOrder(customer.content, snapshot, { machineId: task.machineId, patience: patience.phase === 'normal'
        ? { phase: 'normal', remainingSeconds: patience.remainingSeconds, initialSeconds: customer.basePatienceSeconds }
        : { phase: 'last_wait', elapsedSeconds: (at - patience.startedAtMs) / 1000, originalDurationSeconds: patience.originalDurationSeconds } })
      customer.outcome = { status: 'delivered', taskId: task.id, deliveredAtMs: at, evaluation: clone(evaluation) }
      customer.position = 'closed'
      run.activeOrderIds = run.activeOrderIds.filter((id) => id !== customer.id)
      if (run.selectedOrderId === customer.id) run.selectedOrderId = run.activeOrderIds[0] ?? null
      releaseOrderMaterials(run, customer.id, at)
      expireOrderAuthorizations(run, customer.id, at)
      run.tasks[task.id] = { ...task, status: 'delivered', deliveredAtMs: at }
      for (const other of Object.values(run.tasks)) if (other.orderId === customer.id && other.status === 'ready') run.tasks[other.id] = { ...other, status: 'unclaimed', unclaimedAtMs: at }
      break
    }
    default: {
      // Compile-time exhaustiveness; stale or untyped external actions are inert.
      const unsupportedAction: never = action
      void unsupportedAction
    }
  }
  return run
}
