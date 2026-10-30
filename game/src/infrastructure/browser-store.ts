import {
  assertPrintIntentMatches, createPrintRecord,
  type CardLibraryGateway, type PrintContext, type PrintRecord, type PrintShopGateway,
  type SaveCardCommand,
} from '../domain/gateways'
import type { MachineId } from '../domain/shift-types'
import { examRequest, examStorage, hasExamSession, withExamMutation } from './exam-session'
import type {
  CardId,
  CardSourceSummary,
  PrintJob,
  PrintJobId,
  PrintStatus,
  SavedCard,
} from '../domain/types'

const STORE_PREFIX = 'rabbit-house:v1'
const PRINT_INTENT_PREFIX = 'rabbit-house:v2:print-intent:'

export const BROWSER_STORE_KEYS = Object.freeze({
  // v1 keys remain read-only migration sources for the old workshop UI.
  cards: `${STORE_PREFIX}:cards`,
  printJobs: `${STORE_PREFIX}:print-jobs`,
  printTokens: `${STORE_PREFIX}:print-tokens`,
  cardLibrary: 'rabbit-house:v2:card-library',
  prints: 'rabbit-house:v2:prints',
  printLease: 'rabbit-house:v2:prints:lease',
  printIntent: (intentId: string) => `${PRINT_INTENT_PREFIX}${encodeURIComponent(intentId)}`,
  session: (sessionName: string) => `${STORE_PREFIX}:session:${encodeURIComponent(sessionName)}`,
})

type PrintTokenBinding = Readonly<{
  requestToken: string
  printJobId: PrintJobId
}>

const clone = <T>(value: T): T => structuredClone(value)
const defaultStorage = (): Storage => examStorage()

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readValue(storage: Storage, key: string): unknown {
  const raw = storage.getItem(key)
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function isCardSource(value: unknown): value is CardSourceSummary {
  return isObject(value) && value.kind === 'native'
}

function isCard(value: unknown): value is SavedCard {
  if (!isObject(value) || typeof value.cardId !== 'string' || typeof value.savedAt !== 'string'
    || !isObject(value.design) || value.design.version !== 1
    || !['cream', 'coffee', 'mint', 'pink'].includes(String(value.design.paperId)) || !Array.isArray(value.design.layers)) return false
  // A missing source is an older local card; readCards migrates it to native on read.
  if (value.source !== undefined && !isCardSource(value.source)) return false
  return value.design.layers.every((layer) => isObject(layer) && typeof layer.id === 'string'
    && ['sticker', 'text-stamp', 'stroke'].includes(String(layer.kind)))
    && (value.commissionId === undefined || ['chino', 'rize', 'chiya-sharo'].includes(String(value.commissionId)))
}

/** Read-only migration: older local cards without a source read back as native. */
function withSource(card: SavedCard): SavedCard {
  return card.source === undefined ? { ...card, source: { kind: 'native' } } : card
}

function readCards(storage: Storage, forMutation = false): SavedCard[] {
  if (storage.getItem(BROWSER_STORE_KEYS.cardLibrary) !== null) {
    const value = readValue(storage, BROWSER_STORE_KEYS.cardLibrary)
    if (isObject(value) && value.version === 2 && value.kind === 'card-library'
      && Array.isArray(value.cards) && value.cards.every(isCard)) return value.cards.map(withSource)
    if (forMutation) throw new Error('Corrupt card-library envelope; mutation refused')
    return []
  }
  const legacy = readValue(storage, BROWSER_STORE_KEYS.cards)
  return Array.isArray(legacy) ? legacy.filter(isCard).map(withSource) : []
}

function writeValue(storage: Storage, key: string, value: unknown) {
  storage.setItem(key, JSON.stringify(value))
}

function nextNumericId(values: readonly string[], prefix: string) {
  const maximum = values.reduce((currentMaximum, value) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(value)
    return match === null ? currentMaximum : Math.max(currentMaximum, Number(match[1]))
  }, 0)
  return `${prefix}-${maximum + 1}`
}

