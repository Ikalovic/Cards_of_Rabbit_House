import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createPrintRecord, assertPrintIntentMatches, type PrintRecord, type SaveCardCommand } from '../src/domain/gateways'
import type { MachineId, PuzzleAnswer } from '../src/domain/shift-types'
import type { PrivatePuzzleInstance } from './private-puzzle-types'
import { createPuzzle, gradePuzzle, revealPuzzle, toPublicPuzzleInstance } from './puzzles'
import { ServerCardStore } from './card-store'
import { renderWorkshop } from './workshop-renderer'

const COOKIE = 'rabbit_house_candidate'
const CURRENT = 'rabbit-house:v1:shift-current'
const RECONCILIATION = 'rabbit-house:v1:shift-reconciliation'
const BODY_LIMIT = 2 * 1024 * 1024
type ObjectValue = Record<string, unknown>
type CandidateSession = {
  id: string
  csrfToken: string
  storage: Record<string, string>
  revision: number
  puzzles: Map<string, PrivatePuzzleInstance>
  prints: Map<string, PrintRecord>
  logicalTimes: Map<string, number>
  cards: ServerCardStore
}

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: ObjectValue = {}) { super(message) }
}

const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const machine = (value: unknown): value is MachineId => value === 'quick' || value === 'fine'
function invalid(message = 'Invalid request'): never { throw new RequestError(400, 'INVALID_REQUEST', message) }
function conflict(message: string): never { throw new RequestError(409, 'INVALID_STATE', message) }

function exactKeys(value: unknown, keys: readonly string[], optional: readonly string[] = []): asserts value is ObjectValue {
  if (!object(value) || keys.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !keys.includes(key) && !optional.includes(key))) invalid()
}

function answer(value: unknown): value is PuzzleAnswer {
  if (!object(value)) return false
  const numbers = (input: unknown) => Array.isArray(input) && input.length <= 1024 && input.every(integer)
  const strings = (input: unknown) => Array.isArray(input) && input.length <= 256 && input.every(identifier)
  switch (value.kind) {
    case 'number-search': return Object.keys(value).length === 2 && integer(value.index)
    case 'connect': return Object.keys(value).length === 2 && strings(value.path)
    case 'identify': return Object.keys(value).length === 2 && identifier(value.optionId)
    case 'minesweeper': return Object.keys(value).length === 3 && numbers(value.revealedIndices) && numbers(value.flaggedIndices)
    case 'sudoku': return Object.keys(value).length === 2 && numbers(value.cells)
    case 'math-choice': return Object.keys(value).length === 2 && strings(value.optionIds)
    case 'math-fill': return Object.keys(value).length === 2 && typeof value.text === 'string' && value.text.length <= 8192
    default: return false
  }
}

async function jsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    req.resume()
    throw new RequestError(415, 'JSON_REQUIRED', 'An application/json body is required')
  }
  if (Number(req.headers['content-length']) > BODY_LIMIT) {
    req.resume()
    throw new RequestError(413, 'BODY_TOO_LARGE', 'Request body is too large')
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > BODY_LIMIT) throw new RequestError(413, 'BODY_TOO_LARGE', 'Request body is too large')
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new RequestError(400, 'INVALID_JSON', 'Request body must be valid JSON') }
}

function storedRuns(session: CandidateSession, reconciliation: boolean): ObjectValue[] {
  const result: ObjectValue[] = []
  for (const [key, kind] of [[CURRENT, 'shift-current'], ...(reconciliation ? [[RECONCILIATION, 'shift-reconciliation']] : [])]) {
    const raw = session.storage[key]
    if (raw === undefined) continue
    try {
      const envelope: unknown = JSON.parse(raw)
      if (!object(envelope) || envelope.version !== 1 || envelope.kind !== kind) continue
      const snapshots = kind === 'shift-current' ? [envelope.value] : Array.isArray(envelope.value) ? envelope.value : []
      for (const snapshot of snapshots) if (object(snapshot) && object(snapshot.run)) result.push(snapshot.run)
    } catch { /* A malformed save cannot authorize a puzzle or print. */ }
  }
  return result
}

