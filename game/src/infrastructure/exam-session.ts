import type { ShiftTransactionCoordinator, ShiftEnvelopeStorage } from './shift-store'

type SessionPayload = Readonly<{
  bootId: string; sessionId: string; csrfToken: string; storage: Record<string, string>; revision: number; serverNowMs: number
}>
type Session = { bootId: string; sessionId: string; csrfToken: string; revision: number; values: Map<string, string>; offsetMs: number }
let session: Session | undefined
let writes: Promise<unknown> = Promise.resolve()
let requestFetch: typeof fetch = (...args) => globalThis.fetch(...args)

export class ExamSessionRestartedError extends Error {
  constructor() { super('服务已重新启动，本次存档已清空，请刷新页面重新开始。'); this.name = 'ExamSessionRestartedError' }
}
export class ExamStorageConflictError extends Error {
  constructor() { super('另一页面已更新存档，请重新打开当前班次。'); this.name = 'ExamStorageConflictError' }
}

const storage: Storage = {
  get length() { return session?.values.size ?? 0 },
  clear() { session?.values.clear() },
  getItem(key) { return session?.values.get(key) ?? null },
  key(index) { return [...(session?.values.keys() ?? [])][index] ?? null },
  removeItem(key) { session?.values.delete(key) },
  setItem(key, value) {
    if (!session) throw new Error('考生会话尚未连接。')
    session.values.set(String(key), String(value))
  },
}

function accept(payload: SessionPayload): void {
  if (typeof payload.bootId !== 'string' || typeof payload.sessionId !== 'string'
    || typeof payload.csrfToken !== 'string' || !payload.csrfToken
    || !Number.isSafeInteger(payload.revision) || !payload.storage || typeof payload.storage !== 'object'
    || !Object.values(payload.storage).every(value => typeof value === 'string') || !Number.isFinite(payload.serverNowMs)) {
    throw new Error('服务返回了无效的会话。')
  }
  session = { bootId: payload.bootId, sessionId: payload.sessionId, csrfToken: payload.csrfToken, revision: payload.revision,
    values: new Map(Object.entries(payload.storage)), offsetMs: payload.serverNowMs - Date.now() }
}

/** Called before mounting React; old browser saves are deliberately not imported. */
export async function bootstrapExamSession(fetcher: typeof fetch = (...args) => globalThis.fetch(...args)): Promise<void> {
  requestFetch = fetcher
  const response = await requestFetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error('暂时无法连接考试服务，请稍后重试。')
  accept(await response.json() as SessionPayload)
  writes = Promise.resolve()
}

export const hasExamSession = () => session !== undefined
export const examStorage = (): Storage => session ? storage : window.localStorage
export const examNow = () => Date.now() + (session?.offsetMs ?? 0)

export async function examRequest<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  if (!session) throw new Error('考生会话尚未连接。')
  const response = await requestFetch(path, { method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Game-Boot': session.bootId, 'X-CSRF-Token': session.csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const payload = await response.json() as Record<string, unknown>
  if (payload.code === 'BOOT_CHANGED') {
    session.values.clear()
    window.dispatchEvent(new Event('exam-session-restarted'))
    throw new ExamSessionRestartedError()
  }
  if (payload.code === 'STORAGE_CONFLICT') {
    if (payload.storage && Number.isSafeInteger(payload.revision)) {
      session.values = new Map(Object.entries(payload.storage as Record<string, string>))
      session.revision = payload.revision as number
    }
    throw new ExamStorageConflictError()
  }
  if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : '服务暂时未能完成这次操作。')
  if (Number.isFinite(payload.serverNowMs)) session.offsetMs = (payload.serverNowMs as number) - Date.now()
  return payload as T
}

/** Serialize all game stores through one atomic server commit. No browser persistence is used. */
export function withExamMutation<T>(action: () => T | Promise<T>): Promise<T> {
  if (!session) return Promise.resolve().then(action)
  const task = writes.then(async () => {
    if (!session) throw new Error('考生会话尚未连接。')
    const before = new Map(session.values)
    const revision = session.revision
    try {
      const result = await action()
      const values = Object.fromEntries(session.values)
      if (JSON.stringify([...before]) !== JSON.stringify([...session.values])) {
        const payload = await examRequest<SessionPayload>('/api/storage', { expectedRevision: revision, values }, 'PUT')
        // Keep object identity stable for synchronous Storage users.
        session.revision = payload.revision
      }
      return result
    } catch (error) {
      if (!(error instanceof ExamStorageConflictError) && !(error instanceof ExamSessionRestartedError)) session.values = before
      throw error
    }
  })
  writes = task.catch(() => undefined)
  return task
}

export const waitForExamWrites = async () => { await writes }

/** Reuses existing envelope validation while making multi-record writes atomic on the server. */
export class ExamShiftCoordinator implements ShiftTransactionCoordinator {
  run<T>(_legacy: ShiftEnvelopeStorage, mode: 'readonly' | 'readwrite', _migrate: boolean,
    action: (value: ShiftEnvelopeStorage) => T): Promise<T> {
    return mode === 'readonly' ? Promise.resolve(action(storage)) : withExamMutation(() => action(storage))
  }
}
