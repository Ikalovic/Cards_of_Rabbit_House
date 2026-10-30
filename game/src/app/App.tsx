import { useCallback, useEffect, useRef, useState } from 'react'
import { AUTHORED_STAGES } from '../content/production'
import { TUTORIAL_INTERVENTIONS } from '../content/story'
import { cosmeticClasses, unlockSurvivalCosmetics } from '../content/survival-rewards'
import { SurvivalRewards } from '../components/SurvivalRewards'
import { finishClosedShiftPrints, shiftTimeAt } from '../domain/shift-engine'
import { TUTORIAL_STATION_TRIGGERS, type AuthoredStageId, type ShiftCardSnapshot, type ShiftProgression, type ShiftResult as SettledResult, type ShiftRun, type ShiftSnapshot, type StageDefinition, type WorkshopDraft } from '../domain/shift-types'
import { createEditorHistory } from '../domain/editor-history'
import { BrowserShiftStore } from '../infrastructure/shift-store'
import { PrintShopScreen } from '../screens/PrintShopScreen'
import { ShiftDialogue } from '../screens/ShiftDialogue'
import { ShiftResult } from '../screens/ShiftResult'
import { ShiftScreen } from '../screens/ShiftScreen'
import { StampBookScreen } from '../screens/StampBookScreen'
import { TitleScreen } from '../screens/TitleScreen'
import { WorkbenchScreen } from '../screens/WorkbenchScreen'
import { GameProvider, useGame } from './GameProvider'
import { ShiftProvider, useShift, type ShiftStore, type TickScheduler } from './ShiftProvider'
import { beginSurvivalRun, createInitialShiftProgression, nextAuthoredStage, recordShiftResult, survivalStageFor } from './progression'
import { prepareWorkshopTransfer } from './workshop-transfer'
import { AudioProvider, useAudio, useAudioDuck, useSceneMusic } from './AudioProvider'
import { AudioControls } from '../components/AudioControls'
import type { BgmId } from '../content/audio'

export type AppShiftStore = ShiftStore & Pick<BrowserShiftStore, 'loadProgression' | 'recordSettlement' | 'updateProgression' | 'listCollectedCards' | 'listWorkshopDrafts'>
type Route = { kind: 'title' | 'workshop' } | { kind: 'opening'; stageId: AuthoredStageId }
  | { kind: 'shift'; stage: StageDefinition; runId: string; teach: boolean }
type AppProps = Readonly<{ store?: AppShiftStore; now?: () => number; scheduleTick?: TickScheduler | null; createSeed?: () => string }>
const newSeed = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
const saveMessage = '今天的营业簿暂时没能记好，请稍后再试。卡册里的作品会保留。'

function SceneMusic({ track }: { track: BgmId }) {
  useSceneMusic(track)
  return null
}

export function App(props: AppProps = {}) {
  return <AudioProvider><AudioControls /><GameRoutes {...props} /></AudioProvider>
}