export class BrowserCardLibrary implements CardLibraryGateway {
  constructor(
    private readonly storage: Storage = defaultStorage(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async save(command: SaveCardCommand): Promise<SavedCard> {
    if (hasExamSession()) return (await examRequest<{ card: SavedCard }>('/api/cards', command)).card
    return this.store((cards) => ({
      cardId: nextNumericId(cards.map((card) => card.cardId), 'card'),
      design: clone(command.design),
      source: { kind: 'native' },
      ...(command.commissionId === undefined ? {} : { commissionId: command.commissionId }),
      savedAt: this.now(),
    }))
  }

  private store(build: (cards: readonly SavedCard[]) => SavedCard): Promise<SavedCard> {
    return withExamMutation(() => {
      const cards = readCards(this.storage, true)
      const snapshot = build(cards)
      writeValue(this.storage, BROWSER_STORE_KEYS.cardLibrary, { version: 2, kind: 'card-library', cards: [...cards, snapshot] })
      return clone(snapshot)
    })
  }

  async get(cardId: CardId): Promise<SavedCard | undefined> {
    if (hasExamSession()) return (await examRequest<{ card: SavedCard | null }>(`/api/cards/${encodeURIComponent(cardId)}`)).card ?? undefined
    const card = readCards(this.storage).find(
      (candidate) => candidate.cardId === cardId,
    )
    return card === undefined ? undefined : clone(card)
  }

  async list(): Promise<readonly SavedCard[]> {
    if (hasExamSession()) return (await examRequest<{ cards: readonly SavedCard[] }>('/api/cards')).cards
    return clone(readCards(this.storage))
  }
}

type PrintEnvelope = {
  version: 2
  kind: 'prints'
  revision: number
  jobs: PrintRecord[]
  intents: Record<string, string>
}

const emptyPrints = (): PrintEnvelope => ({ version: 2, kind: 'prints', revision: 0, jobs: [], intents: {} })

function isLegacyJob(value: unknown): value is PrintJob {
  return isObject(value) && typeof value.printJobId === 'string' && typeof value.cardId === 'string'
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && ['queued', 'processing', 'succeeded', 'failed'].includes(String(value.status))
}

function isPrintRecord(value: unknown): value is PrintRecord {
  if (!isLegacyJob(value) || !('context' in value) || !isObject(value.context)
    || !('intentId' in value) || typeof value.intentId !== 'string'
    || !('snapshotId' in value) || typeof value.snapshotId !== 'string' || value.snapshotId !== value.cardId
    || !('receiptId' in value) || typeof value.receiptId !== 'string') return false
  return value.context.kind === 'workshop'
    ? !('machineId' in value.context) && !('shiftRunId' in value.context)
    : value.context.kind === 'shift' && ['quick', 'fine'].includes(String(value.context.machineId))
      && typeof value.context.shiftRunId === 'string' && value.context.shiftRunId.length > 0
}

function isPrintEnvelope(value: unknown): value is PrintEnvelope {
  if (!isObject(value) || value.version !== 2 || value.kind !== 'prints' || !Number.isSafeInteger(value.revision)
    || !Array.isArray(value.jobs) || !value.jobs.every(isPrintRecord) || !isObject(value.intents)) return false
  const intents = value.intents
  const jobs = value.jobs
  return new Set(jobs.map((job) => job.printJobId)).size === jobs.length
    && new Set(jobs.map((job) => job.intentId)).size === jobs.length
    && Object.entries(intents).every(([intentId, taskId]) => typeof taskId === 'string'
      && jobs.some((job) => job.printJobId === taskId && job.intentId === intentId))
    && jobs.every((job) => Object.hasOwn(intents, job.intentId) && intents[job.intentId] === job.printJobId)
}

function readAggregatePrints(storage: Storage, forMutation: boolean): PrintEnvelope {
  if (storage.getItem(BROWSER_STORE_KEYS.prints) !== null) {
    const value = readValue(storage, BROWSER_STORE_KEYS.prints)
    if (isPrintEnvelope(value)) return value
    if (forMutation) throw new Error('Corrupt print envelope; mutation refused')
    return emptyPrints()
  }
  const legacyJobs = readValue(storage, BROWSER_STORE_KEYS.printJobs)
  const legacyBindings = readValue(storage, BROWSER_STORE_KEYS.printTokens)
  const bindings: PrintTokenBinding[] = Array.isArray(legacyBindings) ? legacyBindings.filter(
    (value): value is PrintTokenBinding => isObject(value) && typeof value.requestToken === 'string' && typeof value.printJobId === 'string',
  ) : []
  const envelope = emptyPrints()
  for (const job of Array.isArray(legacyJobs) ? legacyJobs.filter(isLegacyJob) : []) {
    if (envelope.jobs.some((existing) => existing.printJobId === job.printJobId)) continue
    const binding = bindings.find((entry) => entry.printJobId === job.printJobId && !Object.hasOwn(envelope.intents, entry.requestToken))
    let intentId = binding?.requestToken ?? `legacy-job:${job.printJobId}`
    while (Object.hasOwn(envelope.intents, intentId)) intentId = `legacy:${intentId}`
    envelope.jobs.push({ ...job, intentId, snapshotId: job.cardId, receiptId: `receipt:${job.printJobId}`, context: { kind: 'workshop' } })
    envelope.intents = { ...envelope.intents, [intentId]: job.printJobId }
  }
  return envelope
}

/**
 * Without Web Locks, one atomic envelope per intent is authoritative. There is no shared
 * index to lose on a late write: enumerate Storage keys and merge the legacy/locked aggregate.
 * A per-intent record supersedes the aggregate copy when that intent has been updated locally.
 * Callers must assign each intent ID to exactly one immutable snapshot/context and reuse that
 * same context on retries. Separate keys protect different intents, not concurrent contradictory
 * claims of the same ID; strict arbitration of those claims requires Web Locks or a server.
 */
function readPrints(storage: Storage, forMutation = false): PrintEnvelope {
  const envelope = readAggregatePrints(storage, forMutation)
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(PRINT_INTENT_PREFIX)) keys.push(key)
  }
  for (const key of keys.sort()) {
    const value = readValue(storage, key)
    if (!isObject(value) || value.version !== 2 || value.kind !== 'print-intent' || !isPrintRecord(value.record)
      || BROWSER_STORE_KEYS.printIntent(value.record.intentId) !== key) {
      if (forMutation) throw new Error('Corrupt per-intent print envelope; mutation refused')
      return emptyPrints()
    }
    const record = value.record
    const existing = findIntent(envelope, record.intentId)
    if (existing !== undefined) {
      try { assertPrintIntentMatches(existing, record.intentId, record.snapshotId, record.context) }
      catch {
        if (forMutation) throw new Error('Corrupt print intent context; mutation refused')
        return emptyPrints()
      }
      if (existing.printJobId !== record.printJobId || existing.receiptId !== record.receiptId) {
        if (forMutation) throw new Error('Corrupt print intent identity; mutation refused')
        return emptyPrints()
      }
    }
    envelope.jobs = envelope.jobs.filter((job) => job.intentId !== record.intentId)
    envelope.jobs.push(record)
    envelope.intents = { ...envelope.intents, [record.intentId]: record.printJobId }
  }
  if (!isPrintEnvelope(envelope)) {
    if (forMutation) throw new Error('Corrupt merged print envelope; mutation refused')
    return emptyPrints()
  }
  return envelope
}

