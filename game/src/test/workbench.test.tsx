import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorHistory, type EditorHistory } from '../domain/editor-history'
import type { CommissionId } from '../domain/types'
import { WorkbenchScreen } from '../screens/WorkbenchScreen'

const emptyHistory = () =>
  createEditorHistory({
    version: 1,
    paperId: 'cream',
    layers: [],
  })

type HarnessOptions = Readonly<{
  commissionId?: CommissionId | null
  initialHistory?: EditorHistory
  onSave?: () => void
  observeHistory?: (history: EditorHistory) => void
}>

function renderWorkbench({
  commissionId = 'chino',
  initialHistory = emptyHistory(),
  onSave = vi.fn(),
  observeHistory,
}: HarnessOptions = {}) {
  const resolvedCommissionId = commissionId === null ? undefined : commissionId

  function Harness() {
    const [history, setHistory] = useState(initialHistory)
    const [selectedLayerId, setSelectedLayerId] = useState<string>()

    const handleHistoryChange = (next: EditorHistory) => {
      observeHistory?.(next)
      setHistory(next)
    }

    return (
      <WorkbenchScreen
        commissionId={resolvedCommissionId}
        history={history}
        selectedLayerId={selectedLayerId}
        onHistoryChange={handleHistoryChange}
        onSelect={setSelectedLayerId}
        onSave={onSave}
      />
    )
  }

  return render(<Harness />)
}

const cardRect = {
  x: 100,
  y: 100,
  left: 100,
  top: 100,
  right: 700,
  bottom: 500,
  width: 600,
  height: 400,
  toJSON: () => ({}),
}

afterEach(cleanup)

