import { assertPrintIntentMatches, toShiftPrintReceipt, type PrintShopGateway } from '../domain/gateways'
import { findProductionAsset, MATERIALS, SURFACE_FINISHES } from '../content/production'
import { validatePublicPuzzleDefinition } from '../domain/puzzle-public'
import { OFFICIAL_CHARACTER_IDS, TUTORIAL_STATION_TRIGGERS, type PrintReceipt, type ShiftCardSnapshot, type ShiftProgression, type ShiftResult, type ShiftSnapshot, type TutorialTrigger, type WorkshopDraft } from '../domain/shift-types'
import { migrateLegacyCustomerSnapshot, migrateLegacyWorkshopCustomer } from './legacy-customers'
import { examStorage, ExamShiftCoordinator, hasExamSession } from './exam-session'

export const SHIFT_STORE_KEYS = Object.freeze({
  current: 'rabbit-house:v1:shift-current',
  history: 'rabbit-house:v1:shift-history',
  collection: 'rabbit-house:v1:shift-collection',
  progression: 'rabbit-house:v1:shift-progression',
  reconciliation: 'rabbit-house:v1:shift-reconciliation',
  mutationLease: 'rabbit-house:v1:shift-mutations:lease',
})

export class ShiftStoreConflictError extends Error {
  constructor() { super('Shift snapshot revision conflict; reload the persisted state before saving'); this.name = 'ShiftStoreConflictError' }
}

export type CurrentShiftState = Readonly<
  { status: 'missing' } | { status: 'corrupt' } | { status: 'valid'; snapshot: ShiftSnapshot }
>

export interface ShiftLockCoordinator {
  request<T>(name: string, action: () => T | Promise<T>): Promise<T>
}

export type ShiftEnvelopeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Implementations must commit the callback's writes atomically and reject without publishing them. */
export interface ShiftTransactionCoordinator {
  run<T>(legacy: ShiftEnvelopeStorage, mode: 'readonly' | 'readwrite', migrate: boolean,
    action: (storage: ShiftEnvelopeStorage) => T): Promise<T>
}

export type BrowserShiftOptions = Readonly<{
  locks?: ShiftLockCoordinator | null
  transactions?: ShiftTransactionCoordinator | null
  /** @deprecated Leases are no longer used; retained for constructor compatibility. */
  ownerId?: string
  leaseNow?: () => number
  leaseWait?: (milliseconds: number) => Promise<void>
  leaseDurationMs?: number
  maxAttempts?: number
}>

const clone = <T>(value: T): T => structuredClone(value)
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const string = (value: unknown): value is string => typeof value === 'string'
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string)
const records = (value: unknown): value is Record<string, Record<string, unknown>> => object(value) && Object.values(value).every(object)
const machine = (value: unknown) => value === 'quick' || value === 'fine'
const id = (value: unknown): value is string => string(value) && value.trim().length > 0
const integer = (value: unknown): value is number => number(value) && Number.isSafeInteger(value) && value >= 0
const member = (value: unknown, values: readonly string[]) => string(value) && values.includes(value)
const nonnegative = (value: unknown): value is number => number(value) && value >= 0
const uniqueStrings = (value: unknown): value is string[] => strings(value) && new Set(value).size === value.length
const craftKinds = ['stamp', 'trim', 'ribbon', 'foil', 'wax']
const dimensions = ['position', 'pressure', 'length', 'time', 'coverage']
const materialId = (value: unknown) => MATERIALS.some((material) => material.id === value)
const stringRecord = (value: unknown) => object(value) && Object.values(value).every(string)
const measurements = (value: unknown) => object(value) && Object.entries(value).every(([key, amount]) => dimensions.includes(key) && number(amount))

/**
 * IndexedDB owns every shift envelope after the first transaction-required mutation.
 * The revision check, migration and writes share one readwrite transaction. No localStorage
 * writes occur on that path, so aborting a transaction also rolls back its entire candidate.
 * Readonly calls never migrate. Null values are retained to prevent legacy resurrection.
 */
export class IndexedDbShiftCoordinator implements ShiftTransactionCoordinator {
  constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open('rabbit-house:v1:shift-transactions', 1)
      let blocked = false
      request.onupgradeneeded = () => {
        if (blocked) { request.transaction?.abort(); return }
        request.result.createObjectStore('envelopes')
      }
      request.onerror = () => reject(request.error ?? new Error('Shift IndexedDB unavailable'))
      request.onblocked = () => { blocked = true; reject(new Error('Shift IndexedDB upgrade blocked; close older tabs')) }
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return }
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
    })
  }

  async run<T>(legacy: ShiftEnvelopeStorage, mode: 'readonly' | 'readwrite', migrate: boolean,
    action: (storage: ShiftEnvelopeStorage) => T): Promise<T> {
    const database = await this.open()
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction('envelopes', mode)
        const store = transaction.objectStore('envelopes')
        const request = store.get('current-and-reconciliation')
        let result: T
        let failure: unknown
        transaction.oncomplete = () => resolve(result)
        transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Shift transaction aborted'))
        request.onsuccess = () => {
          try {
            const record: unknown = request.result
            if (record !== undefined && (!object(record) || ![1, 2, 3].includes(record.version as number) || record.kind !== 'shift-envelopes'
              || !(record.current === null || string(record.current))
              || !(record.reconciliation === null || string(record.reconciliation))
              || ((record.version === 2 || record.version === 3) && (!(record.history === null || string(record.history))
                || !(record.progression === null || string(record.progression))))
              || (record.version === 3 && !(record.collection === null || string(record.collection))))) {
              throw new Error('Invalid shift transaction envelope')
            }
            // Web Locks may keep single-envelope writes in localStorage until a transaction
            // is required. After migration, every reader/writer uses IndexedDB.
            if (record === undefined && !migrate) { result = action(legacy); return }
            const canonical = record as { version: 1 | 2 | 3; current: string | null; reconciliation: string | null;
              history?: string | null; progression?: string | null; collection?: string | null } | undefined
            const values = new Map<string, string | null>([
              [SHIFT_STORE_KEYS.current, canonical === undefined ? legacy.getItem(SHIFT_STORE_KEYS.current) : canonical.current],
              [SHIFT_STORE_KEYS.reconciliation, canonical === undefined ? legacy.getItem(SHIFT_STORE_KEYS.reconciliation) : canonical.reconciliation],
              // v1 records owned only current + reconciliation. Adopt legacy settlement data once,
              // in the same successful commit that upgrades the canonical record to v2.
              [SHIFT_STORE_KEYS.history, canonical && canonical.version >= 2 ? canonical.history! : legacy.getItem(SHIFT_STORE_KEYS.history)],
              [SHIFT_STORE_KEYS.progression, canonical && canonical.version >= 2 ? canonical.progression! : legacy.getItem(SHIFT_STORE_KEYS.progression)],
              [SHIFT_STORE_KEYS.collection, canonical?.version === 3 ? canonical.collection! : legacy.getItem(SHIFT_STORE_KEYS.collection)],
            ])
            let changed = canonical?.version !== 3
            const set = (key: string, value: string | null) => {
              if (mode !== 'readwrite' || !values.has(key)) throw new Error('Invalid shift transaction write')
              if (values.get(key) !== value) { changed = true; values.set(key, value) }
            }
            result = action({ getItem: (key) => values.get(key) ?? null, setItem: set, removeItem: (key) => set(key, null) })
            if (mode === 'readwrite' && changed) store.put({ version: 3, kind: 'shift-envelopes',
              current: values.get(SHIFT_STORE_KEYS.current), reconciliation: values.get(SHIFT_STORE_KEYS.reconciliation),
              history: values.get(SHIFT_STORE_KEYS.history),
              progression: values.get(SHIFT_STORE_KEYS.progression),
              collection: values.get(SHIFT_STORE_KEYS.collection),
            }, 'current-and-reconciliation')
          } catch (error) {
            failure = error
            transaction.abort()
          }
        }
      })
    } finally {
      database.close()
    }
  }
}

