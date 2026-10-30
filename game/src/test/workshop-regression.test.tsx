import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameProvider, useGame, type GameContextValue } from '../app/GameProvider'
import { App } from '../app/App'
import type { SavedCard } from '../domain/types'
import { BROWSER_STORE_KEYS, BrowserCardLibrary, BrowserPrintShop } from '../infrastructure/browser-store'
import { PrintShopScreen } from '../screens/PrintShopScreen'
import { StampBookScreen } from '../screens/StampBookScreen'
import { WorkbenchScreen } from '../screens/WorkbenchScreen'
import workshopStyles from '../styles/screens.css?inline'
import productionPrinterStyles from '../styles/printers.css?inline'

// Exercise the workshop independently of the story/survival router.
function renderWorkshop() {
  let current!: GameContextValue
  function WorkshopRoutes() {
    const game = useGame()
    current = game
    if (game.view === 'workbench') return <WorkbenchScreen
      commissionId={game.currentCommissionId}
      history={game.history}
      selectedLayerId={game.selectedLayerId}
      onHistoryChange={game.setHistory}
      onSelect={game.selectLayer}
      onSave={() => void game.saveCurrentCard()}
    />
    if (game.view === 'stampbook') return <StampBookScreen
      cards={game.cards} selectedCard={game.selectedCard} onSelect={game.selectCard}
      onEdit={game.editSelectedCard} onPrint={game.preparePrint} onBack={game.editSelectedCard}
    />
    if (game.view === 'print-shop') return <PrintShopScreen
      card={game.selectedCard} job={game.activePrintJob} error={game.printError}
      onCancel={game.cancelPrint} onConfirm={() => void game.confirmPrint()} onResult={game.revealResult}
    />
    return <>
      <button disabled={!game.hydrated} onClick={game.startFreeCreate}>自由工坊</button>
      <button disabled={!game.hydrated || !game.hasSave} onClick={game.continueGame}>继续工坊</button>
      <button disabled={!game.hydrated} onClick={game.openStampBook}>翻开卡册</button>
    </>
  }
  return { ...render(<GameProvider><WorkshopRoutes /></GameProvider>), game: () => current }
}

