import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import { commissionFor } from '../content/commissions'
import { createEditorHistory, type EditorHistory } from '../domain/editor-history'
import { evaluateCommission } from '../domain/evaluation'
import { assertPrintIntentMatches, type CardLibraryGateway, type PrintRecord, type PrintShopGateway } from '../domain/gateways'
import type {
  CardDesign,
  CardId,
  CommissionId,
  Evaluation,
  GameMode,
  PrintJob,
  PrintJobId,
  ProgressState,
  SavedCard,
  ShopReceipt,
} from '../domain/types'
import {
  BrowserCardLibrary,
  BrowserPrintShop,
  BrowserSessionStore,
} from '../infrastructure/browser-store'
import { completeCommission, createInitialProgress, firstAvailableCommission } from './progression'
import { useAudio } from './AudioProvider'

export type GameView =
  | 'title'
  | 'dialogue'
  | 'workbench'
  | 'stampbook'
  | 'print-shop'
  | 'result'
  | 'ending'

type PersistedSession = Readonly<{
  progress: ProgressState
  resumeView: GameView
  currentCommissionId?: CommissionId
  history: EditorHistory
  selectedCardId?: CardId
  activePrintJobId?: PrintJobId
  hasActiveSession?: boolean
}>

export type GameContextValue = Readonly<{
  view: GameView
  resumeView: GameView
  progress: ProgressState
  currentCommissionId?: CommissionId
  history: EditorHistory
  selectedLayerId?: string
  cards: readonly SavedCard[]
  selectedCard?: SavedCard
  activePrintJob?: PrintJob
  printReceipt?: ShopReceipt
  printError?: string
  evaluation?: Evaluation
  hydrated: boolean
  hasSave: boolean
  goTitle: () => void
  startStory: () => void
  continueGame: () => void
  startDirectShift: () => void
  startFreeCreate: () => void
  acceptCommission: () => void
  setHistory: (history: EditorHistory) => void
  selectLayer: (layerId?: string) => void
  saveCurrentCard: () => Promise<void>
  openWorkbench: () => void
  openStampBook: () => void
  selectCard: (cardId: CardId) => void
  editSelectedCard: () => void
  preparePrint: () => void
  cancelPrint: () => void
  confirmPrint: () => Promise<void>
  revealResult: () => void
  retrySelectedCard: () => void
  continueAfterResult: () => void
}>

const GameContext = createContext<GameContextValue | null>(null)

const blankDesign = (paperId: CardDesign['paperId'] = 'cream'): CardDesign => ({
  version: 1,
  paperId,
  layers: [],
})

// A saved card is an immutable snapshot. Its one workshop intent survives refreshes
// without depending on story progress or a shift.
const workshopIntent = (cardId: CardId) => `workshop:${encodeURIComponent(cardId)}`
const saveRequest = (design: CardDesign) => `save:${Date.now()}:${design.paperId}:${design.layers.length}`

type WorkshopServices = Readonly<{
  cards: CardLibraryGateway
  // Keep the workshop incapable of calling the shift calibration entrypoint.
  prints: Pick<PrintShopGateway, 'startWorkshop' | 'findByIntent' | 'get'> & Pick<BrowserPrintShop, 'advance'>
  session: BrowserSessionStore<PersistedSession>
}>

