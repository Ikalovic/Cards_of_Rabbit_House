import type { CardDesign, CardId, CommissionId, PrintJob, PrintJobId, RequestId, SavedCard, ShopReceipt } from './types'
import type { MachineId, PrintReceipt } from './shift-types'

export type PrintContext = Readonly<{ kind: 'workshop' }> | Readonly<{
  kind: 'shift'; machineId: MachineId; shiftRunId: string
}>

/** A service record, not live shift business state. cardId is the old UI alias for snapshotId. */
export type PrintRecord = PrintJob & Readonly<{
  intentId: string
  snapshotId: string
  receiptId: string
  context: PrintContext
  receipt?: ShopReceipt
}>

export type SaveCardCommand = Readonly<{
  requestId: RequestId
  design: CardDesign
  commissionId?: CommissionId
}>

export interface CardLibraryGateway {
  save(command: SaveCardCommand): Promise<SavedCard>
  get(cardId: CardId): Promise<SavedCard | undefined>
  list(): Promise<readonly SavedCard[]>
}

export interface PrintShopGateway {
  startShift(intentId: string, snapshotId: string, machineId: MachineId, shiftRunId: string): Promise<PrintRecord>
  startWorkshop(intentId: string, snapshotId: string): Promise<PrintRecord>
  findByIntent(intentId: string): Promise<PrintRecord | undefined>
  /** @deprecated Workshop compatibility only; shift callers must use startShift after persisted calibration. */
  start(cardId: CardId, requestToken: string): Promise<PrintRecord>
  get(printJobId: PrintJobId): Promise<PrintRecord | undefined>
  list(): Promise<readonly PrintRecord[]>
}

const clone = <T>(value: T): T => structuredClone(value)

export function assertPrintIntentMatches(record: PrintRecord, intentId: string, snapshotId: string, context: PrintContext): void {
  if (record.intentId !== intentId || record.snapshotId !== snapshotId || record.context.kind !== context.kind
    || (context.kind === 'shift' && (record.context.kind !== 'shift'
      || record.context.machineId !== context.machineId || record.context.shiftRunId !== context.shiftRunId))) {
    throw new Error('Print intent context does not match the persisted request')
  }
}

export function createPrintRecord(intentId: string, snapshotId: string, context: PrintContext, createdAt: string): PrintRecord {
  if (!intentId || !snapshotId || !Number.isFinite(Date.parse(createdAt))
    || (context.kind === 'shift' && (!context.shiftRunId || !['quick', 'fine'].includes(context.machineId)))) {
    throw new Error('Invalid print intent context')
  }
  // Injective intent-derived IDs also keep retries stable in the lock-free local adapter.
  const printJobId = `print-intent:${encodeURIComponent(intentId)}`
  return { printJobId, cardId: snapshotId, intentId, snapshotId, receiptId: `receipt:${printJobId}`, context: clone(context), status: 'queued', createdAt }
}

/** Map the service's IDs directly: printJobId -> taskId, receiptId -> receiptId. Never mint IDs on recovery. */
export function toShiftPrintReceipt(record: PrintRecord): Extract<PrintReceipt, { status: 'accepted' }> {
  if (record.context.kind !== 'shift' || !['quick', 'fine'].includes(record.context.machineId)
    || !record.context.shiftRunId || !record.intentId || !record.snapshotId || !record.printJobId
    || !record.receiptId || !Number.isFinite(Date.parse(record.createdAt))) {
    throw new Error('A valid shift print context is required for a shift receipt')
  }
  return {
    status: 'accepted', receiptId: record.receiptId, taskId: record.printJobId,
    intentId: record.intentId, snapshotId: record.snapshotId, machineId: record.context.machineId,
    shiftRunId: record.context.shiftRunId, receivedAtMs: Date.parse(record.createdAt), authority: 'local', details: null,
  }
}

export class InMemoryCardLibrary implements CardLibraryGateway {
  readonly #cards = new Map<CardId, SavedCard>()
  readonly #requests = new Map<RequestId, CardId>()
  #nextCardNumber = 1

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async save(command: SaveCardCommand): Promise<SavedCard> {
    return this.store(command.requestId, (cardId) => ({
      cardId,
      design: clone(command.design),
      source: { kind: 'native' },
      ...(command.commissionId === undefined ? {} : { commissionId: command.commissionId }),
      savedAt: this.now(),
    }))
  }

  private store(requestId: RequestId, build: (cardId: CardId) => SavedCard): SavedCard {
    const existingId = this.#requests.get(requestId)
    if (existingId !== undefined) return clone(this.#cards.get(existingId)!)
    const cardId = `card-${this.#nextCardNumber++}`
    const snapshot = build(cardId)
    this.#cards.set(cardId, snapshot)
    this.#requests.set(requestId, cardId)
    return clone(snapshot)
  }

  async get(cardId: CardId): Promise<SavedCard | undefined> {
    const card = this.#cards.get(cardId)
    return card === undefined ? undefined : clone(card)
  }

  async list(): Promise<readonly SavedCard[]> {
    return [...this.#cards.values()].map(clone)
  }
}

export class InMemoryPrintShop implements PrintShopGateway {
  readonly #jobs = new Map<PrintJobId, PrintRecord>()
  readonly #intents = new Map<string, PrintJobId>()

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  /** @deprecated Workshop-only adapter for the existing UI. */
  async start(cardId: CardId, requestToken: string): Promise<PrintRecord> {
    return this.startWorkshop(requestToken, cardId)
  }

  async startShift(intentId: string, snapshotId: string, machineId: MachineId, shiftRunId: string): Promise<PrintRecord> {
    return this.startIntent(intentId, snapshotId, { kind: 'shift', machineId, shiftRunId })
  }

  async startWorkshop(intentId: string, snapshotId: string): Promise<PrintRecord> {
    return this.startIntent(intentId, snapshotId, { kind: 'workshop' })
  }

  private startIntent(intentId: string, snapshotId: string, context: PrintContext): PrintRecord {
    const existingId = this.#intents.get(intentId)
    if (existingId !== undefined) {
      const existing = this.#jobs.get(existingId)!
      assertPrintIntentMatches(existing, intentId, snapshotId, context)
      return clone(existing)
    }
    const job = createPrintRecord(intentId, snapshotId, context, this.now())
    this.#jobs.set(job.printJobId, job)
    this.#intents.set(intentId, job.printJobId)
    return clone(job)
  }

  async findByIntent(intentId: string): Promise<PrintRecord | undefined> {
    const id = this.#intents.get(intentId)
    return id === undefined ? undefined : this.get(id)
  }

  async get(printJobId: PrintJobId): Promise<PrintRecord | undefined> {
    const job = this.#jobs.get(printJobId)
    return job === undefined ? undefined : clone(job)
  }

  async list(): Promise<readonly PrintRecord[]> {
    return [...this.#jobs.values()].map(clone)
  }
}
