import { createServer, request, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createGameService } from './service'
import { createPuzzle } from './puzzles'

const NOW = 1_800_000_000_000
const servers: Server[] = []
const csrfTokens = new Map<string, string>()

async function start(now: () => number = () => NOW) {
  const service = createGameService({ now })
  const server = createServer(service.handle)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return { service, port: address.port }
}

async function call(port: number, path: string, options: { method?: string; body?: unknown; cookie?: string; boot?: string; raw?: string; origin?: string; csrf?: string } = {}) {
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  const csrf = options.csrf ?? csrfTokens.get(options.cookie ?? '')
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; data: any }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.boot ? { 'x-game-boot': options.boot } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
    } }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { raw += chunk })
      res.on('end', () => {
        const data = raw ? JSON.parse(raw) : null
        const cookie = res.headers['set-cookie']?.[0]?.split(';')[0] ?? options.cookie
        if (cookie && typeof data?.csrfToken === 'string') csrfTokens.set(cookie, data.csrfToken)
        resolve({ status: res.statusCode!, headers: res.headers, data })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

function current(authorization: Record<string, unknown> = {}) {
  return { version: 1, kind: 'shift-current', value: { version: 1, revision: 1, savedAtMs: NOW, run: {
    id: 'run', seed: 'server-test', status: 'running', station: 'print', selectedOrderId: 'order', inspectionTimeOffsetMs: 5000,
    deadlineAtMs: NOW + 300_000,
    stage: { kind: 'authored', puzzleDifficulty: 0, customers: [{ id: 'order', calibrationPlan: { fine: 'minesweeper' } }] },
    orders: [{ id: 'order', outcome: { status: 'pending' } }],
    snapshots: { snapshot: { id: 'snapshot', shiftRunId: 'run', orderId: 'order' } },
    authorizations: { intent: { id: 'intent', shiftRunId: 'run', orderId: 'order', snapshotId: 'snapshot', machineId: 'quick',
      status: 'confirmed', nextAttempt: 1, confirmedAtMs: NOW, ...authorization } },
    printers: { quick: { currentTaskId: null, queuedTaskIds: [], reservations: [], orderLockUntilMs: {} }, fine: { currentTaskId: null, queuedTaskIds: [], reservations: [], orderLockUntilMs: {} } },
  } } }
}

async function candidate(port: number, boot: string, envelope = current()) {
  const response = await call(port, '/api/session')
  const cookie = response.headers['set-cookie']![0].split(';')[0]
  await call(port, '/api/storage', { method: 'PUT', cookie, boot, body: { expectedRevision: 0, values: {
    'rabbit-house:v1:shift-current': JSON.stringify(envelope),
  } } })
  return cookie
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))))
  csrfTokens.clear()
})