function isPreparation(selection: unknown): boolean {
  if (!object(selection)) return false
  return (selection.paperId === null || member(selection.paperId, ['cream', 'coffee', 'mint', 'pink', 'sky', 'lilac', 'midnight', 'kraft']))
    && (selection.paperMaterialId === null || member(selection.paperMaterialId, ['smooth', 'textured', 'pearl', 'linen', 'kraft']))
    && (selection.shapeId === null || member(selection.shapeId, ['landscape', 'portrait', 'folded', 'square', 'ticket', 'tag']))
    && member(selection.orientation, ['landscape', 'portrait']) && (selection.layoutId === null || id(selection.layoutId))
    && member(selection.surfaceFinishId, ['matte', 'gloss', 'foil', 'emboss', 'wax'])
}

function isDesign(value: unknown): boolean {
  if (!object(value) || value.version !== 1 || !isPreparation(value.preparation)
    || !Array.isArray(value.elements) || !Array.isArray(value.crafts)) return false
  return new Set(value.elements.map((element: unknown) => object(element) ? element.id : undefined)).size === value.elements.length
    && new Set(value.crafts.map((craft: unknown) => object(craft) ? craft.id : undefined)).size === value.crafts.length
    && value.elements.every((element) => object(element) && ['id', 'assetId', 'slotId'].every((field) => id(element[field]))
      && findProductionAsset(element.kind, element.assetId) !== undefined && member(element.size, ['small', 'medium', 'large'])
      && member(element.direction, ['upright', 'left', 'right', 'inverted']) && member(element.layer, ['back', 'front']))
    && value.crafts.every((craft) => object(craft) && id(craft.id) && id(craft.requirementId)
      && member(craft.kind, craftKinds) && number(craft.completedAtMs)
      && measurements(craft.measurements) && stringRecord(craft.discrete))
}

function isMaterialCosts(value: unknown): boolean {
  return Array.isArray(value) && value.every((cost) => object(cost) && materialId(cost.materialId) && nonnegative(cost.quantity))
}

function isCriterion(value: unknown): boolean {
  if (!object(value) || !id(value.id) || !string(value.label) || !strings(value.tags)
    || !isMaterialCosts(value.optionalMaterialCosts) || !object(value.rule)) return false
  const rule = value.rule
  return (rule.kind === 'tags' && strings(rule.tags) && member(rule.match, ['all', 'any']))
    || (rule.kind === 'layout-tag' && string(rule.tag))
    || (rule.kind === 'element-count' && integer(rule.minimum) && integer(rule.maximum) && rule.minimum <= rule.maximum)
}

function isOrderContent(value: unknown): boolean {
  if (!object(value) || !id(value.id) || !string(value.title) || !object(value.customer)
    || !string(value.customer.name) || !string(value.customer.situation)
    || value.customer.kind !== 'official' || !member(value.customer.characterId, OFFICIAL_CHARACTER_IDS)
    || !object(value.requirements) || !isPreparation(value.requirements)
    || !['paperId', 'paperMaterialId', 'shapeId', 'layoutId'].every((field) => id((value.requirements as Record<string, unknown>)[field]))
    || !Array.isArray(value.preferences) || !value.preferences.every(isCriterion) || !isCriterion(value.taboo)
    || !nonnegative(value.qualityExpectation)) return false
  const requirements = value.requirements
  return Array.isArray(requirements.elements) && requirements.elements.every((element) => object(element)
    && id(element.id) && id(element.assetId) && string(element.label)
    && findProductionAsset(element.kind, element.assetId) !== undefined && integer(element.quantity) && element.quantity > 0)
    && Array.isArray(requirements.crafts) && requirements.crafts.every((craft) => object(craft)
      && id(craft.id) && string(craft.label) && member(craft.kind, craftKinds)
      && stringRecord(craft.discrete) && isMaterialCosts(craft.materialCosts) && object(craft.targets)
      && Object.entries(craft.targets).every(([key, target]) => dimensions.includes(key) && object(target)
        && number(target.min) && number(target.max) && target.min <= target.max))
}

function isStage(value: unknown): boolean {
  if (!object(value) || !id(value.id) || !string(value.label) || !string(value.seed) || !integer(value.day)
    || value.durationSeconds !== 720 || value.inspections !== 3 || ![0, 1].includes(value.freeDemoInspections as number)
    || !object(value.inventory) || !MATERIALS.every((material) => nonnegative((value.inventory as Record<string, unknown>)[material.id]))
    || !Array.isArray(value.customers) || !value.customers.every((customer) => object(customer) && id(customer.id)
      && isOrderContent(customer.order) && ['arrivalSeconds', 'arrivalBaseSeconds', 'basePatienceSeconds', 'unadjustedPatienceSeconds', 'lastWaitSeconds'].every((field) => nonnegative(customer[field]))
      && (customer.calibrationPlan === undefined || (object(customer.calibrationPlan)
        && Object.entries(customer.calibrationPlan).every(([machineId, kind]) => machine(machineId) && member(kind, ['minesweeper', 'sudoku', 'math']))))
      && number(customer.arrivalJitterSeconds) && Number.isSafeInteger(customer.arrivalJitterSeconds) && Math.abs(customer.arrivalJitterSeconds) <= 12)
    || !object(value.thresholds) || !nonnegative(value.thresholds.maxLeft)) return false
  const thresholds = value.thresholds
  return value.kind === 'authored'
    ? member(value.id, ['tutorial', 'beginner', 'story']) && thresholds.kind === 'authored' && integer(thresholds.minDelivered) && integer(thresholds.minSatisfied)
    : value.kind === 'survival' && thresholds.kind === 'survival' && nonnegative(thresholds.minDeliveredRatio)
      && thresholds.minDeliveredRatio <= 1 && nonnegative(thresholds.satisfiedRatioExclusive) && thresholds.satisfiedRatioExclusive <= 1
      && ['arrivalHorizonSeconds', 'complexProbability', 'hardPuzzleWeight', 'patienceReductionSeconds'].every((field) => nonnegative(value[field]))
}

function isEvaluation(value: unknown): boolean {
  return object(value) && ['accuracy', 'preferences', 'quality', 'printing', 'timeliness', 'rawScore', 'score'].every((field) => number(value[field]))
    && member(value.grade, ['S', 'A', 'B', 'C', 'D']) && typeof value.satisfied === 'boolean'
    && strings(value.missingRequiredIds) && typeof value.tabooViolated === 'boolean' && strings(value.advice)
}

function isActiveCraft(value: unknown): boolean {
  if (!object(value) || !id(value.operationId) || !id(value.requirementId) || !member(value.kind, craftKinds)
    || !stringRecord(value.discrete) || !uniqueStrings(value.reservationIds) || !object(value.progress)
    || !measurements(value.progress.measurements) || !strings(value.progress.completedSteps)
    || !Array.isArray(value.progress.coverageCells) || !value.progress.coverageCells.every(integer)
    || !Array.isArray(value.progress.trace) || !value.progress.trace.every((point) => object(point) && number(point.x) && number(point.y))) return false
  return value.status === 'selected' || (value.status === 'in_progress' && number(value.startedAtMs) && number(value.irreversibleActionAtMs))
}

function isDraft(value: unknown): boolean {
  if (!object(value) || !['id', 'shiftRunId', 'orderId'].every((field) => id(value[field])) || !integer(value.revision)
    || !(value.derivedFromSnapshotId === null || id(value.derivedFromSnapshotId)) || !isDesign(value.design)
    || !uniqueStrings(value.reservationIds) || !Array.isArray(value.inspections)
    || !value.inspections.every((inspection) => object(inspection) && id(inspection.id) && integer(inspection.draftRevision)
      && number(inspection.checkedAtMs) && typeof inspection.freeDemo === 'boolean' && Array.isArray(inspection.issues)
      && inspection.issues.every((issue) => object(issue) && string(issue.code) && string(issue.label)
        && (issue.elementId === undefined || id(issue.elementId))))) return false
  return member(value.stage, ['not_started', 'preparing', 'assembling'])
    || (value.stage === 'crafting' && (value.activeCraft === null || isActiveCraft(value.activeCraft)))
    || (value.stage === 'archived' && id(value.snapshotId))
}

