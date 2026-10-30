import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { AUTHORED_STAGES } from '../content/production'
import type { PrintShopGateway } from '../domain/gateways'
import { advanceShift, finishClosedShiftPrints, initializeShift, shiftTimeAt, transitionShift, type ShiftEngineAction, type ShiftPuzzleServices } from '../domain/shift-engine'
import type { ControlledPauseReason, CustomerOrder, ShiftRun, ShiftSnapshot, StageDefinition, StationId } from '../domain/shift-types'
import { BrowserPrintShop } from '../infrastructure/browser-store'
import { BrowserShiftStore, ShiftStoreConflictError } from '../infrastructure/shift-store'
import { beginServerPuzzle, exitServerPuzzle, revealServerPuzzle, submitServerPuzzle } from '../infrastructure/puzzle-api'

export type ShiftStore = Pick<BrowserShiftStore, 'inspectCurrent' | 'loadCurrent' | 'saveCurrent' | 'saveArchive' | 'recoverPendingPrint'
  | 'listReconciliations' | 'saveReconciliation' | 'finalizeReconciliation'>
export type TickScheduler = (tick: () => void) => () => void
export type ShiftContextValue = Readonly<{
  run: ShiftRun | null
  status: 'loading' | 'ready' | 'error'
  origin: 'started' | 'resumed' | null
  displayNowMs: number
  remainingMs: number
  remainingSeconds: number
  selectedOrderId: string | null
  selectedOrder: CustomerOrder | null
  station: StationId
  error: string | null
  notice: string | null
  dispatch: (action: ShiftEngineAction) => Promise<void>
  revealPuzzle: (puzzleId: string, index: number) => Promise<void>
  tick: () => Promise<void>
  pause: (reason: ControlledPauseReason) => Promise<void>
  resume: () => Promise<void>
  clearNotice: () => void
}>
export type ShiftProviderProps = PropsWithChildren<{
  stage?: StageDefinition
  runId?: string
  now?: () => number
  /** Null lets a host clock call tick explicitly. */
  scheduleTick?: TickScheduler | null
  store?: ShiftStore
  gateway?: PrintShopGateway
}>
type View = Pick<ShiftContextValue, 'run' | 'status' | 'origin' | 'displayNowMs' | 'error' | 'notice'>
type Session = {
  active: boolean
  run: ShiftRun | null
  revision: number | undefined
  saved: ShiftSnapshot | null
  queue: Promise<void>
  inflight: Set<string>
  retries: Map<string, { attempts: number; nextAtMs: number }>
  checkingOldRuns: boolean
  nextOldCheckAtMs: number
  dispatch: (action: ShiftEngineAction) => Promise<void>
  revealPuzzle: (puzzleId: string, index: number) => Promise<void>
  tick: () => Promise<void>
}
const ShiftContext = createContext<ShiftContextValue | null>(null)
const browserClock: TickScheduler = tick => {
  const handle = window.setInterval(tick, 250)
  return () => window.clearInterval(handle)
}
const initialView: View = { run: null, status: 'loading', origin: null, displayNowMs: 0, error: null, notice: null }
const saveError = '营业记录暂时没能记好。请保留这个页面，稍后操作时会再次尝试。'
const printError = '冲印确认暂时未送达，已保留这张卡和原来的机位，请稍后重试。'
const oldPrintError = '往日的冲印记录暂时没能整理好，已保留原来的卡片和机位，稍后会继续整理。'
const retryIntervalMs = 5_000
const maxRecoveryRequests = 2

function pendingPrints(run: ShiftRun): string[] {
  return Object.values(run.authorizations).filter(authorization => authorization.status === 'calibrated_pending_start').map(authorization => authorization.id)
}

function closeOldRun(run: ShiftRun, at: number): ShiftRun {
  const offset = run.inspectionTimeOffsetMs ?? 0
  const resumed = run.status === 'paused' ? transitionShift(run, { type: 'resume' }, Math.max(at, run.pause.startedAtMs - offset)) : run
  return finishClosedShiftPrints(advanceShift(resumed, Math.max(at, resumed.deadlineAtMs - offset)))
}

function damagedSettlement(stage: StageDefinition, id: string, at: number): ShiftRun {
  const run = advanceShift(initializeShift(stage, id, at - stage.durationSeconds * 1000), at)
  if (run.status !== 'settled') throw new Error('Cannot settle damaged shift')
  return { ...run, result: { ...run.result, passed: false, failureReasons: [...run.result.failureReasons, 'corrupt-save'] } }
}