function context(session: CandidateSession, runId: string, intentId: string, machineId: MachineId, reconciliation = false) {
  const run = storedRuns(session, reconciliation).find((entry) => entry.id === runId)
  if (!run || !identifier(run.seed) || !object(run.authorizations) || !object(run.snapshots) || !Array.isArray(run.orders)
    || !object(run.printers) || !object(run.printers[machineId]) || !object(run.stage)) conflict('The saved shift cannot authorize this request')
  const authorization = run.authorizations[intentId]
  if (!object(authorization) || authorization.id !== intentId || authorization.shiftRunId !== runId
    || !identifier(authorization.orderId) || !identifier(authorization.snapshotId)) conflict('Print authorization is missing')
  const order = run.orders.find((entry: unknown) => object(entry) && entry.id === authorization.orderId)
  const snapshot = run.snapshots[authorization.snapshotId]
  if (!object(order) || !object(order.outcome) || !object(snapshot) || snapshot.id !== authorization.snapshotId
    || snapshot.shiftRunId !== runId || snapshot.orderId !== authorization.orderId) conflict('The saved print snapshot does not match its order')
  return { run, authorization, order, snapshot, printer: run.printers[machineId] as ObjectValue }
}

/** One instance belongs to one process boot. Nothing is persisted across restarts. */
export function createGameService(options: { now?: () => number; bootId?: string } = {}) {
  const now = options.now ?? Date.now
  const bootId = options.bootId ?? randomUUID()
  const sessions = new Map<string, CandidateSession>()
  const reply = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.end(JSON.stringify(value))
  }
  const state = (session: CandidateSession) => ({ bootId, sessionId: session.id, csrfToken: session.csrfToken, storage: session.storage, revision: session.revision, serverNowMs: now() })
  function sessionFor(req: IncomingMessage, res: ServerResponse): CandidateSession {
    const cookies = req.headers.cookie?.split(';').map((value) => value.trim()) ?? []
    const supplied = cookies.find((value) => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
    const existing = supplied ? sessions.get(supplied) : undefined
    if (existing) return existing
    const id = randomUUID()
    const csrfToken = randomUUID()
    const session: CandidateSession = { id, csrfToken, storage: {}, revision: 0, puzzles: new Map(), prints: new Map(), logicalTimes: new Map(), cards: new ServerCardStore(() => new Date(now()).toISOString()) }
    sessions.set(id, session)
    res.setHeader('set-cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`)
    return session
  }
  function logicalNow(session: CandidateSession, run: ObjectValue): number {
    if (!identifier(run.id) || (run.inspectionTimeOffsetMs !== undefined && !integer(run.inspectionTimeOffsetMs))) conflict('Invalid shift clock')
    const at = now() + (typeof run.inspectionTimeOffsetMs === 'number' ? run.inspectionTimeOffsetMs : 0)
    if (!Number.isSafeInteger(at)) conflict('Invalid shift clock')
    const monotonic = Math.max(at, session.logicalTimes.get(run.id) ?? at)
    session.logicalTimes.set(run.id, monotonic)
    return monotonic
  }
  function puzzleContext(session: CandidateSession, puzzle: PrivatePuzzleInstance) {
    const saved = context(session, puzzle.shiftRunId, puzzle.intentId, puzzle.machineId, true)
    if (saved.authorization.orderId !== puzzle.orderId || saved.authorization.machineId !== puzzle.machineId) conflict('The puzzle no longer matches its print intent')
    return saved
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://game.local')
      const path = url.pathname
      if (path === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        res.end(req.method === 'HEAD' ? undefined : 'ok\n')
        return
      }
      res.setHeader('cache-control', 'no-store')
      if (!path.startsWith('/api/')) throw new RequestError(404, 'NOT_FOUND', 'Not found')
      const requestedBoot = req.headers['x-game-boot']
      if (requestedBoot !== undefined && requestedBoot !== bootId) throw new RequestError(409, 'BOOT_CHANGED', 'The game service restarted', { bootId })
      const mutation = !['GET', 'HEAD'].includes(req.method ?? '')
      if (mutation) {
        if (requestedBoot === undefined) throw new RequestError(428, 'BOOT_REQUIRED', 'Load the current game session first', { bootId })
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, 'ORIGIN_REJECTED', 'Cross-site requests are not allowed')
        const origin = req.headers.origin
        if (origin) {
          let allowed = false
          try { allowed = new URL(origin).host === req.headers.host } catch { /* Reject malformed origins. */ }
          if (!allowed) throw new RequestError(403, 'ORIGIN_REJECTED', 'Cross-site requests are not allowed')
        }
      }
      const session = sessionFor(req, res)
      if (mutation) {
        const suppliedCsrf = req.headers['x-csrf-token']
        if (suppliedCsrf !== session.csrfToken) throw new RequestError(403, 'CSRF_REJECTED', 'CSRF token mismatch')
      }
      if ((path === '/api/session' || path === '/api/storage') && req.method === 'GET') {
        reply(res, 200, state(session))
        return
      }
      if (path === '/api/cards' && req.method === 'GET') {
        reply(res, 200, { cards: session.cards.list(session.id), serverNowMs: now() })
        return
      }
      if (path === '/api/cards' && req.method === 'POST') {
        const body = await jsonBody(req)
        exactKeys(body, ['requestId', 'design'], ['commissionId'])
        if (!identifier(body.requestId) || !object(body.design)
          || (body.commissionId !== undefined && !['chino', 'rize', 'chiya-sharo'].includes(String(body.commissionId)))) invalid()
        const command: SaveCardCommand = {
          requestId: body.requestId,
          design: body.design as never,
          ...(body.commissionId === undefined ? {} : { commissionId: body.commissionId as never }),
        }
        try {
          const card = await session.cards.save(session.id, command)
          reply(res, 201, { card, serverNowMs: now() })
        } catch (error) {
          if (String(error).includes('REQUEST_CONFLICT')) throw new RequestError(409, 'REQUEST_CONFLICT', 'This request ID is bound to a different command')
          throw error
        }
        return
      }
      const cardRoute = /^\/api\/cards\/([^/]+)$/u.exec(path)
      if (cardRoute && req.method === 'GET') {
        let cardId: string
        try { cardId = decodeURIComponent(cardRoute[1]) } catch { invalid() }
        const card = session.cards.get(session.id, cardId!)
        reply(res, 200, { card: card ?? null, serverNowMs: now() })
        return
      }
      if (path === '/api/storage' && req.method === 'PUT') {
        const body = await jsonBody(req)
        exactKeys(body, ['expectedRevision', 'values'])
        if (!integer(body.expectedRevision) || !object(body.values) || Object.keys(body.values).length > 128) invalid()
        const values: Record<string, string> = {}
        for (const [key, value] of Object.entries(body.values)) {
          if (!key || key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(key) || typeof value !== 'string') invalid('Storage keys and values must be strings')
          values[key] = value
        }
        if (body.expectedRevision !== session.revision) throw new RequestError(409, 'STORAGE_CONFLICT', 'The save changed in another request', state(session))
        session.storage = values
        session.revision++
        reply(res, 200, state(session))
        return
      }
      if (path === '/api/puzzles/begin' && req.method === 'POST') {
        const body = await jsonBody(req)
        exactKeys(body, ['shiftRunId', 'intentId', 'machineId'])
        if (!identifier(body.shiftRunId) || !identifier(body.intentId) || !machine(body.machineId)) invalid()
        const { run, authorization, order, printer } = context(session, body.shiftRunId, body.intentId, body.machineId)
        if (run.status !== 'running' || run.station !== 'print' || run.selectedOrderId !== authorization.orderId
          || (order.outcome as ObjectValue).status !== 'pending') conflict('This order is not ready for calibration')
        const attempt = authorization.status === 'calibrating' ? authorization.attempt : authorization.nextAttempt
        if (!integer(attempt) || attempt < 1) conflict('Invalid calibration attempt')
        const existing = [...session.puzzles.values()].find((entry) => entry.shiftRunId === body.shiftRunId && entry.intentId === body.intentId
          && entry.machineId === body.machineId && entry.attempt === attempt)
        if (existing) {
          reply(res, 200, { puzzle: toPublicPuzzleInstance(existing), serverNowMs: now() })
          return
        }
        if (!['confirmed', 'failed', 'calibrating'].includes(String(authorization.status))
          || (attempt === 1 && authorization.machineId !== body.machineId)) conflict('This print intent cannot begin another calibration')
        const at = logicalNow(session, run)
        const locks = object(printer.orderLockUntilMs) ? printer.orderLockUntilMs : {}
        const reservations = Array.isArray(printer.reservations) ? printer.reservations : []
        const queued = Array.isArray(printer.queuedTaskIds) ? printer.queuedTaskIds : []
        const ownsReservation = reservations.some((entry) => object(entry) && entry.intentId === body.intentId)
        if ((typeof locks[authorization.orderId as string] === 'number' && (locks[authorization.orderId as string] as number) > at)
          || (!ownsReservation && Number(Boolean(printer.currentTaskId)) + queued.length + reservations.length >= 3)) conflict('The printer is unavailable')
        const stage = run.stage as ObjectValue
        const scheduled = Array.isArray(stage.customers) ? stage.customers.find((entry) => object(entry) && entry.id === authorization.orderId) : undefined
        const plan = object(scheduled) && object(scheduled.calibrationPlan) ? scheduled.calibrationPlan[body.machineId] : undefined
        const difficulty = stage.kind === 'survival' ? stage.hardPuzzleWeight : stage.puzzleDifficulty ?? 0
        if (typeof difficulty !== 'number' || !Number.isFinite(difficulty) || difficulty < 0 || difficulty > 1) conflict('Invalid puzzle difficulty')
        const puzzle = createPuzzle({ shiftSeed: run.seed as string, shiftRunId: body.shiftRunId, orderId: authorization.orderId as string,
          intentId: body.intentId, machineId: body.machineId, attempt, startedAtMs: at, difficulty,
          ...(plan === 'math' || plan === 'sudoku' || plan === 'minesweeper' ? { calibrationKind: plan } : {}) })
        session.puzzles.set(puzzle.id, puzzle)
        reply(res, 200, { puzzle: toPublicPuzzleInstance(puzzle), serverNowMs: now() })
        return
      }
      const puzzleRoute = /^\/api\/puzzles\/([^/]+)\/(submit|reveal|exit)$/u.exec(path)
      if (puzzleRoute && req.method === 'POST') {
        let puzzleId: string
        try { puzzleId = decodeURIComponent(puzzleRoute[1]) } catch { invalid() }
        const puzzle = session.puzzles.get(puzzleId!)
        if (!puzzle) throw new RequestError(404, 'PUZZLE_NOT_FOUND', 'Puzzle not found')
        const body = await jsonBody(req)
        const { run } = puzzleContext(session, puzzle)
        const at = logicalNow(session, run)
        if (puzzleRoute[2] === 'submit') {
          exactKeys(body, ['answer'])
          if (!answer(body.answer)) invalid('Invalid puzzle answer')
          const result = gradePuzzle(puzzle, body.answer, at)
          session.puzzles.set(puzzle.id, { ...puzzle, result })
          reply(res, 200, { result, serverNowMs: now() })
        } else if (puzzleRoute[2] === 'reveal') {
          exactKeys(body, ['index'])
          if (!integer(body.index)) invalid('Invalid cell index')
          let updated: PrivatePuzzleInstance
          try { updated = revealPuzzle(puzzle, body.index, at) }
          catch (error) { if (error instanceof RangeError) invalid('Invalid cell index'); throw error }
          session.puzzles.set(puzzle.id, updated!)
          reply(res, 200, { puzzle: toPublicPuzzleInstance(updated!), result: updated!.result, serverNowMs: now() })
        } else {
          exactKeys(body, [])
          const result = puzzle.result.status === 'pending'
            ? { status: 'failed' as const, failedAtMs: Math.min(at, puzzle.deadlineAtMs), reason: at > puzzle.deadlineAtMs ? 'timeout' as const : 'exit' as const, answer: null }
            : puzzle.result
          session.puzzles.set(puzzle.id, { ...puzzle, result })
          reply(res, 200, { result, serverNowMs: now() })
        }
        return
      }
      if (path === '/api/prints/workshop' && req.method === 'POST') {
        const body = await jsonBody(req)
        exactKeys(body, ['intentId', 'snapshotId'])
        if (!identifier(body.intentId) || !identifier(body.snapshotId)) invalid()
        const printContext = { kind: 'workshop' as const }
        const existing = session.prints.get(body.intentId)
        if (existing) {
          try { assertPrintIntentMatches(existing, body.intentId, body.snapshotId, printContext) } catch { conflict('Print intent context does not match') }
          reply(res, 200, { record: existing, serverNowMs: now() })
          return
        }
        const record = createPrintRecord(body.intentId, body.snapshotId, printContext, new Date(now()).toISOString())
        try {
          const rendered = await renderWorkshop(record, session.cards, session.id)
          const complete = { ...record, ...rendered }
          session.prints.set(body.intentId, complete)
          reply(res, 200, { record: complete, serverNowMs: now() })
        } catch (error) {
          const message = String(error)
          const failed = { ...record, status: 'failed' as const }
          session.prints.set(body.intentId, failed)
          if (message.includes('CARD_NOT_FOUND')) throw new RequestError(404, 'CARD_NOT_FOUND', 'Card not found')
          reply(res, 200, { record: failed, serverNowMs: now() })
        }
        return
      }
      if (path === '/api/prints/shift' && req.method === 'POST') {
        const body = await jsonBody(req)
        exactKeys(body, ['intentId', 'snapshotId', 'machineId', 'shiftRunId'])
        if (!identifier(body.intentId) || !identifier(body.snapshotId) || !identifier(body.shiftRunId) || !machine(body.machineId)) invalid()
        const printContext = { kind: 'shift' as const, machineId: body.machineId, shiftRunId: body.shiftRunId }
        const existing = session.prints.get(body.intentId)
        if (existing) {
          try { assertPrintIntentMatches(existing, body.intentId, body.snapshotId, printContext) } catch { conflict('Print intent context does not match') }
          reply(res, 200, { record: existing, serverNowMs: now() })
          return
        }
        const { run, authorization, order, printer } = context(session, body.shiftRunId, body.intentId, body.machineId, true)
        const puzzle = typeof authorization.puzzleId === 'string' ? session.puzzles.get(authorization.puzzleId) : undefined
        const reservation = Array.isArray(printer.reservations) ? printer.reservations.find((entry) => object(entry)
          && entry.id === authorization.reservationId && entry.intentId === body.intentId && entry.shiftRunId === body.shiftRunId
          && entry.orderId === authorization.orderId && entry.puzzleId === authorization.puzzleId && entry.machineId === body.machineId
          && entry.status === 'calibrated_pending_start') : undefined
        if (authorization.status !== 'calibrated_pending_start' || authorization.machineId !== body.machineId || authorization.snapshotId !== body.snapshotId
          || !puzzle || puzzle.result.status !== 'succeeded' || puzzle.shiftRunId !== body.shiftRunId || puzzle.intentId !== body.intentId
          || puzzle.orderId !== authorization.orderId || puzzle.machineId !== body.machineId || !reservation || (order.outcome as ObjectValue).status !== 'pending') {
          throw new RequestError(403, 'CALIBRATION_REQUIRED', 'A server-verified calibration is required before printing')
        }
        const record = createPrintRecord(body.intentId, body.snapshotId, printContext, new Date(logicalNow(session, run)).toISOString())
        session.prints.set(body.intentId, record)
        reply(res, 200, { record, serverNowMs: now() })
        return
      }
      if (req.method === 'GET' && path === '/api/prints') {
        reply(res, 200, { records: [...session.prints.values()], serverNowMs: now() })
        return
      }
      if (req.method === 'GET' && path === '/api/prints/intent') {
        const intentId = url.searchParams.get('intentId')
        if (!identifier(intentId) || [...url.searchParams.keys()].some((key) => key !== 'intentId')) invalid()
        reply(res, 200, { record: session.prints.get(intentId) ?? null, serverNowMs: now() })
        return
      }
      if (req.method === 'GET' && path.startsWith('/api/prints/')) {
        let id: string
        try { id = decodeURIComponent(path.slice('/api/prints/'.length)) } catch { invalid() }
        const record = [...session.prints.values()].find((entry) => entry.printJobId === id!)
        reply(res, 200, { record: record ?? null, serverNowMs: now() })
        return
      }
      throw new RequestError(404, 'NOT_FOUND', 'API endpoint not found')
    } catch (error) {
      if (res.headersSent) { res.end(); return }
      if (error instanceof RequestError) reply(res, error.status, { code: error.code, message: error.message, ...error.details })
      else {
        console.error('Game API request failed', error)
        reply(res, 500, { code: 'INTERNAL_ERROR', message: 'The game service could not complete this request' })
      }
    }
  }
  return { bootId, handle }
}