function isMaterialReservation(value: unknown): boolean {
  if (!object(value) || !['id', 'draftId', 'operationId'].every((field) => id(value[field]))
    || !materialId(value.materialId) || !number(value.quantity) || value.quantity <= 0 || !integer(value.draftRevision)
    || !number(value.reservedAtMs) || MATERIALS.find((material) => material.id === value.materialId)?.consumeOn !== value.consumeOn) return false
  return value.status === 'reserved' || (value.status === 'consumed' && number(value.consumedAtMs))
    || (value.status === 'released' && number(value.releasedAtMs))
}

function isTask(value: unknown): boolean {
  if (!object(value) || !['id', 'intentId', 'snapshotId', 'orderId', 'shiftRunId'].every((field) => id(value[field]))
    || !machine(value.machineId) || !number(value.createdAtMs) || !number(value.durationMs) || value.durationMs <= 0
    || typeof value.expedited !== 'boolean') return false
  switch (value.status) {
    case 'queued': return true
    case 'printing': return number(value.startedAtMs) && number(value.completesAtMs) && value.completesAtMs === value.startedAtMs + value.durationMs
    case 'ready': return number(value.readyAtMs)
    case 'delivered': return number(value.readyAtMs) && number(value.deliveredAtMs) && value.deliveredAtMs >= value.readyAtMs
    case 'unclaimed': return number(value.readyAtMs) && number(value.unclaimedAtMs) && value.unclaimedAtMs >= value.readyAtMs
    default: return false
  }
}

function isPuzzleDefinition(value: unknown): boolean {
  return validatePublicPuzzleDefinition(value).valid
}

function isPuzzleAnswer(value: unknown, kind: unknown): boolean {
  if (!object(value) || value.kind !== kind) return false
  switch (value.kind) {
    case 'number-search': return integer(value.index)
    case 'connect': return strings(value.path)
    case 'identify': return string(value.optionId)
    case 'minesweeper': return Array.isArray(value.revealedIndices) && value.revealedIndices.every(integer)
      && Array.isArray(value.flaggedIndices) && value.flaggedIndices.every(integer)
    case 'sudoku': return Array.isArray(value.cells) && value.cells.every(integer)
    case 'math-choice': return strings(value.optionIds)
    case 'math-fill': return string(value.text)
    default: return false
  }
}

function isPuzzle(value: unknown): boolean {
  if (!object(value) || !['id', 'shiftRunId', 'orderId', 'intentId'].every((field) => id(value[field]))
    || !machine(value.machineId) || !integer(value.attempt) || value.attempt < 1 || Object.hasOwn(value, 'seed')
    || !number(value.startedAtMs) || !number(value.deadlineAtMs) || value.deadlineAtMs < value.startedAtMs
    || !isPuzzleDefinition(value.definition) || !object(value.definition) || !object(value.result)) return false
  const result = value.result
  return result.status === 'pending'
    || (result.status === 'succeeded' && number(result.submittedAtMs) && isPuzzleAnswer(result.answer, value.definition.kind))
    || (result.status === 'failed' && number(result.failedAtMs) && member(result.reason, ['wrong', 'timeout', 'exit'])
      && (result.answer === null || isPuzzleAnswer(result.answer, value.definition.kind)))
}

function isArchive(value: unknown): value is ShiftCardSnapshot {
  return object(value) && value.kind === 'production-card' && value.version === 1
    && ['id', 'shiftRunId', 'orderId', 'draftId'].every((field) => id(value[field]))
    && integer(value.draftRevision) && number(value.savedAtMs) && isDesign(value.design)
}

function isWorkshopDraft(value: unknown): value is WorkshopDraft {
  return object(value) && value.kind === 'workshop-draft' && value.version === 1
    && id(value.id) && id(value.shiftRunId) && string(value.customerName) && string(value.title)
    && number(value.savedAtMs) && isDesign(value.design)
}

function isOrder(value: unknown, runId: string): boolean {
  if (!object(value) || !id(value.id) || value.shiftRunId !== runId || !isOrderContent(value.content)
    || !number(value.arrivalAtMs) || !(value.acceptedAtMs === null || number(value.acceptedAtMs))
    || !number(value.basePatienceSeconds) || !number(value.lastWaitSeconds)
    || !member(value.position, ['door_waiting', 'active', 'closed']) || !object(value.patience)
    || !object(value.outcome)
    || !member(value.remedy, ['none', 'explain-progress', 'expedite'])) return false
  const outcome = value.outcome
  if (!(outcome.status === 'pending' || (outcome.status === 'delivered' && id(outcome.taskId) && number(outcome.deliveredAtMs) && isEvaluation(outcome.evaluation))
    || (outcome.status === 'left' && number(outcome.leftAtMs) && member(outcome.reason, ['patience', 'closing'])))) return false
  const patience = value.patience
  switch (patience.phase) {
    case 'normal': return number(patience.depletesAtMs) && number(patience.remainingSeconds) && number(patience.updatedAtMs)
    case 'last_wait': return number(patience.startedAtMs) && number(patience.deadlineAtMs) && number(patience.originalDurationSeconds)
    case 'expired': return number(patience.expiredAtMs)
    default: return false
  }
}

function isReceipt(value: unknown): boolean {
  return object(value) && ['receiptId', 'intentId', 'snapshotId', 'shiftRunId'].every((field) => id(value[field]))
    && machine(value.machineId) && number(value.receivedAtMs) && member(value.authority, ['local', 'remote'])
    && Object.hasOwn(value, 'details') && (value.status === 'accepted' ? id(value.taskId)
      : value.status === 'rejected' && id(value.reasonCode) && string(value.message))
}

function isResult(value: unknown): value is ShiftResult {
  return object(value) && string(value.shiftRunId) && string(value.stageId)
    && ['day', 'closedAtMs', 'delivered', 'satisfied', 'left', 'averageScore'].every((field) => number(value[field]))
    && integer(value.longestQualityStreak) && value.longestQualityStreak <= (value.satisfied as number)
    && typeof value.passed === 'boolean' && strings(value.failureReasons)
    && value.failureReasons.every((reason) => ['deliveries', 'satisfaction', 'departures', 'corrupt-save'].includes(reason))
}

function isHistory(value: unknown): value is ShiftResult[] {
  return Array.isArray(value) && value.every(isResult)
}

type ShiftHistory = Readonly<{ results: readonly ShiftResult[]; cards: readonly ShiftCardSnapshot[] }>
type ShiftCollection = Readonly<{ cards: readonly ShiftCardSnapshot[]; drafts: readonly WorkshopDraft[] }>

/** v1 history contained results only. Reading it is side-effect free; the next write adopts v2. */
function readHistory(storage: ShiftEnvelopeStorage): ShiftHistory | undefined {
  const raw = storage.getItem(SHIFT_STORE_KEYS.history)
  if (raw === null) return undefined
  try {
    const envelope: unknown = JSON.parse(raw)
    if (!object(envelope) || envelope.kind !== 'shift-history') return undefined
    if (envelope.version === 1 && isHistory(envelope.value)) return { results: clone(envelope.value), cards: [] }
    const value = envelope.value
    if (envelope.version !== 2 || !object(value) || !isHistory(value.results)
      || !Array.isArray(value.cards) || !value.cards.every(isArchive)
      || new Set(value.cards.map(card => card.id)).size !== value.cards.length
      || !value.cards.every(card => (value.results as ShiftResult[]).some(result => result.shiftRunId === card.shiftRunId))) return undefined
    return clone(value as unknown as ShiftHistory)
  } catch { return undefined }
}

function isProgression(value: unknown): value is ShiftProgression {
  return object(value) && value.version === 1 && strings(value.completedAuthoredStages)
    && value.completedAuthoredStages.every((id) => ['tutorial', 'beginner', 'story'].includes(id))
    && typeof value.survivalUnlocked === 'boolean'
    && (value.survivalRun === null || (object(value.survivalRun) && string(value.survivalRun.seed)
      && number(value.survivalRun.nextDay) && number(value.survivalRun.satisfied)))
    && ['highestSurvivalDay', 'cumulativeSatisfied', 'highestDailyScore', 'longestQualityStreak'].every((field) => number(value[field]))
    && strings(value.unlockedCosmeticIds) && Array.isArray(value.results) && value.results.every(isResult)
}