describe('anonymous in-memory game service', () => {
  it('isolates cookie sessions, rejects stale writes, and starts a fresh boot without saves', async () => {
    const first = await start()
    const session = await call(first.port, '/api/session')
    const cookie = session.headers['set-cookie']![0].split(';')[0]
    expect(session.headers['set-cookie']![0]).toContain('HttpOnly')
    expect(session.headers['set-cookie']![0]).toContain('SameSite=Lax')
    expect(session.headers['cache-control']).toBe('no-store')
    const saved = await call(first.port, '/api/storage', { method: 'PUT', cookie, boot: first.service.bootId, body: { expectedRevision: 0, values: { progress: 'one' } } })
    expect(saved.data.revision).toBe(1)
    expect((await call(first.port, '/api/storage', { cookie })).data.storage).toEqual({ progress: 'one' })
    expect((await call(first.port, '/api/storage')).data.storage).toEqual({})
    const stale = await call(first.port, '/api/storage', { method: 'PUT', cookie, boot: first.service.bootId, body: { expectedRevision: 0, values: {} } })
    expect(stale.status).toBe(409)
    expect(stale.data.code).toBe('STORAGE_CONFLICT')
    const restarted = await start()
    expect(restarted.service.bootId).not.toBe(first.service.bootId)
    const mismatch = await call(restarted.port, '/api/storage', { cookie, boot: first.service.bootId })
    expect(mismatch.status).toBe(409)
    expect(mismatch.data.code).toBe('BOOT_CHANGED')
    expect((await call(restarted.port, '/api/session', { cookie })).data.storage).toEqual({})
  })

  it('rejects malformed, oversized, foreign-origin and session-spoofing mutations', async () => {
    const { service, port } = await start()
    const session = await call(port, '/api/session')
    const cookie = session.headers['set-cookie']![0].split(';')[0]
    const base = { method: 'PUT', cookie, boot: service.bootId }
    expect((await call(port, '/api/storage', { ...base, csrf: 'wrong-token', body: { expectedRevision: 0, values: {} } })).data.code).toBe('CSRF_REJECTED')
    expect((await call(port, '/api/storage', { ...base, raw: '{' })).status).toBe(400)
    expect((await call(port, '/api/storage', { ...base, body: { expectedRevision: 0, values: { value: 'x'.repeat(2_100_000) } } })).status).toBe(413)
    expect((await call(port, '/api/storage', { ...base, origin: 'https://another.example', body: { expectedRevision: 0, values: {} } })).status).toBe(403)
    expect((await call(port, '/api/storage', { ...base, body: { expectedRevision: 0, values: {}, sessionId: session.data.sessionId } })).status).toBe(400)
  })

  it('saves free-workshop cards without a commission and returns the completed print receipt', async () => {
    const { service, port } = await start()
    const session = await call(port, '/api/session')
    const cookie = session.headers['set-cookie']![0].split(';')[0]
    const base = { method: 'POST', cookie, boot: service.bootId }
    const saved = await call(port, '/api/cards', { ...base, body: {
      requestId: 'free-card', design: { version: 1, paperId: 'cream', layers: [] },
    } })
    expect(saved.status).toBe(201)
    expect(saved.data.card.source.kind).toBe('native')
    const printed = await call(port, '/api/prints/workshop', { ...base, body: {
      intentId: 'free-print', snapshotId: saved.data.card.cardId,
    } })
    expect(printed.status).toBe(200)
    expect(printed.data.record).toMatchObject({ status: 'succeeded', receipt: { bodyText: expect.stringContaining('冲印已完成。') } })
  })

  it('keeps answers private, returns the same begun attempt, and grades against the server clock', async () => {
    let now = NOW
    const { service, port } = await start(() => now)
    const cookie = await candidate(port, service.bootId)
    const begin = () => call(port, '/api/puzzles/begin', { method: 'POST', cookie, boot: service.bootId, body: { shiftRunId: 'run', intentId: 'intent', machineId: 'quick' } })
    const response = await begin()
    expect(response.status).toBe(200)
    expect(response.data.puzzle.startedAtMs).toBe(NOW + 5000)
    expect(JSON.stringify(response.data.puzzle)).not.toMatch(/"(?:seed|correctIndex|correctPath|correctOptionId|acceptedAnswers|solution|mineIndices|explanation)"/u)
    expect((await begin()).data.puzzle).toEqual(response.data.puzzle)
    now = response.data.puzzle.deadlineAtMs
    const late = await call(port, `/api/puzzles/${encodeURIComponent(response.data.puzzle.id)}/submit`, { method: 'POST', cookie, boot: service.bootId, body: { answer: { kind: 'identify', optionId: 'fake' } } })
    expect(late.data.result).toMatchObject({ status: 'failed', reason: 'timeout' })
    const otherSession = await call(port, '/api/session')
    const otherCookie = otherSession.headers['set-cookie']![0].split(';')[0]
    const other = await call(port, `/api/puzzles/${encodeURIComponent(response.data.puzzle.id)}/submit`, { method: 'POST', cookie: otherCookie, boot: service.bootId, body: { answer: { kind: 'identify', optionId: 'fake' } } })
    expect(other.status).toBe(404)
  })

  it('issues idempotent print records only after its own successful grading', async () => {
    const { service, port } = await start()
    const cookie = await candidate(port, service.bootId)
    const begun = await call(port, '/api/puzzles/begin', { method: 'POST', cookie, boot: service.bootId, body: { shiftRunId: 'run', intentId: 'intent', machineId: 'quick' } })
    const puzzle = begun.data.puzzle
    const envelope = current({ status: 'calibrated_pending_start', puzzleId: puzzle.id, reservationId: 'reservation', nextAttempt: 2, calibratedAtMs: NOW + 5000 })
    envelope.value.run.printers.quick.reservations = [{ id: 'reservation', intentId: 'intent', shiftRunId: 'run', orderId: 'order', machineId: 'quick', puzzleId: puzzle.id, status: 'calibrated_pending_start' }] as never[]
    await call(port, '/api/storage', { method: 'PUT', cookie, boot: service.bootId, body: { expectedRevision: 1, values: { 'rabbit-house:v1:shift-current': JSON.stringify(envelope) } } })
    const print = () => call(port, '/api/prints/shift', { method: 'POST', cookie, boot: service.bootId, body: { intentId: 'intent', snapshotId: 'snapshot', machineId: 'quick', shiftRunId: 'run' } })
    expect((await print()).status).toBe(403)
    const secret = createPuzzle({ shiftSeed: 'server-test', shiftRunId: 'run', orderId: 'order', intentId: 'intent', machineId: 'quick', attempt: 1, startedAtMs: NOW + 5000, difficulty: 0 })
    const definition = secret.definition
    const answer = definition.kind === 'identify' ? { kind: definition.kind, optionId: definition.correctOptionId }
      : definition.kind === 'connect' ? { kind: definition.kind, path: definition.correctPath }
        : definition.kind === 'number-search' ? { kind: definition.kind, index: definition.correctIndex } : null
    const result = await call(port, `/api/puzzles/${encodeURIComponent(puzzle.id)}/submit`, { method: 'POST', cookie, boot: service.bootId, body: { answer } })
    expect(result.data.result.status).toBe('succeeded')
    const accepted = await print()
    expect(accepted.status).toBe(200)
    expect((await print()).data.record).toEqual(accepted.data.record)
    expect((await call(port, '/api/prints/intent?intentId=intent', { cookie })).data.record).toEqual(accepted.data.record)
    expect((await call(port, '/api/prints', { cookie })).data.records).toHaveLength(1)
    expect((await call(port, '/api/prints')).data.records).toEqual([])
  })
})