/** Compare domain events, deliberately excluding continuously derived countdown values. */
function timelineState(run: ShiftRun): string {
  return JSON.stringify({
    status: run.status,
    orders: run.orders.map(order => [order.id, order.arrivalAtMs <= run.lastProcessedAtMs, order.position, order.patience.phase, order.outcome.status]),
    puzzles: Object.values(run.puzzles).map(puzzle => [puzzle.id, puzzle.result.status]),
    authorizations: Object.values(run.authorizations).map(authorization => [authorization.id, authorization.status]),
    tasks: Object.values(run.tasks).map(task => [task.id, task.status]),
    printers: run.printers,
    pending: run.pendingReconciliationIntentIds,
  })
}
function displayTime(run: ShiftRun, nowMs: number): number {
  if (run.status === 'paused') return run.pause.startedAtMs
  if (run.status === 'settled') return run.result.closedAtMs
  return Math.max(run.lastProcessedAtMs, shiftTimeAt(run, nowMs))
}

export function ShiftProvider({ children, stage = AUTHORED_STAGES.tutorial, runId, now = Date.now, scheduleTick = browserClock, store, gateway }: ShiftProviderProps) {
  const [defaults] = useState(() => ({ store: store ?? new BrowserShiftStore(), gateway: gateway ?? new BrowserPrintShop() }))
  const activeStore = store ?? defaults.store
  const activeGateway = gateway ?? defaults.gateway
  const [view, setView] = useState<View>(initialView)
  const sessionRef = useRef<Session | null>(null)

  useEffect(() => {
    const session: Session = { active: true, run: null, revision: undefined, saved: null, queue: Promise.resolve(), inflight: new Set(),
      retries: new Map(), checkingOldRuns: false, nextOldCheckAtMs: -Infinity, dispatch: async () => {}, revealPuzzle: async () => {}, tick: async () => {} }
    sessionRef.current = session
    setView(initialView)
    let stopClock: (() => void) | undefined
    const alive = () => session.active && sessionRef.current === session
    const publish = (patch: Partial<View>) => { if (alive()) setView(previous => ({ ...previous, ...patch })) }
    const showRun = (run: ShiftRun, at: number) => {
      session.run = run
      publish({ run, displayNowMs: displayTime(run, at) })
    }
    const enqueue = (work: () => Promise<void>): Promise<void> => {
      const task = session.queue.then(async () => { if (alive()) await work() })
      session.queue = task.catch((error: unknown) => { publish({ error: error instanceof Error ? error.message : saveError }) })
      return session.queue
    }

    async function persist(run: ShiftRun, archive = false): Promise<boolean> {
      if (!alive()) return false
      try {
        const snapshot: ShiftSnapshot = { version: 1, revision: (session.revision ?? 0) + 1, savedAtMs: now(), run }
        const saved = await (archive ? activeStore.saveArchive(snapshot, session.revision) : activeStore.saveCurrent(snapshot, session.revision))
        if (!alive()) return false
        session.saved = saved
        session.revision = saved.revision
        publish({ error: null })
        return true
      } catch (error) {
        if (!alive()) return false
        if (error instanceof ShiftStoreConflictError) {
          const latest = await activeStore.loadCurrent()
          if (!alive()) return false
          if (!latest || latest.run.id !== run.id) {
            session.run = null
            publish({ run: null, status: 'error', error: '另一处已经开始了新的营业，请回到店门重新查看营业记录。' })
            return false
          }
          session.saved = latest
          session.revision = latest.revision
          const advanced = advanceShift(latest.run, now())
          showRun(advanced, now())
          publish({ notice: '另一处的营业记录已更新，已为你取回最新进度。', error: null })
          // Retry only the newly observed time event; never replay an outdated player action.
          if (timelineState(latest.run) !== timelineState(advanced)) {
            try {
              const saved = await activeStore.saveCurrent({ version: 1, revision: latest.revision + 1, savedAtMs: now(), run: advanced }, latest.revision)
              if (!alive()) return false
              session.saved = saved
              session.revision = saved.revision
            } catch { publish({ error: saveError }); return false }
          }
          return true
        }
        publish({ error: saveError })
        return false
      }
    }

    const recoveryKey = (originalRunId: string, intentId: string) => JSON.stringify([originalRunId, intentId])
    function beginRecovery(key: string): boolean {
      const previous = session.retries.get(key)
      if (!alive() || session.inflight.size >= maxRecoveryRequests || session.inflight.has(key) || now() < (previous?.nextAtMs ?? -Infinity)) return false
      const attempts = Math.min((previous?.attempts ?? 0) + 1, 5)
      session.retries.set(key, { attempts, nextAtMs: now() + Math.min(60_000, retryIntervalMs * 2 ** (attempts - 1)) })
      session.inflight.add(key)
      return true
    }

    function reconcileCurrent(): void {
      if (!alive() || !session.saved || !session.run || session.run.status === 'paused') return
      const savedRun = session.saved.run
      for (const intentId of pendingPrints(savedRun)) {
        const originalRunId = savedRun.id
        const key = recoveryKey(originalRunId, intentId)
        if (session.run.authorizations[intentId]?.status !== 'calibrated_pending_start' || !beginRecovery(key)) continue
        void activeStore.recoverPendingPrint(intentId, activeGateway, originalRunId).then(receipt => {
          if (!alive() || session.run?.id !== originalRunId || !receipt) return
          return enqueue(async () => {
            if (!session.run || session.run.id !== originalRunId) return
            const next = transitionShift(session.run, { station: 'print', type: 'record-receipt', receipt }, now())
            showRun(next, now())
            if (await persist(next)) session.retries.delete(key)
          })
        }).catch(() => { publish({ error: printError }) }).finally(() => { session.inflight.delete(key) })
      }
    }

    async function reconcileOldRuns(): Promise<void> {
      if (!alive() || session.checkingOldRuns || now() < session.nextOldCheckAtMs) return
      session.checkingOldRuns = true
      session.nextOldCheckAtMs = now() + retryIntervalMs
      let requests = 0
      try {
        const snapshots = await activeStore.listReconciliations()
        let unfinished = false
        for (const snapshot of snapshots) {
          if (!alive()) return
          if (snapshot.run.id === session.run?.id) continue
          try {
            let saved = snapshot
            const saveOldRun = async (run: ShiftRun) => {
              if (!alive()) return
              saved = await activeStore.saveReconciliation({ version: 1, revision: saved.revision + 1, savedAtMs: now(), run }, saved.revision)
            }
            // Replacing a current slot can preserve a still-open run. Close it before
            // querying the service; only this original run owns its printer state.
            const closed = closeOldRun(saved.run, now())
            if (JSON.stringify(closed) !== JSON.stringify(saved.run)) await saveOldRun(closed)
            for (const intentId of pendingPrints(saved.run)) {
              if (requests >= maxRecoveryRequests) break
              const key = recoveryKey(saved.run.id, intentId)
              if (!beginRecovery(key)) continue
              requests += 1
              try {
                const receipt = await activeStore.recoverPendingPrint(intentId, activeGateway, saved.run.id)
                if (!alive()) return
                if (!receipt) continue
                const bound = transitionShift(saved.run, { station: 'print', type: 'record-receipt', receipt }, now())
                await saveOldRun(finishClosedShiftPrints(bound))
                session.retries.delete(key)
              } finally { session.inflight.delete(key) }
            }
            if (!alive()) return
            if (saved.run.status === 'settled' && !pendingPrints(saved.run).length && !saved.run.pendingReconciliationIntentIds.length) {
              // Commit history and removal together so concurrent old runs cannot lose a result.
              await activeStore.finalizeReconciliation(saved.run.id, saved.run.result, saved.revision)
            } else unfinished = true
          } catch { unfinished = true; publish({ error: oldPrintError }) }
        }
        if (!unfinished && alive()) setView(previous => previous.error === oldPrintError ? { ...previous, error: null } : previous)
      } catch { publish({ error: oldPrintError }) }
      finally { session.checkingOldRuns = false }
    }

    function reconcile(): void {
      reconcileCurrent()
      void reconcileOldRuns()
    }

    async function apply(action?: ShiftEngineAction): Promise<void> {
      const previous = session.run
      if (!previous) return
      let at = now()
      let services: ShiftPuzzleServices | undefined
      if (action?.type === 'begin-calibration') {
        if (!(await persist(previous))) return
        const reply = await beginServerPuzzle(previous.id, action.intentId, action.machineId)
        if (!alive()) return
        at = reply.puzzle.startedAtMs - (previous.inspectionTimeOffsetMs ?? 0)
        services = { createPuzzle: () => reply.puzzle, gradePuzzle: () => { throw new Error('校准结果须由店里的冲印机确认。') } }
      } else if (action?.type === 'submit-puzzle') {
        const reply = await submitServerPuzzle(action.puzzleId, action.answer)
        if (!alive()) return
        at = reply.serverNowMs
        services = { createPuzzle: () => { throw new Error('请重新确认校准。') }, gradePuzzle: () => reply.result }
      } else if (action?.type === 'exit-puzzle') {
        await exitServerPuzzle(action.puzzleId)
        if (!alive()) return
      }
      const next = action ? transitionShift(previous, action, at, services) : advanceShift(previous, at)
      if (action?.type === 'archive' && next.snapshotIds.length > previous.snapshotIds.length) {
        if (await persist(next, true)) showRun(session.saved!.run, at)
        reconcile()
        return
      }
      showRun(next, at)
      const readyNames = Object.values(next.tasks).filter(task => task.status === 'ready' && previous.tasks[task.id]?.status !== 'ready')
        .map(task => next.orders.find(order => order.id === task.orderId)?.content.customer.name ?? '客人')
      if (readyNames.length) publish({ notice: `冲印完成：${[...new Set(readyNames)].join('、')}的卡片已放上成品架，记得亲手交付。` })
      const transaction = action && action.type !== 'advance-time' && JSON.stringify(previous) !== JSON.stringify(next)
      const timedEvent = timelineState(previous) !== timelineState(next)
      if (transaction || timedEvent) {
        await persist(next)
      }
      // Ordinary display ticks also retry persisted work, subject to cooldowns.
      reconcile()
    }
    session.dispatch = action => enqueue(() => apply(action))
    session.revealPuzzle = (puzzleId, index) => enqueue(async () => {
      const previous = session.run
      const current = previous?.puzzles[puzzleId]
      if (!previous || !current || current.result.status !== 'pending') return
      const reply = await revealServerPuzzle(puzzleId, index)
      if (!alive()) return
      let next: ShiftRun = { ...previous, puzzles: { ...previous.puzzles, [puzzleId]: reply.puzzle } }
      if (reply.result && reply.result.status !== 'pending') {
        // Keep the pending public instance until the engine consumes the server's failure result.
        next = transitionShift({ ...next, puzzles: { ...next.puzzles, [puzzleId]: { ...reply.puzzle, result: { status: 'pending' } } } },
          { station: 'print', type: 'submit-puzzle', puzzleId, answer: { kind: 'minesweeper', revealedIndices: [], flaggedIndices: [] } }, reply.serverNowMs,
          { createPuzzle: () => reply.puzzle, gradePuzzle: () => reply.result! })
      }
      showRun(next, reply.serverNowMs)
      await persist(next)
    })
    session.tick = () => enqueue(() => apply())
    session.queue = (async () => {
      try {
        const inspected = await activeStore.inspectCurrent()
        if (!alive()) return
        const current = inspected.status === 'valid' ? inspected.snapshot : undefined
        const resume = current !== undefined && (runId ? current.run.id === runId : current.run.stage.id === stage.id)
        session.revision = current?.revision
        session.saved = resume ? current : null
        const at = now()
        const id = runId ?? `shift:${stage.id}:${at}`
        const previous = inspected.status === 'corrupt' ? damagedSettlement(stage, id, at)
          : resume ? current.run : initializeShift(stage, id, at)
        const run = advanceShift(previous, at)
        session.run = run
        if (!resume || timelineState(previous) !== timelineState(run)) await persist(run)
        if (!alive() || !session.run) return
        publish({ status: 'ready', origin: resume || inspected.status === 'corrupt' ? 'resumed' : 'started', run: session.run, displayNowMs: displayTime(session.run, at),
          ...(inspected.status === 'corrupt' ? { notice: '营业记录有些破损，本班已结束。收藏册和已冲印的卡片仍然保留。' } : {}) })
        reconcile()
        if (scheduleTick) stopClock = scheduleTick(() => { void session.tick() })
      } catch {
        publish({ status: 'error', error: '暂时无法打开营业记录，请回到店门后再试一次。' })
      }
    })()
    return () => { session.active = false; stopClock?.() }
  }, [activeGateway, activeStore, now, runId, scheduleTick, stage])

  const value = useMemo<ShiftContextValue>(() => {
    const remainingMs = view.run?.status === 'settled' ? 0 : Math.max(0, (view.run?.deadlineAtMs ?? view.displayNowMs) - view.displayNowMs)
    const dispatch = async (action: ShiftEngineAction) => { await sessionRef.current?.dispatch(action) }
    return {
      ...view, remainingMs, remainingSeconds: Math.ceil(remainingMs / 1000),
      selectedOrderId: view.run?.selectedOrderId ?? null,
      selectedOrder: view.run?.orders.find(order => order.id === view.run?.selectedOrderId && order.position === 'active') ?? null,
      station: view.run?.station ?? 'reception', dispatch,
      revealPuzzle: async (puzzleId, index) => { await sessionRef.current?.revealPuzzle(puzzleId, index) },
      tick: async () => { await sessionRef.current?.tick() },
      pause: reason => dispatch({ type: 'pause', reason }), resume: () => dispatch({ type: 'resume' }),
      clearNotice: () => setView(previous => ({ ...previous, notice: null })),
    }
  }, [view])
  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
}

export function useShift(): ShiftContextValue {
  const context = useContext(ShiftContext)
  if (!context) throw new Error('ShiftProvider is required')
  return context
}