function isAuthorization(value: unknown): boolean {
  if (!object(value) || !['id', 'shiftRunId', 'orderId', 'snapshotId'].every((field) => id(value[field]))
    || !number(value.confirmedAtMs) || !integer(value.nextAttempt) || value.nextAttempt < 1) return false
  switch (value.status) {
    case 'confirmed': return machine(value.machineId)
    case 'expired_unprinted': return number(value.expiredAtMs)
    case 'calibrating': return machine(value.machineId) && string(value.reservationId) && string(value.puzzleId) && number(value.attempt)
    case 'failed': return machine(value.machineId) && string(value.puzzleId) && number(value.machineLockUntilMs)
    case 'calibrated_pending_start': return machine(value.machineId) && string(value.reservationId) && string(value.puzzleId) && number(value.calibratedAtMs)
    case 'bound': return machine(value.machineId) && id(value.taskId) && isReceipt(value.receipt) && object(value.receipt) && value.receipt.status === 'accepted'
    case 'rejected': return machine(value.machineId) && isReceipt(value.receipt) && object(value.receipt) && value.receipt.status === 'rejected'
    default: return false
  }
}

function isPrinter(value: unknown, machineId: string): boolean {
  return object(value) && value.machineId === machineId && (value.currentTaskId === null || string(value.currentTaskId))
    && strings(value.queuedTaskIds) && object(value.orderLockUntilMs) && Object.values(value.orderLockUntilMs).every(number)
    && (value.estimatedFreeAtMs === null || number(value.estimatedFreeAtMs))
    && Array.isArray(value.reservations) && value.reservations.every((reservation) => object(reservation)
      && ['id', 'intentId', 'orderId', 'shiftRunId', 'puzzleId'].every((field) => string(reservation[field]))
      && reservation.machineId === machineId && (reservation.status === 'calibrating'
        ? number(reservation.deadlineAtMs) : reservation.status === 'calibrated_pending_start' && number(reservation.calibratedAtMs)))
}

/** Validate the envelope plus the essential runtime containers and discriminants before exposing saved state. */
function isSnapshot(value: unknown): value is ShiftSnapshot {
  if (!object(value) || value.version !== 1 || !integer(value.revision) || !number(value.savedAtMs) || !object(value.run)) return false
  const run = value.run
  if (run.version !== 1 || !id(run.id) || !string(run.seed) || !isStage(run.stage)
    || !['startedAtMs', 'deadlineAtMs', 'lastProcessedAtMs', 'inspectionsRemaining', 'freeDemoInspectionsRemaining'].every((field) => number(run[field]))
    || (run.inspectionTimeOffsetMs !== undefined && !nonnegative(run.inspectionTimeOffsetMs))
    || !Array.isArray(run.pauses) || !run.pauses.every((pause) => object(pause) && member(pause.reason, ['story', 'tutorial', 'settlement'])
      && number(pause.startedAtMs) && number(pause.endedAtMs) && pause.endedAtMs >= pause.startedAtMs)
    || !uniqueStrings(run.seenTutorialTriggers)
    || !run.seenTutorialTriggers.every(trigger => Object.values(TUTORIAL_STATION_TRIGGERS).includes(trigger as TutorialTrigger))
    || !Array.isArray(run.orders) || !run.orders.every((order) => isOrder(order, run.id as string)) || !uniqueStrings(run.activeOrderIds)
    || !(run.selectedOrderId === null || string(run.selectedOrderId))
    || !['reception', 'preparation', 'assembly', 'craft', 'inspection', 'print'].includes(String(run.station))
    || !records(run.drafts) || !Object.values(run.drafts).every(isDraft)
    || !strings(run.snapshotIds) || !records(run.snapshots) || !Object.values(run.snapshots).every(isArchive)
    || !object(run.materials) || !records(run.materials.stock) || !records(run.materials.reservations)
    || !MATERIALS.every((material) => {
      const stock = (run.materials as { stock: Record<string, Record<string, unknown>> }).stock[material.id]
      return stock !== undefined && ['available', 'reserved', 'consumed'].every((field) => nonnegative(stock[field]))
    }) || !Object.values(run.materials.reservations).every(isMaterialReservation)
    || !records(run.authorizations) || !Object.values(run.authorizations).every(isAuthorization)
    || !records(run.puzzles) || !Object.values(run.puzzles).every(isPuzzle)
    || !records(run.tasks) || !Object.values(run.tasks).every(isTask) || !object(run.printers)
    || !isPrinter(run.printers.quick, 'quick') || !isPrinter(run.printers.fine, 'fine')
    || !object(run.remedies) || typeof run.remedies.explainProgressAvailable !== 'boolean' || typeof run.remedies.expediteAvailable !== 'boolean'
    || !uniqueStrings(run.pendingReconciliationIntentIds)) return false
  if (!hasValidPrintReferences(value as unknown as ShiftSnapshot) || !hasValidRuntimeReferences(value as unknown as ShiftSnapshot)) return false
  return run.status === 'running'
    || (run.status === 'paused' && object(run.pause) && ['story', 'tutorial', 'settlement'].includes(String(run.pause.reason)) && number(run.pause.startedAtMs))
    || (run.status === 'settled' && isResult(run.result) && run.result.shiftRunId === run.id)
}

/** Recovery is allowed only for a complete, internally consistent persisted print transaction. */
function hasValidPrintReferences(snapshot: ShiftSnapshot): boolean {
  const run = snapshot.run
  const orderIds = new Set(run.orders.map((order) => order.id))
  if (orderIds.size !== run.orders.length || new Set(run.snapshotIds).size !== run.snapshotIds.length
    || !run.snapshotIds.every((snapshotId) => Object.hasOwn(run.snapshots, snapshotId) && run.snapshots[snapshotId].id === snapshotId)
    || !Object.entries(run.snapshots).every(([snapshotId, archive]) => archive.id === snapshotId
      && archive.shiftRunId === run.id && orderIds.has(archive.orderId))
    || !run.pendingReconciliationIntentIds.every((intentId) => Object.hasOwn(run.authorizations, intentId))) return false

  for (const [intentId, authorization] of Object.entries(run.authorizations)) {
    const archive = run.snapshots[authorization.snapshotId]
    if (authorization.id !== intentId || authorization.shiftRunId !== run.id
      || !run.snapshotIds.includes(authorization.snapshotId) || !archive
      || archive.shiftRunId !== authorization.shiftRunId || archive.orderId !== authorization.orderId) return false
    if (authorization.status === 'bound' || authorization.status === 'rejected') {
      const receipt = authorization.receipt
      if (receipt.intentId !== intentId || receipt.shiftRunId !== run.id || receipt.snapshotId !== authorization.snapshotId
        || receipt.machineId !== authorization.machineId
        || (authorization.status === 'bound' && authorization.taskId !== authorization.receipt.taskId)) return false
    }
    if (authorization.status !== 'calibrating' && authorization.status !== 'calibrated_pending_start') continue
    const reservations = run.printers[authorization.machineId].reservations.filter((entry) => entry.id === authorization.reservationId)
    const reservation = reservations[0]
    const puzzle = run.puzzles[authorization.puzzleId]
    if (reservations.length !== 1 || reservation.intentId !== intentId || reservation.shiftRunId !== run.id
      || reservation.orderId !== authorization.orderId || reservation.machineId !== authorization.machineId
      || reservation.puzzleId !== authorization.puzzleId || reservation.status !== authorization.status
      || !puzzle || puzzle.id !== authorization.puzzleId || puzzle.shiftRunId !== run.id
      || puzzle.orderId !== authorization.orderId || puzzle.intentId !== intentId || puzzle.machineId !== authorization.machineId
      || !object(puzzle.result)) return false
    if (authorization.status === 'calibrated_pending_start'
      && (reservation.status !== 'calibrated_pending_start' || reservation.calibratedAtMs !== authorization.calibratedAtMs
        || puzzle.result.status !== 'succeeded' || !number(puzzle.result.submittedAtMs)
        || puzzle.result.submittedAtMs !== authorization.calibratedAtMs)) return false
  }
  return Object.values(run.printers).every((printer) => printer.reservations.every((reservation) => {
    const authorization = run.authorizations[reservation.intentId]
    return authorization !== undefined && (authorization.status === 'calibrating' || authorization.status === 'calibrated_pending_start')
      && authorization.reservationId === reservation.id && authorization.machineId === printer.machineId
      && authorization.orderId === reservation.orderId && authorization.shiftRunId === reservation.shiftRunId
      && authorization.puzzleId === reservation.puzzleId && authorization.status === reservation.status
  }))
}