/** The legacy editor is contained here; commission dialogue/results cannot enter this route. */
function Workshop({ onTitle, collection, progress }: Readonly<{ onTitle: () => void; collection: Pick<AppShiftStore, 'listCollectedCards' | 'listWorkshopDrafts'>; progress: ShiftProgression }>) {
  const game = useGame()
  useSceneMusic(game.view === 'stampbook' || game.view === 'result' ? 'stampbook' : 'workshop')
  const entered = useRef(false)
  const [productionCards, setProductionCards] = useState<readonly ShiftCardSnapshot[]>([])
  const [workshopDrafts, setWorkshopDrafts] = useState<readonly WorkshopDraft[]>([])
  const [collectionError, setCollectionError] = useState(false)
  const [collectionAttempt, setCollectionAttempt] = useState(0)
  useEffect(() => {
    if (game.hydrated && !entered.current) {
      entered.current = true
      if (game.hasSave && game.progress.mode === 'free') game.openWorkbench()
      else game.startFreeCreate()
    }
  }, [game])
  useEffect(() => {
    if (game.view !== 'stampbook' && game.view !== 'result') { setCollectionError(false); return }
    let active = true
    setCollectionError(false)
    void Promise.all([collection.listCollectedCards(), collection.listWorkshopDrafts()]).then(([cards, drafts]) => {
      if (active) { setProductionCards(cards); setWorkshopDrafts(drafts) }
    })
      .catch(() => { if (active) setCollectionError(true) })
    return () => { active = false }
  }, [collection, game.view, collectionAttempt, progress])
  if (!game.hydrated || game.view === 'title') return <main><p role="status">正在整理自由工坊……</p></main>
  return <div className={cosmeticClasses(progress)}>
    <nav className="shift-route-bar" aria-label="自由工坊"><button className="ghost-button" data-sound="ui_back" onClick={onTitle}>回到店门</button><strong>自由工坊</strong><button className="secondary-button" data-sound="book_page" onClick={game.openStampBook}>翻开卡册</button></nav>
    <SurvivalRewards progress={progress} />
    {collectionError && <p className="shift-notice shift-error" role="alert">值班纪念暂时没能取出来。<button className="ghost-button" onClick={() => setCollectionAttempt(attempt => attempt + 1)}>再翻一次卡册</button></p>}
    {game.view === 'print-shop' ? <PrintShopScreen card={game.selectedCard} job={game.activePrintJob} receipt={game.printReceipt} error={game.printError}
      onCancel={game.cancelPrint} onConfirm={() => void game.confirmPrint()} onResult={game.openStampBook} />
      : game.view === 'stampbook' || game.view === 'result' ? <StampBookScreen cards={game.cards} selectedCard={game.selectedCard} productionCards={productionCards} workshopDrafts={workshopDrafts}
        onContinueDraft={draft => { game.startFreeCreate(); game.setHistory(createEditorHistory(prepareWorkshopTransfer(draft.design).design)) }}
        onSelect={game.selectCard} onEdit={game.editSelectedCard} onPrint={game.preparePrint}
        onBack={game.openWorkbench} />
        : <WorkbenchScreen history={game.history} selectedLayerId={game.selectedLayerId} onHistoryChange={game.setHistory}
          onSelect={game.selectLayer} onSave={() => void game.saveCurrentCard()} />}
  </div>
}

const hasPendingReceipts = (run: ShiftRun) => run.pendingReconciliationIntentIds.length > 0
  || Object.values(run.authorizations).some(authorization => authorization.status === 'calibrated_pending_start')

/** Explanation panels use the same controlled pause as customer, machine and puzzle clocks. */
function TutorialHelp({ enabled }: Readonly<{ enabled: boolean }>) {
  const { run, station, pause, dispatch } = useShift()
  const continueButton = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const trigger = TUTORIAL_STATION_TRIGGERS[station]
  const line = TUTORIAL_INTERVENTIONS.find(item => item.trigger === trigger)!
  const seen = run?.seenTutorialTriggers.includes(trigger)
  const open = enabled && run?.status === 'paused' && run.pause.reason === 'tutorial'
  useAudioDuck(open)
  useEffect(() => {
    if (enabled && run?.status === 'running' && !seen
      && !Object.values(run.authorizations).some(authorization => authorization.status === 'calibrating')) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      void pause('tutorial')
    }
  }, [enabled, pause, run?.status, seen, trigger])
  useEffect(() => {
    if (!open) return
    const restore = previousFocus.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    continueButton.current?.focus()
    return () => { if (restore?.isConnected) restore.focus(); previousFocus.current = null }
  }, [open])
  if (!open) return null
  return <div className="shift-tutorial-shade"><section className="shift-tutorial-card" role="dialog" aria-modal="true" aria-labelledby="shift-tutorial-title"
    onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); continueButton.current?.focus() } }}>
    <h2 id="shift-tutorial-title">值班小提醒</h2><strong>{line.speaker}</strong><p>{line.text}</p><small>读完再继续，客人、机器和校准都会一起等你。</small>
    <button ref={continueButton} className="primary-button" onClick={() => { void dispatch({ type: 'dismiss-tutorial', trigger }) }}>记住了，继续制作</button>
  </section></div>
}

