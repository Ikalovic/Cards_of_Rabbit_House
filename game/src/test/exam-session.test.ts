import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.resetModules())

function connection() {
  let bootId = 'boot-one'
  let values: Record<string, string> = { saved: 'server-copy' }
  let revision = 2
  let fail = false
  let conflict = false
  const fetcher = vi.fn(async (path: RequestInfo | URL, options?: RequestInit) => {
    const requestBoot = (options?.headers as Record<string, string> | undefined)?.['X-Game-Boot']
    if (requestBoot && requestBoot !== bootId) return new Response(JSON.stringify({ code: 'BOOT_CHANGED', bootId }), { status: 409 })
    if (options?.method === 'PUT') {
      if ((options.headers as Record<string, string>)['X-CSRF-Token'] !== 'csrf-student-one') {
        return new Response(JSON.stringify({ code: 'CSRF_REJECTED', message: 'CSRF token mismatch' }), { status: 403 })
      }
      if (fail) return new Response(JSON.stringify({ message: 'offline' }), { status: 503 })
      if (conflict) return new Response(JSON.stringify({ code: 'STORAGE_CONFLICT', storage: { latest: 'other-tab' }, revision: 9 }), { status: 409 })
      const body = JSON.parse(options.body as string)
      expect(body.expectedRevision).toBe(revision)
      values = body.values
      revision++
    }
    return new Response(JSON.stringify({ bootId, sessionId: 'student-one', csrfToken: 'csrf-student-one', storage: values, revision, serverNowMs: Date.now() }))
  })
  return { fetcher, fail: () => { fail = true }, conflict: () => { conflict = true }, restart: () => { bootId = 'boot-two'; values = {}; revision = 0 } }
}

describe('server session storage', () => {
  it('loads only this server session and commits writes atomically with its revision', async () => {
    const api = await import('../infrastructure/exam-session')
    const transport = connection()
    localStorage.setItem('old-browser-progress', 'must-not-import')
    await api.bootstrapExamSession(transport.fetcher)
    expect(api.examStorage().getItem('old-browser-progress')).toBeNull()
    expect(api.examStorage().getItem('saved')).toBe('server-copy')
    await api.withExamMutation(() => { api.examStorage().setItem('first', 'a'); api.examStorage().setItem('second', 'b') })
    const puts = transport.fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0][1]!.body as string).values).toEqual({ saved: 'server-copy', first: 'a', second: 'b' })
    expect(localStorage.getItem('first')).toBeNull()
  })

  it('rolls back a failed save and adopts a conflicting server revision without overwriting it', async () => {
    const api = await import('../infrastructure/exam-session')
    const transport = connection()
    await api.bootstrapExamSession(transport.fetcher)
    transport.fail()
    await expect(api.withExamMutation(() => api.examStorage().setItem('unsaved', 'lost'))).rejects.toThrow('offline')
    expect(api.examStorage().getItem('unsaved')).toBeNull()
    const other = connection()
    await api.bootstrapExamSession(other.fetcher)
    other.conflict()
    await expect(api.withExamMutation(() => api.examStorage().setItem('stale', 'ignored'))).rejects.toBeInstanceOf(api.ExamStorageConflictError)
    expect(api.examStorage().getItem('latest')).toBe('other-tab')
    expect(api.examStorage().getItem('stale')).toBeNull()
  })

  it('clears the old cache after a service restart and boots with zero progress', async () => {
    const api = await import('../infrastructure/exam-session')
    const transport = connection()
    await api.bootstrapExamSession(transport.fetcher)
    const restarted = vi.fn()
    window.addEventListener('exam-session-restarted', restarted)
    transport.restart()
    await expect(api.examRequest('/api/storage')).rejects.toBeInstanceOf(api.ExamSessionRestartedError)
    expect(restarted).toHaveBeenCalledOnce()
    expect(api.examStorage().length).toBe(0)
    await api.bootstrapExamSession(transport.fetcher)
    expect(api.examStorage().length).toBe(0)
    window.removeEventListener('exam-session-restarted', restarted)
  })
})