function hasValidRuntimeReferences(snapshot: ShiftSnapshot): boolean {
  const run = snapshot.run
  const orders = new Map(run.orders.map((order) => [order.id, order]))
  if (run.activeOrderIds.length > 3 || !run.activeOrderIds.every((orderId) => orders.get(orderId)?.position === 'active')
    || !run.orders.every((order) => order.position !== 'active' || run.activeOrderIds.includes(order.id))
    || (run.selectedOrderId !== null && !run.activeOrderIds.includes(run.selectedOrderId))) return false
  for (const [draftId, draft] of Object.entries(run.drafts)) {
    const order = orders.get(draft.orderId)
    if (draft.id !== draftId || draft.shiftRunId !== run.id || !order
      || !draft.reservationIds.every((reservationId) => run.materials.reservations[reservationId]?.draftId === draftId)
      || !draft.inspections.every((inspection) => inspection.draftRevision <= draft.revision)) return false
    if (draft.derivedFromSnapshotId !== null) {
      const source = run.snapshots[draft.derivedFromSnapshotId]
      if (!source || source.orderId !== draft.orderId || source.shiftRunId !== run.id) return false
    }
    if (draft.stage === 'archived') {
      const archive = run.snapshots[draft.snapshotId]
      if (!archive || archive.draftId !== draft.id || archive.draftRevision !== draft.revision || archive.orderId !== draft.orderId) return false
    }
    if (draft.stage === 'crafting' && draft.activeCraft !== null) {
      const craft = draft.activeCraft
      const requirement = order.content.requirements.crafts.find((entry) => entry.id === craft.requirementId)
      const finish = SURFACE_FINISHES.find(entry => entry.id === draft.design.preparation.surfaceFinishId)!
      const finishKind = finish.id === 'foil' ? 'foil' : finish.id === 'wax' ? 'wax' : 'stamp'
      if (!requirement && (craft.requirementId !== 'surface-finish' || !finish.materialCosts.length)) return false
      if (craft.kind !== (requirement?.kind ?? finishKind)) return false
      // Match select-craft's merged material demand, including optional surface work.
      const costs = [...(requirement?.materialCosts ?? [])]
      if (craft.kind === finishKind) for (const cost of finish.materialCosts) {
        if (!costs.some(existing => existing.materialId === cost.materialId)) costs.push(cost)
      }
      const demand = new Map<string, number>()
      for (const cost of costs) demand.set(cost.materialId, (demand.get(cost.materialId) ?? 0) + cost.quantity)
      const closedAtMs = order.outcome.status === 'left' ? order.outcome.leftAtMs
        : order.outcome.status === 'delivered' ? order.outcome.deliveredAtMs : null
      if (craft.reservationIds.length !== demand.size || !craft.reservationIds.every((reservationId) => {
        const reservation = run.materials.reservations[reservationId]
        if (!reservation || reservation.draftId !== draft.id || reservation.operationId !== craft.operationId
          || reservation.quantity !== demand.get(reservation.materialId)
          || reservation.consumeOn !== MATERIALS.find(material => material.id === reservation.materialId)!.consumeOn) return false
        // Closing an order releases only its unconsumed reservations; the selected
        // operation remains in the unfinished draft, while consumed work is irreversible.
        const consumed = craft.status === 'in_progress' && reservation.consumeOn === 'first-craft-action'
        const expectedStatus = consumed ? 'consumed' : closedAtMs === null ? 'reserved' : 'released'
        if (reservation.status !== expectedStatus) return false
        if (reservation.status === 'released' && (order.position !== 'closed' || reservation.releasedAtMs !== closedAtMs
          || reservation.releasedAtMs < reservation.reservedAtMs || reservation.releasedAtMs > run.lastProcessedAtMs)) return false
        return demand.delete(reservation.materialId)
      })) return false
    }
  }
  for (const archive of Object.values(run.snapshots)) {
    const draft = run.drafts[archive.draftId]
    if (!draft || draft.shiftRunId !== run.id || draft.orderId !== archive.orderId || archive.draftRevision > draft.revision) return false
  }
  for (const [reservationId, reservation] of Object.entries(run.materials.reservations)) {
    const draft = run.drafts[reservation.draftId]
    if (reservation.id !== reservationId || !draft || reservation.draftRevision > draft.revision || !draft.reservationIds.includes(reservationId)) return false
  }
  for (const material of MATERIALS) {
    const stock = run.materials.stock[material.id]
    const reservations = Object.values(run.materials.reservations).filter((reservation) => reservation.materialId === material.id)
    const reserved = reservations.reduce((sum, reservation) => sum + (reservation.status === 'reserved' ? reservation.quantity : 0), 0)
    const consumed = reservations.reduce((sum, reservation) => sum + (reservation.status === 'consumed' ? reservation.quantity : 0), 0)
    if (Math.abs(stock.reserved - reserved) > 1e-9 || Math.abs(stock.consumed - consumed) > 1e-9
      || Math.abs(stock.available + reserved + consumed - run.stage.inventory[material.id]) > 1e-9) return false
  }
  for (const [puzzleId, puzzle] of Object.entries(run.puzzles)) {
    const authorization = run.authorizations[puzzle.intentId]
    if (puzzle.id !== puzzleId || puzzle.shiftRunId !== run.id || !orders.has(puzzle.orderId)
      || !authorization || authorization.orderId !== puzzle.orderId || puzzle.attempt >= authorization.nextAttempt) return false
  }
  for (const [taskId, task] of Object.entries(run.tasks)) {
    const archive = run.snapshots[task.snapshotId]
    const authorization = run.authorizations[task.intentId]
    if (task.id !== taskId || task.shiftRunId !== run.id || !archive || archive.orderId !== task.orderId
      || !authorization || authorization.status !== 'bound' || authorization.taskId !== taskId
      || authorization.orderId !== task.orderId || authorization.snapshotId !== task.snapshotId || authorization.machineId !== task.machineId) return false
  }
  for (const authorization of Object.values(run.authorizations)) {
    if (authorization.status === 'bound' && !run.tasks[authorization.taskId]) return false
    if (authorization.status === 'failed') {
      const puzzle = run.puzzles[authorization.puzzleId]
      if (!puzzle || puzzle.intentId !== authorization.id || puzzle.machineId !== authorization.machineId || puzzle.result.status !== 'failed') return false
    }
  }
  const assignedTasks = new Set<string>()
  const assignedReservations = new Set<string>()
  for (const printer of [run.printers.quick, run.printers.fine]) {
    if (Number(printer.currentTaskId !== null) + printer.queuedTaskIds.length + printer.reservations.length > 3
      || (printer.currentTaskId === null && printer.queuedTaskIds.length > 0)
      || !Object.keys(printer.orderLockUntilMs).every((orderId) => orders.has(orderId))) return false
    const taskIds = printer.currentTaskId === null ? [...printer.queuedTaskIds] : [printer.currentTaskId, ...printer.queuedTaskIds]
    for (const taskId of taskIds) {
      const task = run.tasks[taskId]
      if (!task || assignedTasks.has(taskId) || task.machineId !== printer.machineId || task.shiftRunId !== run.id
        || task.status !== (taskId === printer.currentTaskId ? 'printing' : 'queued')) return false
      assignedTasks.add(taskId)
    }
    for (const reservation of printer.reservations) {
      if (assignedReservations.has(reservation.id)) return false
      assignedReservations.add(reservation.id)
    }
    const current = printer.currentTaskId === null ? undefined : run.tasks[printer.currentTaskId]
    const estimate = current?.status === 'printing' ? current.completesAtMs
      + printer.queuedTaskIds.reduce((sum, taskId) => sum + run.tasks[taskId].durationMs, 0) : null
    if (printer.estimatedFreeAtMs !== estimate) return false
  }
  return Object.values(run.tasks).every((task) => (task.status !== 'printing' && task.status !== 'queued') || assignedTasks.has(task.id))
    && run.orders.every((order) => order.outcome.status !== 'delivered'
      || (run.tasks[order.outcome.taskId]?.orderId === order.id && run.tasks[order.outcome.taskId].status === 'delivered'))
}