export function GameProvider({ children }: PropsWithChildren) {
  const { playSfx } = useAudio()
  const services = useMemo<WorkshopServices>(
    () => ({
      cards: new BrowserCardLibrary(),
      prints: new BrowserPrintShop(),
      session: new BrowserSessionStore<PersistedSession>('main'),
    }),
    [],
  )
  const initialProgress = useMemo(createInitialProgress, [])
  const [view, setView] = useState<GameView>('title')
  const [resumeView, setResumeView] = useState<GameView>('dialogue')
  const [progress, setProgress] = useState<ProgressState>(initialProgress)
  const [currentCommissionId, setCurrentCommissionId] = useState<CommissionId | undefined>('chino')
  const [history, setHistoryState] = useState<EditorHistory>(() =>
    createEditorHistory(blankDesign()),
  )
  const [selectedLayerId, setSelectedLayerId] = useState<string>()
  const [cards, setCards] = useState<readonly SavedCard[]>([])
  const [selectedCardId, setSelectedCardId] = useState<CardId>()
  const [activePrintJob, setActivePrintJob] = useState<PrintJob>()
  const [printReceipt, setPrintReceipt] = useState<ShopReceipt>()
  const [printError, setPrintError] = useState<string>()
  const [evaluation, setEvaluation] = useState<Evaluation>()
  const [hydrated, setHydrated] = useState(false)
  const [hasActiveSession, setHasActiveSession] = useState(false)
  const printTimers = useRef<number[]>([])
  const pendingPrints = useRef(new Map<string, Promise<void>>())
  const printGeneration = useRef(0)

  const selectedCard = cards.find((card) => card.cardId === selectedCardId)
  const hasSave =
    hasActiveSession ||
    cards.length > 0 ||
    progress.completedCommissionIds.length > 0 ||
    progress.tutorialCompleted

  const clearPrintTimers = useCallback(() => {
    printTimers.current.forEach((timer) => window.clearTimeout(timer))
    printTimers.current = []
  }, [])

  const resetPrint = () => {
    printGeneration.current += 1
    clearPrintTimers()
    setActivePrintJob(undefined)
    setPrintReceipt(undefined)
    setPrintError(undefined)
  }

  const schedulePrint = useCallback(
    (job: PrintRecord) => {
      clearPrintTimers()
      setPrintReceipt(job.receipt)
      if (job.status === 'succeeded' || job.status === 'failed') return

      if (job.status === 'queued') {
        printTimers.current.push(
          window.setTimeout(async () => {
            const processing = await services.prints.advance(job.printJobId, 'processing')
            if (processing !== undefined) setActivePrintJob(processing)
          }, 650),
        )
      }
      printTimers.current.push(
        window.setTimeout(async () => {
          const succeeded = await services.prints.advance(job.printJobId, 'succeeded')
          if (succeeded !== undefined) {
            setActivePrintJob(succeeded)
            setPrintReceipt(succeeded.receipt)
          }
        }, job.status === 'queued' ? 1650 : 900),
      )
    },
    [clearPrintTimers, services.prints],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [storedSession, storedCards] = await Promise.all([
        services.session.load(),
        services.cards.list(),
      ])
      if (cancelled) return
      setCards(storedCards)
      if (storedSession !== undefined) {
        setHasActiveSession(storedSession.hasActiveSession ?? true)
        setProgress(storedSession.progress)
        setResumeView(storedSession.resumeView)
        setCurrentCommissionId(storedSession.currentCommissionId)
        setHistoryState(storedSession.history)
        setSelectedCardId(storedSession.selectedCardId)
        if (storedSession.resumeView === 'result' && storedSession.selectedCardId !== undefined) {
          const resultCard = storedCards.find(
            (card) => card.cardId === storedSession.selectedCardId,
          )
          if (resultCard?.commissionId !== undefined) {
            setEvaluation(evaluateCommission(resultCard.commissionId, resultCard.design))
          }
        }
        if (storedSession.activePrintJobId !== undefined) {
          const job = await services.prints.get(storedSession.activePrintJobId)
          if (!cancelled && job !== undefined) {
            setActivePrintJob(job)
            schedulePrint(job)
          }
        }
      }
      setHydrated(true)
    })()
    return () => {
      cancelled = true
      printGeneration.current += 1
      clearPrintTimers()
    }
  }, [clearPrintTimers, schedulePrint, services])

  useEffect(() => {
    if (!hydrated) return
    const session: PersistedSession = {
      progress,
      resumeView: view === 'title' ? resumeView : view,
      currentCommissionId,
      history,
      selectedCardId,
      activePrintJobId: activePrintJob?.printJobId,
      hasActiveSession,
    }
    void services.session.save(session).catch(() => setPrintError('营业簿暂时没能保存，请保留页面并稍后重试。'))
    if (view !== 'title') setResumeView(view)
  }, [
    activePrintJob?.printJobId,
    currentCommissionId,
    history,
    hasActiveSession,
    hydrated,
    progress,
    resumeView,
    selectedCardId,
    services.session,
    view,
  ])

  const startWithMode = (mode: GameMode, targetView: GameView, commissionId?: CommissionId) => {
    resetPrint()
    setHasActiveSession(true)
    setProgress((current) => ({ ...current, mode }))
    setCurrentCommissionId(commissionId)
    setSelectedLayerId(undefined)
    setEvaluation(undefined)
    if (commissionId === undefined) {
      setHistoryState(createEditorHistory(blankDesign('pink')))
    }
    setView(targetView)
  }

  const startStory = () => {
    const next = firstAvailableCommission(progress)
    startWithMode('story', 'dialogue', next)
  }

  const continueGame = () => setView(resumeView === 'title' ? 'dialogue' : resumeView)

  const startDirectShift = () => startWithMode('direct-shift', 'workbench')
  const startFreeCreate = () => startWithMode('free', 'workbench')

  const acceptCommission = () => {
    if (currentCommissionId === undefined) return
    const commission = commissionFor(currentCommissionId)
    setHistoryState(createEditorHistory(blankDesign(commission.paperId)))
    setSelectedLayerId(undefined)
    setView('workbench')
  }

  const setHistory = (next: EditorHistory) => setHistoryState(next)

  const saveCurrentCard = async () => {
    const commissionId = progress.mode === 'story' ? currentCommissionId : undefined
    const saved = await services.cards.save({
      requestId: saveRequest(history.present),
      design: history.present,
      ...(commissionId === undefined ? {} : { commissionId }),
    })
    const allCards = await services.cards.list()
    setCards(allCards)
    setSelectedCardId(saved.cardId)
    resetPrint()
    setEvaluation(undefined)
    setView('stampbook')
    playSfx('archive_success')
  }

  const selectCard = (cardId: CardId) => {
    setSelectedCardId(cardId)
    resetPrint()
    setEvaluation(undefined)
  }

  const editSelectedCard = () => {
    if (selectedCard === undefined) return
    resetPrint()
    setHistoryState(createEditorHistory(selectedCard.design))
    setCurrentCommissionId(selectedCard.commissionId)
    setSelectedLayerId(undefined)
    setView('workbench')
  }

  const preparePrint = () => {
    if (selectedCard === undefined) return
    resetPrint()
    setView('print-shop')
  }

  const confirmPrint = async () => {
    if (selectedCard === undefined || view !== 'print-shop') return
    const snapshotId = selectedCard.cardId
    const intentId = workshopIntent(snapshotId)
    const pending = pendingPrints.current.get(intentId)
    if (pending !== undefined) return pending
    const generation = printGeneration.current
    setPrintError(undefined)
    const request = (async () => {
      try {
        const existing = await services.prints.findByIntent(intentId)
        if (existing !== undefined) {
          assertPrintIntentMatches(existing, intentId, snapshotId, { kind: 'workshop' })
        }
        const job = existing ?? await services.prints.startWorkshop(intentId, snapshotId)
        assertPrintIntentMatches(job, intentId, snapshotId, { kind: 'workshop' })
        if (generation !== printGeneration.current) return
        setActivePrintJob(job)
        schedulePrint(job)
      } catch {
        if (generation === printGeneration.current) {
          setPrintError('这张卡片的冲印回执暂时无法确认，请返回卡册后再试。')
        }
      }
    })()
    pendingPrints.current.set(intentId, request)
    try {
      await request
    } finally {
      pendingPrints.current.delete(intentId)
    }
  }

  const revealResult = () => {
    if (activePrintJob?.status !== 'succeeded' || selectedCard === undefined) return
    if (selectedCard.commissionId !== undefined) {
      const result = evaluateCommission(selectedCard.commissionId, selectedCard.design)
      setEvaluation(result)
      if (progress.mode === 'story') {
        setProgress((current) => completeCommission(current, selectedCard.commissionId!, result.passed))
      }
    } else {
      setEvaluation(undefined)
    }
    setView('result')
  }

  const retrySelectedCard = () => editSelectedCard()

  const continueAfterResult = () => {
    if (progress.mode !== 'story' || selectedCard?.commissionId === undefined) {
      setView('stampbook')
      return
    }
    if (!evaluation?.passed) {
      editSelectedCard()
      return
    }
    const updated = completeCommission(progress, selectedCard.commissionId, true)
    setProgress(updated)
    if (updated.freeModeUnlocked) {
      setView('ending')
      return
    }
    setCurrentCommissionId(updated.currentCommissionId)
    setView('dialogue')
  }

  const value: GameContextValue = {
    view,
    resumeView,
    progress,
    currentCommissionId,
    history,
    selectedLayerId,
    cards,
    selectedCard,
    activePrintJob,
    printReceipt,
    printError,
    evaluation,
    hydrated,
    hasSave,
    goTitle: () => setView('title'),
    startStory,
    continueGame,
    startDirectShift,
    startFreeCreate,
    acceptCommission,
    setHistory,
    selectLayer: setSelectedLayerId,
    saveCurrentCard,
    openWorkbench: () => setView('workbench'),
    openStampBook: () => setView('stampbook'),
    selectCard,
    editSelectedCard,
    preparePrint,
    cancelPrint: () => {
      resetPrint()
      setView('stampbook')
    },
    confirmPrint,
    revealResult,
    retrySelectedCard,
    continueAfterResult,
  }

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  const value = useContext(GameContext)
  if (value === null) throw new Error('useGame must be used within GameProvider')
  return value
}