function ShiftRoute({ progress, teach, busy, actionError, onRecord, onTitle, onAuthored, onSurvival }: Readonly<{
  progress: ShiftProgression; teach: boolean; busy: boolean; actionError: string | null; onRecord: (result: SettledResult) => Promise<ShiftProgression>
  onTitle: () => Promise<void>; onAuthored: (id?: AuthoredStageId) => Promise<void>; onSurvival: () => Promise<void>
}>) {
  const shift = useShift()
  const { playSfx } = useAudio()
  const previousStatus = useRef(shift.run?.status)
  const result = shift.run?.status === 'settled' ? shift.run.result : null
  useSceneMusic(result
    ? result.passed ? shift.run?.stage.id === 'story' ? 'keepsake' : 'result_clear' : 'result_retry'
    : shift.run?.stage.kind === 'survival' || shift.run?.stage.id === 'beginner' ? 'shift_busy' : 'shift_normal')
  const finalizing = shift.run !== null && hasPendingReceipts(shift.run)
  useEffect(() => {
    if (result && shift.run && previousStatus.current && previousStatus.current !== 'settled'
      && result.closedAtMs >= shiftTimeAt(shift.run, Date.now() - 1000)) playSfx(result.passed ? 'result_clear' : 'result_retry')
    previousStatus.current = shift.run?.status
  }, [result, shift.run?.status, playSfx])
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!result || finalizing) return
    let active = true
    setError(null)
    void onRecord(result).then(() => { if (active) setSavedId(result.shiftRunId) }).catch(() => { if (active) setError(saveMessage) })
    return () => { active = false }
  }, [result, finalizing, onRecord, attempt])
  const back = async () => { if (shift.run?.status === 'paused') await shift.resume(); await onTitle() }
  if (result && shift.run) {
    const stage = shift.run.stage
    return <ShiftResult result={result} stage={stage} progress={progress} ready={!busy && !finalizing && savedId === result.shiftRunId}
      finalizing={finalizing} error={error} actionError={actionError ?? shift.error}
      onRetrySave={() => setAttempt(attempt + 1)} onTitle={() => void back()}
      onRetry={() => { void (stage.kind === 'authored' ? onAuthored(stage.id) : onSurvival()) }}
      onNext={() => { void (stage.kind === 'survival' || stage.id === 'story' ? onSurvival() : onAuthored()) }} />
  }
  return <div className="shift-route">
    <nav className="shift-route-bar"><button className="ghost-button" disabled={busy} onClick={() => void back()}>回到店门</button><span>离开工位后，营业时间仍会继续。</span></nav>
    {actionError && <p className="shift-notice shift-error" role="alert">{actionError}</p>}
    <ShiftScreen />
    <TutorialHelp enabled={teach} />
  </div>
}