function needsReconciliation(snapshot: ShiftSnapshot): boolean {
  return snapshot.run.pendingReconciliationIntentIds.length > 0
    || Object.values(snapshot.run.authorizations).some((authorization) => authorization.status === 'calibrated_pending_start')
}

function isReconciliationQueue(value: unknown): value is ShiftSnapshot[] {
  return Array.isArray(value) && value.every(isSnapshot)
    && new Set(value.map((snapshot) => snapshot.run.id)).size === value.length
}

function readEnvelope<T>(storage: ShiftEnvelopeStorage, key: string, kind: string, validate: (value: unknown) => value is T): T | undefined {
  const raw = storage.getItem(key)
  if (raw === null) return undefined
  try {
    const envelope: unknown = JSON.parse(raw)
    if (!object(envelope) || envelope.version !== 1 || envelope.kind !== kind) return undefined
    if (kind === 'shift-current') migrateLegacyCustomerSnapshot(envelope.value)
    if (kind === 'shift-reconciliation' && Array.isArray(envelope.value)) {
      envelope.value.forEach(migrateLegacyCustomerSnapshot)
    }
    return validate(envelope.value) ? clone(envelope.value) : undefined
  } catch {
    return undefined
  }
}

function writeEnvelope(storage: ShiftEnvelopeStorage, key: string, kind: string, value: unknown, version = 1): void {
  storage.setItem(key, JSON.stringify({ version, kind, value: clone(value) }))
}

function initialProgression(): ShiftProgression {
  return {
    version: 1, completedAuthoredStages: [], survivalUnlocked: false, survivalRun: null,
    highestSurvivalDay: 0, cumulativeSatisfied: 0, highestDailyScore: 0, longestQualityStreak: 0,
    unlockedCosmeticIds: [], results: [],
  }
}

export class BrowserShiftStore {
  private readonly locks: ShiftLockCoordinator | null | undefined
  private readonly transactions: ShiftTransactionCoordinator | null | undefined

  constructor(private readonly storage: Storage = examStorage(), options: BrowserShiftOptions = {}) {
    if (options.ownerId !== undefined && !id(options.ownerId)) throw new Error('Invalid shift lease owner')
    if (options.leaseNow !== undefined && typeof options.leaseNow !== 'function') throw new Error('Invalid shift lease clock')
    if (options.leaseWait !== undefined && typeof options.leaseWait !== 'function') throw new Error('Invalid shift lease wait')
    if (options.leaseDurationMs !== undefined && (!number(options.leaseDurationMs) || options.leaseDurationMs <= 0)) throw new Error('Invalid shift lease duration')
    this.locks = options.locks === undefined
      ? (typeof navigator !== 'undefined' && navigator.locks ? { request: (name, action) => navigator.locks.request(name, () => action()) } : undefined)
      : options.locks
    this.transactions = options.transactions === undefined
      ? (hasExamSession() ? new ExamShiftCoordinator() : typeof globalThis.indexedDB === 'undefined' ? undefined : new IndexedDbShiftCoordinator(globalThis.indexedDB))
      : options.transactions
  }

  private async readShift<T>(action: (storage: ShiftEnvelopeStorage) => T): Promise<T> {
    return this.transactions ? this.transactions.run(this.storage, 'readonly', false, action) : action(this.storage)
  }

  /**
   * Web Locks or an IndexedDB transaction protects current, reconciliation, history and progression,
   * including run switches. Multi-envelope settlements require a transaction even with Web Locks.
   */
  private async withMutationLock<T>(action: (storage: ShiftEnvelopeStorage) => T, requireTransaction = false): Promise<T> {
    if (requireTransaction && !this.transactions) throw new Error('Atomic shift settlement requires a transaction coordinator')
    if (this.locks) return this.locks.request(SHIFT_STORE_KEYS.current, () => this.transactions
      ? this.transactions.run(this.storage, 'readwrite', requireTransaction, action) : action(this.storage))
    if (this.transactions) return this.transactions.run(this.storage, 'readwrite', true, action)
    throw new Error('Shift saving unavailable: Web Locks or IndexedDB transactions are required')
  }

  /** Corruption is isolated to this key. Reads never repair, erase or rewrite any store. */
  async inspectCurrent(): Promise<CurrentShiftState> {
    return this.readShift((storage) => {
      if (storage.getItem(SHIFT_STORE_KEYS.current) === null) return { status: 'missing' }
      const snapshot = readEnvelope(storage, SHIFT_STORE_KEYS.current, 'shift-current', isSnapshot)
      return snapshot === undefined ? { status: 'corrupt' } : { status: 'valid', snapshot }
    })
  }

  async loadCurrent(): Promise<ShiftSnapshot | undefined> {
    const state = await this.inspectCurrent()
    return state.status === 'valid' ? state.snapshot : undefined
  }

  async saveCurrent(snapshot: ShiftSnapshot, expectedRevision?: number): Promise<ShiftSnapshot> {
    if (!isSnapshot(snapshot)) throw new Error('Invalid current shift snapshot')
    const candidate = clone(snapshot)
    return this.withMutationLock(storage => this.persistCurrent(candidate, storage, expectedRevision))
  }

  /** Archive acceptance and durable collection insertion have one commit point. */
  async saveArchive(snapshot: ShiftSnapshot, expectedRevision?: number): Promise<ShiftSnapshot> {
    if (!isSnapshot(snapshot)) throw new Error('Invalid archive shift snapshot')
    const candidate = clone(snapshot)
    return this.withMutationLock((storage) => {
      const current = readEnvelope(storage, SHIFT_STORE_KEYS.current, 'shift-current', isSnapshot)
      if (current !== undefined && current.run.id !== candidate.run.id) throw new ShiftStoreConflictError()
      const saved = this.persistCurrent(candidate, storage, expectedRevision)
      this.persistCollected(Object.values(candidate.run.snapshots), storage)
      return saved
    }, true)
  }

  private persistCurrent(candidate: ShiftSnapshot, storage: ShiftEnvelopeStorage, expectedRevision?: number): ShiftSnapshot {
    const current = readEnvelope(storage, SHIFT_STORE_KEYS.current, 'shift-current', isSnapshot)
    if (current?.run.id === candidate.run.id) {
      if (current.revision === candidate.revision && JSON.stringify(current) === JSON.stringify(candidate)) return clone(current)
      if (candidate.revision <= current.revision) throw new ShiftStoreConflictError()
    }
    if (expectedRevision !== undefined && (current?.revision !== expectedRevision || !integer(expectedRevision))) throw new ShiftStoreConflictError()
    if (current !== undefined && current.run.id !== candidate.run.id && needsReconciliation(current)) this.persistReconciliation(current, storage)
    writeEnvelope(storage, SHIFT_STORE_KEYS.current, 'shift-current', candidate)
    return clone(candidate)
  }

  async clearCurrent(): Promise<void> {
    return this.withMutationLock((storage) => {
      const current = readEnvelope(storage, SHIFT_STORE_KEYS.current, 'shift-current', isSnapshot)
      if (current !== undefined && needsReconciliation(current)) this.persistReconciliation(current, storage)
      storage.removeItem(SHIFT_STORE_KEYS.current)
    })
  }