function findIntent(envelope: PrintEnvelope, intentId: string): PrintRecord | undefined {
  if (!Object.hasOwn(envelope.intents, intentId)) return undefined
  return envelope.jobs.find((job) => job.printJobId === envelope.intents[intentId])
}

export interface PrintLockCoordinator {
  request<T>(name: string, action: () => T | Promise<T>): Promise<T>
}

export type BrowserPrintOptions = Readonly<{
  /** null deliberately selects the bounded fallback, useful outside browsers with Web Locks. */
  locks?: PrintLockCoordinator | null
  maxAttempts?: number
  /** Synchronization identity/clock injection is independent of all gameplay randomness. */
  ownerId?: string
  leaseNow?: () => number
  leaseWait?: (milliseconds: number) => Promise<void>
  leaseDurationMs?: number
}>

type PrintLease = Readonly<{ version: 1; kind: 'print-lease'; owner: string; expiresAtMs: number }>

function readLease(storage: Storage): PrintLease | undefined {
  const value = readValue(storage, BROWSER_STORE_KEYS.printLease)
  return isObject(value) && value.version === 1 && value.kind === 'print-lease'
    && typeof value.owner === 'string' && value.owner.trim().length > 0
    && typeof value.expiresAtMs === 'number' && Number.isFinite(value.expiresAtMs) && value.expiresAtMs >= 0
    ? { version: 1, kind: 'print-lease', owner: value.owner, expiresAtMs: value.expiresAtMs } : undefined
}

class PrintLeaseLost extends Error {
  constructor() { super('Print lease ownership expired or changed') }
}

function browserLocks(): PrintLockCoordinator | undefined {
  if (typeof navigator === 'undefined' || !navigator.locks) return undefined
  return { request: (name, action) => navigator.locks.request(name, () => action()) }
}