function GameRoutes({ store, now = Date.now, scheduleTick, createSeed = newSeed }: AppProps = {}) {
  const [defaultStore] = useState(() => store ?? new BrowserShiftStore())
  const activeStore = store ?? defaultStore
  const [route, setRoute] = useState<Route>({ kind: 'title' })
  const [progress, setProgress] = useState(createInitialShiftProgression)
  const [current, setCurrent] = useState<ShiftSnapshot | undefined>()
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const operating = useRef(false)
  const settlements = useRef(new Map<string, Promise<ShiftProgression>>())

  useEffect(() => {
    let active = true
    void Promise.all([activeStore.loadCurrent().then(saved => saved?.run.snapshotIds.length
      ? activeStore.saveArchive(saved, saved.revision) : saved), activeStore.loadProgression().then(saved =>
      unlockSurvivalCosmetics(saved) === saved ? saved : activeStore.updateProgression(unlockSurvivalCosmetics))]).then(([saved, savedProgress]) => {
      if (active) { setCurrent(saved); setProgress(savedProgress); setHydrated(true) }
    }).catch(() => { if (active) { setError(saveMessage); setHydrated(true) } })
    return () => { active = false }
  }, [activeStore])

  const record = useCallback((result: SettledResult): Promise<ShiftProgression> => {
    const existing = settlements.current.get(result.shiftRunId)
    if (existing) return existing
    const promise = (async () => {
      const saved = await activeStore.loadCurrent()
      if (saved?.run.id === result.shiftRunId && (saved.run.status !== 'settled' || hasPendingReceipts(saved.run)
        || JSON.stringify(saved.run.result) !== JSON.stringify(result))) throw new Error('Settlement is not final in the saved shift')
      const next = await activeStore.recordSettlement(result, recordShiftResult)
      setProgress(next)
      return next
    })()
    settlements.current.set(result.shiftRunId, promise)
    void promise.catch(() => settlements.current.delete(result.shiftRunId))
    return promise
  }, [activeStore])

  const perform = async (action: () => Promise<void>) => {
    if (operating.current) return
    operating.current = true; setBusy(true); setError(null)
    try { await action() } catch { setError(saveMessage) } finally { operating.current = false; setBusy(false) }
  }

  const resumeSaved = (saved: ShiftSnapshot) => {
    setCurrent(saved)
    setRoute({ kind: 'shift', stage: saved.run.stage, runId: saved.run.id, teach: saved.run.stage.id === 'tutorial' })
  }

  const finishPrevious = async (saved: ShiftSnapshot | undefined) => {
    if (saved?.run.status !== 'settled') return true
    if (hasPendingReceipts(saved.run)) { resumeSaved(saved); return false }
    await record(saved.run.result)
    const finished = finishClosedShiftPrints(saved.run)
    if (JSON.stringify(finished) !== JSON.stringify(saved.run)) {
      await activeStore.saveCurrent({ ...saved, revision: saved.revision + 1, savedAtMs: now(), run: finished }, saved.revision)
    }
    return true
  }

  const returnTitle = () => perform(async () => {
    const saved = await activeStore.loadCurrent()
    if (!(await finishPrevious(saved))) return
    setCurrent(await activeStore.loadCurrent())
    setProgress(await activeStore.loadProgression())
    setRoute({ kind: 'title' })
  })

  const startAuthored = (requested?: AuthoredStageId) => perform(async () => {
    const saved = await activeStore.loadCurrent()
    if (saved && saved.run.status !== 'settled') { resumeSaved(saved); return }
    if (!(await finishPrevious(saved))) return
    setCurrent(saved)
    const latest = await activeStore.loadProgression()
    setProgress(latest)
    const next = nextAuthoredStage(latest)
    const stageId = requested && (requested === next || latest.completedAuthoredStages.includes(requested)) ? requested : next ?? 'story'
    setRoute({ kind: 'opening', stageId })
  })

  const startSurvival = () => perform(async () => {
    const saved = await activeStore.loadCurrent()
    if (saved && saved.run.status !== 'settled') { resumeSaved(saved); return }
    if (!(await finishPrevious(saved))) return
    const next = await activeStore.updateProgression(stored => beginSurvivalRun(stored, createSeed))
    const stage = survivalStageFor(next)
    if (!stage || !next.survivalRun) return
    setProgress(next)
    // Another tab may have opened this same winning run while progression was committed.
    const winner = await activeStore.loadCurrent()
    if (winner && winner.run.status !== 'settled') { resumeSaved(winner); return }
    setRoute({ kind: 'shift', stage, runId: `survival:${next.survivalRun.seed}:day:${next.survivalRun.nextDay}`, teach: false })
  })

  if (route.kind === 'workshop') return <GameProvider>{error && <p className="shift-notice shift-error" role="alert">{error}</p>}<Workshop onTitle={() => void returnTitle()} collection={activeStore} progress={progress} /></GameProvider>
  if (route.kind === 'opening') return <><SceneMusic track="dialogue" /><ShiftDialogue key={route.stageId} stageId={route.stageId}
    seen={progress.completedAuthoredStages.includes(route.stageId) || progress.results.some(result => result.stageId === route.stageId) || current?.run.stage.id === route.stageId}
    busy={busy} error={error}
    onBack={() => void returnTitle()} onComplete={() => { void perform(async () => {
      const saved = await activeStore.loadCurrent()
      if (saved && saved.run.status !== 'settled') { resumeSaved(saved); return }
      if (!(await finishPrevious(saved))) return
      setRoute({ kind: 'shift', stage: AUTHORED_STAGES[route.stageId], runId: `authored:${route.stageId}:${createSeed()}`, teach: route.stageId === 'tutorial' })
    }) }} /></>
  if (route.kind === 'shift') return <ShiftProvider key={route.runId} stage={route.stage} runId={route.runId} store={activeStore} now={now} scheduleTick={scheduleTick}>
    <ShiftRoute progress={progress} teach={route.teach} busy={busy} actionError={error} onRecord={record} onTitle={returnTitle} onAuthored={startAuthored} onSurvival={startSurvival} />
  </ShiftProvider>
  return <><SceneMusic track="title" /><TitleScreen progress={progress} hasSave={current !== undefined} hydrated={hydrated} busy={busy} error={error}
    onStartStory={() => void startAuthored()} onSurvival={() => void startSurvival()}
    onContinue={() => { void perform(async () => { const saved = await activeStore.loadCurrent(); if (saved) resumeSaved(saved) }) }}
    onFreeCreate={() => { if (!operating.current) setRoute({ kind: 'workshop' }) }} /></>
}