  /** Old runs are stored independently, before their current slot can be overwritten or cleared. */
  async saveReconciliation(snapshot: ShiftSnapshot, expectedRevision?: number): Promise<ShiftSnapshot> {
    if (!isSnapshot(snapshot)) throw new Error('Invalid shift reconciliation snapshot')
    const candidate = clone(snapshot)
    return this.withMutationLock((storage) => {
      this.persistReconciliation(candidate, storage, expectedRevision)
      return clone(candidate)
    })
  }

  async listReconciliations(): Promise<readonly ShiftSnapshot[]> {
    return this.readShift((storage) => readEnvelope(storage, SHIFT_STORE_KEYS.reconciliation, 'shift-reconciliation', isReconciliationQueue) ?? [])
  }

  async removeReconciliation(shiftRunId: string, expectedRevision?: number): Promise<void> {
    return this.withMutationLock((storage) => {
      const queue = this.reconciliationForMutation(storage)
      const snapshot = queue.find((entry) => entry.run.id === shiftRunId)
      if (expectedRevision !== undefined && (!integer(expectedRevision) || snapshot?.revision !== expectedRevision)) throw new ShiftStoreConflictError()
      if (snapshot === undefined) return
      if (needsReconciliation(snapshot)) throw new Error('Pending print reconciliation requires a persisted receipt binding')
      writeEnvelope(storage, SHIFT_STORE_KEYS.reconciliation, 'shift-reconciliation', queue.filter((entry) => entry.run.id !== shiftRunId))
    })
  }

  /** Persist the exact settled result before discarding its recovery context, under one coordinator. */
  async finalizeReconciliation(shiftRunId: string, result: ShiftResult, expectedRevision: number): Promise<void> {
    if (!isResult(result) || result.shiftRunId !== shiftRunId) throw new Error('Invalid reconciliation result')
    const candidate = clone(result)
    return this.withMutationLock((storage) => {
      const queue = this.reconciliationForMutation(storage)
      const snapshot = queue.find((entry) => entry.run.id === shiftRunId)
      if (!integer(expectedRevision) || snapshot?.revision !== expectedRevision) throw new ShiftStoreConflictError()
      if (needsReconciliation(snapshot)) throw new Error('Pending print reconciliation requires a persisted receipt binding')
      if (snapshot.run.status !== 'settled' || JSON.stringify(snapshot.run.result) !== JSON.stringify(candidate)) {
        throw new Error('Reconciliation result does not match its settled snapshot')
      }
      this.persistFinished(candidate, storage, true, Object.values(snapshot.run.snapshots))
      this.persistCollected(Object.values(snapshot.run.snapshots), storage)
      this.persistWorkshopDrafts(snapshot, storage)
      writeEnvelope(storage, SHIFT_STORE_KEYS.reconciliation, 'shift-reconciliation', queue.filter((entry) => entry.run.id !== shiftRunId))
    }, true)
  }

  private reconciliationForMutation(storage: ShiftEnvelopeStorage): ShiftSnapshot[] {
    const queue = readEnvelope(storage, SHIFT_STORE_KEYS.reconciliation, 'shift-reconciliation', isReconciliationQueue)
    if (queue === undefined && storage.getItem(SHIFT_STORE_KEYS.reconciliation) !== null) {
      throw new Error('Invalid shift reconciliation queue')
    }
    return queue ?? []
  }

  private persistReconciliation(snapshot: ShiftSnapshot, storage: ShiftEnvelopeStorage, expectedRevision?: number): void {
    const queue = this.reconciliationForMutation(storage)
    const index = queue.findIndex((entry) => entry.run.id === snapshot.run.id)
    if (expectedRevision !== undefined && (!integer(expectedRevision) || queue[index]?.revision !== expectedRevision
      || snapshot.revision <= expectedRevision)) throw new ShiftStoreConflictError()
    if (index < 0) queue.push(snapshot)
    else {
      const previous = queue[index]
      if (snapshot.revision < previous.revision) throw new Error('Cannot replace reconciliation with an older snapshot')
      for (const authorization of Object.values(previous.run.authorizations)) {
        if (authorization.status !== 'calibrated_pending_start') continue
        const updated = snapshot.run.authorizations[authorization.id]
        if (updated === undefined || !['calibrated_pending_start', 'bound', 'rejected'].includes(updated.status)
          || !('machineId' in updated) || updated.machineId !== authorization.machineId
          || updated.snapshotId !== authorization.snapshotId || updated.orderId !== authorization.orderId) {
          throw new Error('Pending reconciliation requires its original context or an authoritative receipt')
        }
      }
      queue[index] = snapshot
    }
    writeEnvelope(storage, SHIFT_STORE_KEYS.reconciliation, 'shift-reconciliation', queue)
  }

  async appendFinished(result: ShiftResult): Promise<void> {
    if (!isResult(result)) throw new Error('Invalid finished shift result')
    const candidate = clone(result)
    return this.withMutationLock((storage) => this.persistFinished(candidate, storage))
  }

  private persistFinished(result: ShiftResult, storage: ShiftEnvelopeStorage, requireMatchingResult = false,
    collected: readonly ShiftCardSnapshot[] = []): void {
    const history = readHistory(storage)
    if (history === undefined && storage.getItem(SHIFT_STORE_KEYS.history) !== null) throw new Error('Invalid shift history')
    const existing = history?.results.find((entry) => entry.shiftRunId === result.shiftRunId)
    if (existing && requireMatchingResult && JSON.stringify(existing) !== JSON.stringify(result)) throw new Error('Conflicting finished shift result')
    const cards = new Map((history?.cards ?? []).map(card => [card.id, card]))
    for (const card of collected) {
      const previous = cards.get(card.id)
      if (previous && JSON.stringify(previous) !== JSON.stringify(card)) throw new Error('Conflicting collected card')
      cards.set(card.id, card)
    }
    // A legacy result can already exist while its cards still need to be adopted.
    if (existing && cards.size === (history?.cards.length ?? 0)) return
    writeEnvelope(storage, SHIFT_STORE_KEYS.history, 'shift-history', {
      results: existing ? history!.results : [...history?.results ?? [], result], cards: [...cards.values()],
    }, 2)
  }

  async listFinished(): Promise<readonly ShiftResult[]> {
    return this.readShift((storage) => readHistory(storage)?.results ?? [])
  }

  /** Immutable production designs are exposed only for collection browsing. */
  async listCollectedCards(): Promise<readonly ShiftCardSnapshot[]> {
    return this.readShift((storage) => {
      const cards = new Map((readHistory(storage)?.cards ?? []).map(card => [card.id, card]))
      for (const card of this.readCollection(storage, false).cards) cards.set(card.id, card)
      return [...cards.values()]
    })
  }

  async listWorkshopDrafts(): Promise<readonly WorkshopDraft[]> {
    return this.readShift(storage => this.readCollection(storage, false).drafts)
  }

  private readCollection(storage: ShiftEnvelopeStorage, strict = true): ShiftCollection {
    const raw = storage.getItem(SHIFT_STORE_KEYS.collection)
    if (raw === null) return { cards: [], drafts: [] }
    const envelope: unknown = JSON.parse(raw)
    if (object(envelope) && envelope.kind === 'shift-collection') {
      const value = envelope.version === 1 ? { cards: envelope.value, drafts: [] }
        : envelope.version === 2 ? envelope.value : undefined
      if (object(value) && Array.isArray(value.cards) && Array.isArray(value.drafts)) {
        value.drafts.forEach(migrateLegacyWorkshopCustomer)
        const cards = value.cards.filter(isArchive)
        const drafts = value.drafts.filter(isWorkshopDraft)
        // Browsing isolates invalid entries without modifying their stored originals.
        // Mutations remain strict so a later archive cannot silently overwrite corruption.
        if ((!strict || (cards.length === value.cards.length && drafts.length === value.drafts.length))
          && new Set(cards.map(card => card.id)).size === cards.length
          && new Set(drafts.map(draft => draft.id)).size === drafts.length) return clone({ cards, drafts })
      }
    }
    throw new Error('Invalid shift collection')
  }