export class BrowserPrintShop implements PrintShopGateway {
  private readonly locks: PrintLockCoordinator | null | undefined
  private readonly maxAttempts: number
  private readonly ownerId: string
  private readonly leaseNow: () => number
  private readonly leaseWait: (milliseconds: number) => Promise<void>
  private readonly leaseDurationMs: number
  private leaseSequence = 0

  constructor(
    private readonly storage: Storage = defaultStorage(),
    private readonly now: () => string = () => new Date().toISOString(),
    options: BrowserPrintOptions = {},
  ) {
    if (options.ownerId !== undefined && (typeof options.ownerId !== 'string' || !options.ownerId.trim())) {
      throw new Error('Print lease ownerId must be a nonempty string')
    }
    if (options.leaseNow !== undefined && typeof options.leaseNow !== 'function') throw new Error('Print lease clock must be callable')
    if (options.leaseWait !== undefined && typeof options.leaseWait !== 'function') throw new Error('Print lease wait must be callable')
    if (options.leaseDurationMs !== undefined && (!Number.isFinite(options.leaseDurationMs) || options.leaseDurationMs <= 0)) {
      throw new Error('Print lease duration must be positive and finite')
    }
    this.locks = options.locks === undefined ? browserLocks() : options.locks
    this.maxAttempts = Math.max(1, Math.min(10, Math.floor(options.maxAttempts ?? 4) || 4))
    this.ownerId = options.ownerId ?? (globalThis.crypto.randomUUID?.()
      ?? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4))).join('-'))
    const leaseNow = options.leaseNow ?? Date.now
    this.leaseNow = () => {
      const time = leaseNow()
      if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) throw new Error('Print lease clock must return a finite nonnegative time')
      return time
    }
    this.leaseWait = options.leaseWait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.leaseDurationMs = Math.max(100, Math.min(10_000, options.leaseDurationMs ?? 1_000))
  }

  /** @deprecated Workshop-only adapter for the existing UI. */
  async start(cardId: CardId, requestToken: string): Promise<PrintRecord> {
    return this.startWorkshop(requestToken, cardId)
  }

  async startShift(intentId: string, snapshotId: string, machineId: MachineId, shiftRunId: string): Promise<PrintRecord> {
    if (hasExamSession()) return (await examRequest<{ record: PrintRecord }>('/api/prints/shift', { intentId, snapshotId, machineId, shiftRunId })).record
    return this.startIntent(intentId, snapshotId, { kind: 'shift', machineId, shiftRunId })
  }

  async startWorkshop(intentId: string, snapshotId: string): Promise<PrintRecord> {
    if (hasExamSession()) return (await examRequest<{ record: PrintRecord }>('/api/prints/workshop', { intentId, snapshotId })).record
    return this.startIntent(intentId, snapshotId, { kind: 'workshop' })
  }

  private async startIntent(intentId: string, snapshotId: string, context: PrintContext): Promise<PrintRecord> {
    const existing = findIntent(readPrints(this.storage, true), intentId)
    if (existing !== undefined) {
      assertPrintIntentMatches(existing, intentId, snapshotId, context)
      return clone(existing)
    }
    let candidate: PrintRecord | undefined
    const record = await this.mutate((envelope) => {
      const existing = findIntent(envelope, intentId)
      if (existing !== undefined) {
        assertPrintIntentMatches(existing, intentId, snapshotId, context)
        return { record: existing, changed: false }
      }
      candidate ??= createPrintRecord(intentId, snapshotId, context, this.now())
      envelope.jobs.push(candidate)
      envelope.intents = { ...envelope.intents, [intentId]: candidate.printJobId }
      return { record: candidate, changed: true }
    })
    return record!
  }

  /**
   * The lease reduces duplicate same-intent work but is not a compare-and-swap guarantee.
   * Independent intents are protected by their separate authoritative keys even if an owner
   * resumes between the final ownership check and setItem. Web Locks still serialize aggregates.
   */
  private async withLease<T>(transaction: (assertOwner: () => void) => T): Promise<T> {
    const owner = `${this.ownerId}:${++this.leaseSequence}`
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const current = readLease(this.storage)
      if (current !== undefined && current.expiresAtMs > this.leaseNow()) {
        await this.leaseWait(10)
        continue
      }
      const lease: PrintLease = { version: 1, kind: 'print-lease', owner, expiresAtMs: this.leaseNow() + this.leaseDurationMs }
      writeValue(this.storage, BROWSER_STORE_KEYS.printLease, lease)
      try {
        await this.leaseWait(10)
        const assertOwner = () => {
          const persisted = readLease(this.storage)
          if (persisted?.owner !== owner || persisted.expiresAtMs <= this.leaseNow()) throw new PrintLeaseLost()
        }
        assertOwner()
        return transaction(assertOwner)
      } catch (error) {
        if (!(error instanceof PrintLeaseLost)) throw error
      } finally {
        if (readLease(this.storage)?.owner === owner) this.storage.removeItem(BROWSER_STORE_KEYS.printLease)
      }
    }
    throw new Error('Print lease timeout: retry the same intent')
  }

  /** One atomic job+intent write per commit; fallback commits never replace the shared aggregate. */
  private async mutate(change: (envelope: PrintEnvelope) => { record?: PrintRecord; changed: boolean }): Promise<PrintRecord | undefined> {
    // Reject corrupt state before even an advisory lease write.
    readPrints(this.storage, true)
    const transaction = (assertOwner: () => void = () => undefined) => {
      for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
        assertOwner()
        const envelope = readPrints(this.storage, true)
        const { record, changed } = change(envelope)
        if (!changed) return record === undefined ? undefined : clone(record)
        envelope.revision += 1
        assertOwner()
        if (record !== undefined && (!this.locks || this.storage.getItem(BROWSER_STORE_KEYS.printIntent(record.intentId)) !== null)) {
          writeValue(this.storage, BROWSER_STORE_KEYS.printIntent(record.intentId), { version: 2, kind: 'print-intent', record })
        } else writeValue(this.storage, BROWSER_STORE_KEYS.prints, envelope)
        assertOwner()
        const persisted = readPrints(this.storage, true)
        const verified = record === undefined ? undefined : findIntent(persisted, record.intentId)
        if (verified !== undefined && JSON.stringify(verified) === JSON.stringify(record)) return clone(verified)
      }
      throw new Error('Print storage conflict: retry the same intent')
    }
    return withExamMutation(() => this.locks ? this.locks.request(BROWSER_STORE_KEYS.prints, () => transaction()) : this.withLease(transaction))
  }

  async findByIntent(intentId: string): Promise<PrintRecord | undefined> {
    if (hasExamSession()) return (await examRequest<{ record: PrintRecord | null }>(`/api/prints/intent?intentId=${encodeURIComponent(intentId)}`)).record ?? undefined
    const record = findIntent(readPrints(this.storage), intentId)
    return record === undefined ? undefined : clone(record)
  }

  async get(printJobId: PrintJobId): Promise<PrintRecord | undefined> {
    if (hasExamSession()) return (await examRequest<{ record: PrintRecord | null }>(`/api/prints/${encodeURIComponent(printJobId)}`)).record ?? undefined
    const job = readPrints(this.storage).jobs.find(
      (candidate) => candidate.printJobId === printJobId,
    )
    return job === undefined ? undefined : clone(job)
  }

  async list(): Promise<readonly PrintRecord[]> {
    if (hasExamSession()) return (await examRequest<{ records: readonly PrintRecord[] }>('/api/prints')).records
    return clone(readPrints(this.storage).jobs)
  }

  /** Local workshop status simulation; shift scheduling remains the engine's responsibility. */
  async advance(printJobId: PrintJobId, status: PrintStatus): Promise<PrintRecord | undefined> {
    if (hasExamSession()) return this.get(printJobId)
    return this.mutate((envelope) => {
      const index = envelope.jobs.findIndex((job) => job.printJobId === printJobId)
      if (index < 0) return { changed: false }
      const existing = envelope.jobs[index]
      if (existing.status === status) return { record: existing, changed: false }
      const record = { ...existing, status }
      envelope.jobs[index] = record
      return { record, changed: true }
    })
  }
}

export class BrowserSessionStore<T> {
  readonly #key: string

  constructor(
    sessionName: string,
    private readonly storage: Storage = defaultStorage(),
  ) {
    this.#key = BROWSER_STORE_KEYS.session(sessionName)
  }

  async load(): Promise<T | undefined> {
    const raw = this.storage.getItem(this.#key)
    if (raw === null) return undefined
    try {
      return clone(JSON.parse(raw) as T)
    } catch {
      return undefined
    }
  }

  async save(value: T): Promise<void> {
    return withExamMutation(() => writeValue(this.storage, this.#key, clone(value)))
  }

  async clear(): Promise<void> {
    return withExamMutation(() => this.storage.removeItem(this.#key))
  }
}