describe('制卡桌', () => {
  it('shows the current order, the card work area, and the material drawer', () => {
    renderWorkbench()

    expect(screen.getByRole('heading', { name: '制卡桌' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '今日委托' })).toHaveTextContent('智乃的咖啡感谢卡')
    expect(screen.getByRole('region', { name: '卡片工作台' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '素材抽屉' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /智乃与心爱/ })).toHaveAttribute(
      'src',
      '/assets/characters/cocoa-chino-tippy-api.png',
    )
    expect(screen.getByLabelText('印刷安全区')).toBeInTheDocument()
  })

  it('changes card paper and supports undo and redo', () => {
    let latest = emptyHistory()
    renderWorkbench({ observeHistory: (history) => (latest = history) })

    fireEvent.click(screen.getByRole('button', { name: '咖啡棕卡纸' }))
    expect(latest.present.paperId).toBe('coffee')

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(latest.present.paperId).toBe('cream')

    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(latest.present.paperId).toBe('coffee')
  })

  it('filters material categories and adds a clicked material at its useful starting position', () => {
    let latest = emptyHistory()
    renderWorkbench({ observeHistory: (history) => (latest = history) })

    fireEvent.click(screen.getByRole('tab', { name: '兔兔' }))
    expect(screen.getByRole('button', { name: '添加小兔' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加咖啡杯' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '添加小兔' }))
    expect(latest.present.layers).toHaveLength(1)
    expect(latest.present.layers[0]).toMatchObject({
      kind: 'sticker',
      assetId: 'rabbit',
      x: 0.82,
      y: 0.78,
    })
    expect(screen.getByRole('button', { name: '选择小兔' })).toHaveStyle({
      '--layer-width': '12%',
    })
  })

  it('allocates a fresh layer identity after a persisted draft is restored', () => {
    const restoredLayers = Array.from({ length: 60 }, (_, index) => ({
      kind: 'sticker' as const,
      id: `coffee-cup-${index + 1}`,
      assetId: 'coffee-cup',
      x: 0.25,
      y: 0.55,
      scale: 0.26,
      rotation: 0,
    }))
    let latest = createEditorHistory({
      version: 1,
      paperId: 'cream',
      layers: restoredLayers,
    })
    renderWorkbench({
      initialHistory: latest,
      observeHistory: (history) => (latest = history),
    })

    fireEvent.click(screen.getByRole('button', { name: '添加咖啡杯' }))

    const ids = latest.present.layers.map((layer) => layer.id)
    expect(new Set(ids)).toHaveLength(ids.length)
  })

  it('accepts an HTML material drag and places it at the dropped card position', () => {
    let latest = emptyHistory()
    renderWorkbench({ observeHistory: (history) => (latest = history) })
    const surface = screen.getByTestId('card-surface')
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(cardRect)
    const transfer = {
      data: new Map<string, string>(),
      effectAllowed: 'all',
      dropEffect: 'none',
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
      getData(type: string) {
        return this.data.get(type) ?? ''
      },
    }

    fireEvent.dragStart(screen.getByRole('button', { name: '添加咖啡杯' }), {
      dataTransfer: transfer,
    })
    fireEvent.dragOver(surface, { dataTransfer: transfer })
    const dropEvent = createEvent.drop(surface, { dataTransfer: transfer })
    Object.defineProperties(dropEvent, {
      clientX: { value: 400 },
      clientY: { value: 300 },
    })
    fireEvent(surface, dropEvent)

    expect(latest.present.layers[0]).toMatchObject({
      kind: 'sticker',
      assetId: 'coffee-cup',
      x: 0.5,
      y: 0.5,
    })
  })

  it('moves a card decoration with the pointer and stores normalized coordinates', () => {
    let latest = emptyHistory()
    renderWorkbench({ observeHistory: (history) => (latest = history) })
    fireEvent.click(screen.getByRole('button', { name: '添加咖啡杯' }))

    const surface = screen.getByTestId('card-surface')
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(cardRect)
    const layer = screen.getByRole('button', { name: '选择咖啡杯' })
    fireEvent.pointerDown(layer, { pointerId: 1, clientX: 250, clientY: 300 })
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 400, clientY: 350 })
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 550, clientY: 400 })
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 550, clientY: 400 })

    expect(latest.present.layers[0]).toMatchObject({ x: 0.75, y: 0.8 })
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(latest.present.layers[0]).toMatchObject({ x: 0.25, y: 0.55 })
  })

  it('scales, rotates, reorders, copies, and removes the selected decoration', () => {
    let latest = emptyHistory()
    renderWorkbench({ observeHistory: (history) => (latest = history) })
    fireEvent.click(screen.getByRole('button', { name: '添加咖啡杯' }))
    fireEvent.click(screen.getByRole('tab', { name: '兔兔' }))
    fireEvent.click(screen.getByRole('button', { name: '添加小兔' }))

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    fireEvent.click(screen.getByRole('button', { name: '向后一层' }))
    fireEvent.click(screen.getByRole('button', { name: '右转' }))

    expect(latest.present.layers[0]).toMatchObject({ assetId: 'rabbit', rotation: 20 })
    expect(latest.present.layers[0].kind === 'sticker' && latest.present.layers[0].scale).toBeGreaterThan(
      0.12,
    )

    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(latest.present.layers).toHaveLength(3)
    expect(new Set(latest.present.layers.map((layer) => layer.id))).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(latest.present.layers).toHaveLength(2)
  })

  it('lets the third commission draw one pale line in the bottom drawing strip', () => {
    let latest = emptyHistory()
    renderWorkbench({
      commissionId: 'chiya-sharo',
      observeHistory: (history) => (latest = history),
    })
    const surface = screen.getByTestId('card-surface')
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(cardRect)

    fireEvent.click(screen.getByRole('button', { name: '浅色画笔' }))
    fireEvent.pointerDown(surface, { pointerId: 2, clientX: 190, clientY: 460 })
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 400, clientY: 465 })
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 610, clientY: 460 })
    fireEvent.pointerUp(surface, { pointerId: 2, clientX: 610, clientY: 460 })

    const stroke = latest.present.layers.find((layer) => layer.kind === 'stroke')
    expect(stroke).toMatchObject({ kind: 'stroke', colorId: 'cream-pencil' })
    expect(stroke?.kind === 'stroke' && stroke.points.length).toBeGreaterThanOrEqual(2)
    expect(stroke?.kind === 'stroke' && stroke.points.every((point) => point.y >= 0.85)).toBe(true)
  })

  it('keeps the restricted drawing tool available during a free shift', () => {
    renderWorkbench({ commissionId: null })

    expect(screen.getByRole('button', { name: '浅色画笔' })).toBeEnabled()
  })

  it('only stores the card when the player explicitly chooses StampBook', () => {
    const onSave = vi.fn()
    renderWorkbench({ onSave })

    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '收入 StampBook' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