  private persistCollected(collected: readonly ShiftCardSnapshot[], storage: ShiftEnvelopeStorage): void {
    const collection = this.readCollection(storage)
    const existing = collection.cards
    const cards = new Map(existing.map(card => [card.id, card]))
    const historic = new Map((readHistory(storage)?.cards ?? []).map(card => [card.id, card]))
    for (const card of collected) {
      const previous = cards.get(card.id) ?? historic.get(card.id)
      if (previous && JSON.stringify(previous) !== JSON.stringify(card)) throw new Error('Conflicting collected card')
      cards.set(card.id, card)
    }
    if (cards.size !== existing.length) writeEnvelope(storage, SHIFT_STORE_KEYS.collection, 'shift-collection', { ...collection, cards: [...cards.values()] }, 2)
  }

  private persistWorkshopDrafts(snapshot: ShiftSnapshot, storage: ShiftEnvelopeStorage): void {
    if (snapshot.run.status !== 'settled') return
    const collection = this.readCollection(storage)
    const drafts = new Map(collection.drafts.map(draft => [draft.id, draft]))
    for (const source of Object.values(snapshot.run.drafts)) {
      const order = snapshot.run.orders.find(order => order.id === source.orderId)
      if (source.stage === 'archived' || order?.outcome.status !== 'left'
        || (!source.design.preparation.paperId && source.design.elements.length === 0 && source.design.crafts.length === 0)) continue
      const draft: WorkshopDraft = { kind: 'workshop-draft', version: 1,
        id: `workshop:${encodeURIComponent(snapshot.run.id)}:${encodeURIComponent(source.id)}`,
        shiftRunId: snapshot.run.id, customerName: order.content.customer.name, title: order.content.title,
        savedAtMs: snapshot.run.result.closedAtMs, design: source.design }
      const previous = drafts.get(draft.id)
      if (previous && JSON.stringify(previous) !== JSON.stringify(draft)) throw new Error('Conflicting workshop draft')
      drafts.set(draft.id, draft)
    }
    if (drafts.size !== collection.drafts.length) writeEnvelope(storage, SHIFT_STORE_KEYS.collection, 'shift-collection', { ...collection, drafts: [...drafts.values()] }, 2)
  }

  async loadProgression(): Promise<ShiftProgression> {
    // Old ProgressState.completedCommissionIds has no relationship to authored shift completion.
    return this.readShift((storage) => readEnvelope(storage, SHIFT_STORE_KEYS.progression, 'shift-progression', isProgression) ?? initialProgression())
  }

  async saveProgression(progression: ShiftProgression): Promise<void> {
    if (!isProgression(progression)) throw new Error('Invalid shift progression')
    const candidate = clone(progression)
    return this.withMutationLock((storage) => writeEnvelope(storage, SHIFT_STORE_KEYS.progression, 'shift-progression', candidate))
  }

  private progressionForMutation(storage: ShiftEnvelopeStorage): ShiftProgression {
    const progression = readEnvelope(storage, SHIFT_STORE_KEYS.progression, 'shift-progression', isProgression)
    if (progression === undefined && storage.getItem(SHIFT_STORE_KEYS.progression) !== null) throw new Error('Invalid shift progression')
    return progression ?? initialProgression()
  }

  /** Apply a pure reducer to the latest persisted state while holding the mutation coordinator. */
  async updateProgression(reducer: (progression: ShiftProgression) => ShiftProgression): Promise<ShiftProgression> {
    return this.withMutationLock((storage) => {
      const current = this.progressionForMutation(storage)
      const next = reducer(clone(current))
      if (!isProgression(next)) throw new Error('Invalid shift progression')
      if (JSON.stringify(next) !== JSON.stringify(current)) writeEnvelope(storage, SHIFT_STORE_KEYS.progression, 'shift-progression', next)
      return clone(next)
    })
  }

  /** Record results and their archived artwork together, using the persisted run inside the transaction. */
  async recordSettlement(result: ShiftResult, reducer: (progression: ShiftProgression, result: ShiftResult) => ShiftProgression): Promise<ShiftProgression> {
    if (!isResult(result)) throw new Error('Invalid finished shift result')
    const candidate = clone(result)
    return this.withMutationLock((storage) => {
      const saved = readEnvelope(storage, SHIFT_STORE_KEYS.current, 'shift-current', isSnapshot)
      const source = saved?.run.id === candidate.shiftRunId ? saved
        : this.reconciliationForMutation(storage).find(snapshot => snapshot.run.id === candidate.shiftRunId)
      if (source && (source.run.status !== 'settled' || needsReconciliation(source)
        || JSON.stringify(source.run.result) !== JSON.stringify(candidate))) throw new Error('Settlement does not match a final saved shift')
      const current = this.progressionForMutation(storage)
      const existing = current.results.find((entry) => entry.shiftRunId === candidate.shiftRunId)
      if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) throw new Error('Conflicting settled progression result')
      const next = existing ? current : reducer(clone(current), clone(candidate))
      if (!isProgression(next)) throw new Error('Invalid shift progression')
      const recorded = next.results.filter((entry) => entry.shiftRunId === candidate.shiftRunId)
      if (recorded.length !== 1 || JSON.stringify(recorded[0]) !== JSON.stringify(candidate)) throw new Error('Settlement reducer must record the matching result exactly once')
      this.persistFinished(candidate, storage, true, source ? Object.values(source.run.snapshots) : [])
      this.persistCollected(source ? Object.values(source.run.snapshots) : [], storage)
      if (source) this.persistWorkshopDrafts(source, storage)
      if (JSON.stringify(next) !== JSON.stringify(current)) writeEnvelope(storage, SHIFT_STORE_KEYS.progression, 'shift-progression', next)
      return clone(next)
    }, true)
  }

  /** Read the persisted calibration transaction before any service call. Bind the returned receipt through the engine. */
  async recoverPendingPrint(intentId: string, gateway: PrintShopGateway, shiftRunId?: string): Promise<Extract<PrintReceipt, { status: 'accepted' }> | undefined> {
    const current = await this.loadCurrent()
    const matches = (snapshot: ShiftSnapshot) => (shiftRunId === undefined || snapshot.run.id === shiftRunId)
      && Object.hasOwn(snapshot.run.authorizations, intentId)
    const snapshot = current !== undefined && matches(current) ? current : (await this.listReconciliations()).find(matches)
    return snapshot === undefined ? undefined : recoverPendingShiftPrint(snapshot, gateway, intentId)
  }
}

/**
 * Use a snapshot returned by saveCurrent/loadCurrent. Keeping an old settled snapshot here allows
 * background reconciliation without consulting or mutating the new shift's printers.
 * Calibration must already be persisted; this helper never releases reservations or mints IDs.
 */
export async function recoverPendingShiftPrint(
  snapshot: ShiftSnapshot, gateway: PrintShopGateway, intentId: string,
): Promise<Extract<PrintReceipt, { status: 'accepted' }> | undefined> {
  if (!isSnapshot(snapshot)) throw new Error('Invalid snapshot context for pending print recovery')
  const authorization = snapshot.run.authorizations[intentId]
  if (authorization?.status !== 'calibrated_pending_start') return undefined
  const reservation = snapshot.run.printers[authorization.machineId]?.reservations.find((entry) => entry.id === authorization.reservationId)
  if (authorization.id !== intentId || authorization.shiftRunId !== snapshot.run.id
    || !snapshot.run.snapshotIds.includes(authorization.snapshotId) || !machine(authorization.machineId)
    || reservation?.status !== 'calibrated_pending_start' || reservation.intentId !== intentId
    || reservation.shiftRunId !== authorization.shiftRunId || reservation.machineId !== authorization.machineId
    || reservation.orderId !== authorization.orderId || reservation.puzzleId !== authorization.puzzleId) {
    throw new Error('Pending print context does not match its persisted shift reservation')
  }
  const record = await gateway.findByIntent(intentId)
    ?? await gateway.startShift(intentId, authorization.snapshotId, authorization.machineId, authorization.shiftRunId)
  assertPrintIntentMatches(record, intentId, authorization.snapshotId, {
    kind: 'shift', machineId: authorization.machineId, shiftRunId: authorization.shiftRunId,
  })
  return toShiftPrintReceipt(record)
}