async function enterFreshWorkshop() {
  const app = renderWorkshop()
  await waitFor(() => expect(screen.getByRole('button', { name: '自由工坊' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
  expect(screen.getByRole('heading', { name: '制卡桌' })).toBeInTheDocument()
  return app
}

async function saveArtwork() {
  fireEvent.click(screen.getByRole('button', { name: '添加咖啡杯' }))
  fireEvent.click(screen.getByRole('button', { name: '收入 StampBook' }))
  await screen.findByRole('heading', { name: 'StampBook' })
}

async function confirmArtwork() {
  fireEvent.click(screen.getByRole('button', { name: /送去冲印/ }))
  fireEvent.click(screen.getByRole('button', { name: '确认冲印' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '确认冲印' })).not.toBeInTheDocument())
}

afterEach(() => vi.restoreAllMocks())

describe('Free Workshop boundary', () => {
  it.each(['returning from the title', 'refreshing the app', 'returning from StampBook', 'returning from a selected saved card'] as const)('restores an uncollected draft through the real App when %s', async (entry) => {
    const mounted = render(<App scheduleTick={null} />)
    fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
    await screen.findByRole('heading', { name: '制卡桌' })
    if (entry === 'returning from a selected saved card') {
      fireEvent.click(screen.getByRole('button', { name: '收入 StampBook' }))
      await screen.findByRole('heading', { name: 'StampBook' })
      fireEvent.click(screen.getByRole('button', { name: '继续修改' }))
    }
    fireEvent.click(screen.getByRole('button', { name: '咖啡棕卡纸' }))
    fireEvent.click(screen.getByRole('button', { name: '添加咖啡杯' }))
    fireEvent.click(screen.getByRole('button', { name: '右转' }))
    const saved = window.localStorage.getItem(BROWSER_STORE_KEYS.session('main'))!
    expect(JSON.parse(saved).history.present.layers[0].rotation).toBe(15)
    expect(await new BrowserCardLibrary().list()).toHaveLength(entry === 'returning from a selected saved card' ? 1 : 0)

    if (entry === 'refreshing the app') {
      mounted.unmount()
      render(<App scheduleTick={null} />)
    } else if (entry === 'returning from the title') {
      fireEvent.click(screen.getByRole('button', { name: '回到店门' }))
      await screen.findByRole('button', { name: '自由工坊' })
    } else {
      fireEvent.click(screen.getByRole('button', { name: '翻开卡册' }))
      fireEvent.click(screen.getByRole('button', { name: '← 回到制卡桌' }))
    }
    if (entry === 'refreshing the app' || entry === 'returning from the title') fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
    await screen.findByRole('heading', { name: '制卡桌' })
    expect(screen.getByTestId('card-surface')).toHaveAttribute('data-paper', 'coffee')
    expect(screen.getByRole('button', { name: '选择咖啡杯' })).toHaveStyle({ '--layer-turn': '15deg' })
    expect(JSON.parse(window.localStorage.getItem(BROWSER_STORE_KEYS.session('main'))!).history).toEqual(JSON.parse(saved).history)
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByRole('button', { name: '选择咖啡杯' })).toHaveStyle({ '--layer-turn': '0deg' })
  })

  it('keeps the workshop machine appearance when production printer styles are also loaded', async () => {
    render(<style>{`${workshopStyles}\n${productionPrinterStyles}`}</style>)
    await enterFreshWorkshop()
    await saveArtwork()
    fireEvent.click(screen.getByRole('button', { name: /送去冲印/ }))
    const machine = screen.getByLabelText('冲印机')
    expect(machine).toHaveClass('printer-machine')
    expect(machine).not.toHaveClass('production-printer-machine')
    const appearance = getComputedStyle(machine)
    expect(appearance.width).toBe('340px')
    expect(appearance.height).toBe('382px')
    expect(appearance.display).not.toBe('grid')
    expect(appearance.overflow).not.toBe('hidden')
    expect(appearance.padding).not.toBe('14px')
  })

  it('opens from a fresh profile and saves without printing until the player explicitly confirms', async () => {
    const save = vi.spyOn(BrowserCardLibrary.prototype, 'save')
    const start = vi.spyOn(BrowserPrintShop.prototype, 'startWorkshop')
    const find = vi.spyOn(BrowserPrintShop.prototype, 'findByIntent')
    const shift = vi.spyOn(BrowserPrintShop.prototype, 'startShift')
    const deprecatedStart = vi.spyOn(BrowserPrintShop.prototype, 'start')
    const app = await enterFreshWorkshop()
    expect(app.game().progress.completedCommissionIds).toEqual([])
    expect(app.game().progress.tutorialCompleted).toBe(false)
    expect(app.game().progress.mode).toBe('free')
    expect(app.game().currentCommissionId).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: '添加咖啡杯' }))
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    fireEvent.click(screen.getByRole('button', { name: '右转' }))
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    fireEvent.click(screen.getByRole('button', { name: '收入 StampBook' }))
    await screen.findByRole('heading', { name: 'StampBook' })

    const [card] = await new BrowserCardLibrary().list()
    expect(save).toHaveBeenCalledTimes(1)
    expect(card.commissionId).toBeUndefined()
    expect(card.design.layers[0]).toMatchObject({ assetId: 'coffee-cup', rotation: 15 })
    expect(await new BrowserPrintShop().list()).toEqual([])
    expect(start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /送去冲印/ }))
    expect(screen.getByRole('heading', { name: '冲印前确认' })).toBeInTheDocument()
    expect(await new BrowserPrintShop().list()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: '确认冲印' }))
    await waitFor(() => expect(app.game().activePrintJob).toBeDefined())
    const jobs = await new BrowserPrintShop().list()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(jobs[0].intentId, card.cardId)
    expect(find).toHaveBeenCalledWith(jobs[0].intentId)
    expect(find.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0])
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ snapshotId: card.cardId, context: { kind: 'workshop' } })
    expect(jobs[0].context).toEqual({ kind: 'workshop' })
    expect(shift).not.toHaveBeenCalled()
    expect(deprecatedStart).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reuses one intent across double-clicks, screen remounts, and a refreshed provider', async () => {
    const start = vi.spyOn(BrowserPrintShop.prototype, 'startWorkshop')
    const find = vi.spyOn(BrowserPrintShop.prototype, 'findByIntent')
    const app = await enterFreshWorkshop()
    await saveArtwork()
    fireEvent.click(screen.getByRole('button', { name: /送去冲印/ }))
    const confirm = screen.getByRole('button', { name: '确认冲印' })
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm) })
    await waitFor(() => expect(app.game().activePrintJob).toBeDefined())
    const [original] = await new BrowserPrintShop().list()
    expect(start).toHaveBeenCalledTimes(1)

    act(() => app.game().openStampBook())
    await confirmArtwork()
    expect(app.game().activePrintJob?.printJobId).toBe(original.printJobId)
    app.unmount()
    const refreshed = renderWorkshop()
    await waitFor(() => expect(screen.getByRole('button', { name: '继续工坊' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '继续工坊' }))
    expect(refreshed.game().activePrintJob?.printJobId).toBe(original.printJobId)
    expect(start).toHaveBeenCalledTimes(1)
    act(() => refreshed.game().openStampBook())
    await confirmArtwork()

    expect(await new BrowserPrintShop().list()).toEqual([original])
    expect(start).toHaveBeenCalledTimes(1)
    expect(find.mock.calls.every(([intentId]) => intentId === original.intentId)).toBe(true)
  })

  it('recovers an accepted print after a lost reply without starting another print', async () => {
    const originalStart = BrowserPrintShop.prototype.startWorkshop
    const start = vi.spyOn(BrowserPrintShop.prototype, 'startWorkshop').mockImplementationOnce(async function (this: BrowserPrintShop, intentId, snapshotId) {
      await originalStart.call(this, intentId, snapshotId)
      throw new Error('reply lost after acceptance')
    })
    const app = await enterFreshWorkshop()
    await saveArtwork()
    fireEvent.click(screen.getByRole('button', { name: /送去冲印/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认冲印' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('冲印')
    expect(app.game().activePrintJob).toBeUndefined()
    const [accepted] = await new BrowserPrintShop().list()
    app.unmount()

    const refreshed = renderWorkshop()
    await waitFor(() => expect(screen.getByRole('button', { name: '继续工坊' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '继续工坊' }))
    expect(screen.getByRole('button', { name: '确认冲印' })).toBeInTheDocument()
    expect(start).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '确认冲印' }))
    await waitFor(() => expect(refreshed.game().activePrintJob?.printJobId).toBe(accepted.printJobId))
    expect(await new BrowserPrintShop().list()).toEqual([accepted])
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('assigns a newly saved revision its own intent without changing the earlier snapshot', async () => {
    const app = await enterFreshWorkshop()
    await saveArtwork()
    await confirmArtwork()
    const [originalCard] = await new BrowserCardLibrary().list()
    const [originalPrint] = await new BrowserPrintShop().list()
    act(() => app.game().openStampBook())
    fireEvent.click(screen.getByRole('button', { name: '继续修改' }))
    fireEvent.click(screen.getByRole('button', { name: '咖啡棕卡纸' }))
    fireEvent.click(screen.getByRole('button', { name: '收入 StampBook' }))
    await screen.findByRole('heading', { name: 'StampBook' })
    expect(await new BrowserPrintShop().list()).toEqual([originalPrint])
    await confirmArtwork()

    const cards = await new BrowserCardLibrary().list()
    const jobs = await new BrowserPrintShop().list()
    expect(cards[0]).toEqual(originalCard)
    expect(cards[1].cardId).not.toBe(originalCard.cardId)
    expect(jobs).toHaveLength(2)
    expect(new Set(jobs.map((job) => job.intentId)).size).toBe(2)
    expect(jobs.map((job) => job.snapshotId)).toEqual(cards.map((card) => card.cardId))
  })

  it.each(['snapshot', 'shift'] as const)('fails closed if a recovered intent belongs to another %s', async (mismatch) => {
    const app = await enterFreshWorkshop()
    await saveArtwork()
    await confirmArtwork()
    const [original] = await new BrowserPrintShop().list()
    const badRecord = mismatch === 'snapshot'
      ? { ...original, cardId: 'another-card', snapshotId: 'another-card' }
      : { ...original, context: { kind: 'shift', machineId: 'quick', shiftRunId: 'another-run' } }
    window.localStorage.setItem(BROWSER_STORE_KEYS.printIntent(original.intentId), JSON.stringify({
      version: 2, kind: 'print-intent', record: badRecord,
    }))
    const start = vi.spyOn(BrowserPrintShop.prototype, 'startWorkshop')
    act(() => app.game().openStampBook())
    fireEvent.click(screen.getByRole('button', { name: /送去冲印/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认冲印' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('冲印')
    expect(app.game().activePrintJob).toBeUndefined()
    expect(start).not.toHaveBeenCalled()
    expect(await new BrowserPrintShop().list()).toEqual([badRecord])
    expect(screen.getByRole('alert').textContent).not.toMatch(/JSON|API|token|field|log|payload|schema|intent/i)
  })

  it('displays v1 cards in StampBook and preserves them when saving a modified copy', async () => {
    const old: SavedCard = {
      cardId: 'card-7', savedAt: '2026-10-13T12:00:00.000Z',
      design: { version: 1, paperId: 'mint', layers: [
        { kind: 'sticker', id: 'rabbit-1', assetId: 'rabbit', x: 0.4, y: 0.5, scale: 0.2, rotation: 20 },
      ] },
    }
    const legacy = JSON.stringify([old])
    window.localStorage.setItem(BROWSER_STORE_KEYS.cards, legacy)
    renderWorkshop()
    await waitFor(() => expect(screen.getByRole('button', { name: '翻开卡册' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '翻开卡册' }))
    fireEvent.click(screen.getByRole('button', { name: /收藏卡 01/ }))
    expect(screen.getByTestId('card-surface')).toHaveAttribute('data-paper', 'mint')
    expect(screen.getByRole('button', { name: '选择小兔' })).toHaveStyle({ '--layer-turn': '20deg' })
    expect(window.localStorage.getItem(BROWSER_STORE_KEYS.cardLibrary)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '继续修改' }))
    fireEvent.click(screen.getByRole('button', { name: '咖啡棕卡纸' }))
    fireEvent.click(screen.getByRole('button', { name: '收入 StampBook' }))
    await screen.findByRole('heading', { name: 'StampBook' })

    const cards = await new BrowserCardLibrary().list()
    expect(cards).toHaveLength(2)
    expect(cards[0]).toEqual(old)
    expect(cards[1].cardId).toBe('card-8')
    expect(window.localStorage.getItem(BROWSER_STORE_KEYS.cards)).toBe(legacy)
    expect(await new BrowserPrintShop().list()).toEqual([])
  })
})
