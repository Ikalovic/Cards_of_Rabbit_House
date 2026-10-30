import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  PAPERS,
  assetById,
  assetImage,
  STROKE_COLORS,
  STROKE_WIDTHS,
  assetsForCommission,
  createLayerFromAsset,
  type AssetCategory,
  type AssetDefinition,
} from '../content/assets'
import { commissionFor, requirementChecks } from '../content/commissions'
import {
  addLayer,
  duplicateLayer,
  redo,
  removeLayer,
  reorderLayer,
  undo,
  updateLayer,
  type EditorHistory,
} from '../domain/editor-history'
import type {
  CardDesign,
  CardLayer,
  CommissionId,
  NormalizedPoint,
  PaperId,
  StrokeLayer,
} from '../domain/types'
import { CardPreview } from '../components/CardPreview'
import { useAudio } from '../app/AudioProvider'
import type { SfxId } from '../content/audio'

export type WorkbenchScreenProps = Readonly<{
  commissionId?: CommissionId
  history: EditorHistory
  selectedLayerId?: string
  onHistoryChange: (next: EditorHistory) => void
  onSelect: (layerId?: string) => void
  onSave: () => void
}>

type MoveGesture = {
  pointerId: number
  layerId: string
  clientX: number
  clientY: number
  x: number
  y: number
  startHistory: EditorHistory
  latestDesign?: CardDesign
}

const MATERIAL_MIME = 'application/x-rabbit-house-material'
const CATEGORY_ORDER: readonly AssetCategory[] = ['饮品', '兔兔', '装饰', '字章']
const MAX_HISTORY = 50

const nextLayerId = (prefix: string, layers: readonly CardLayer[]) => {
  const usedIds = new Set(layers.map((layer) => layer.id))
  let suffix = 1
  while (usedIds.has(`${prefix}-${suffix}`)) suffix += 1
  return `${prefix}-${suffix}`
}
const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value))
const tidyNumber = (value: number) => Number(value.toFixed(4))

const snapCoordinate = (value: number) => {
  const targets = [0.08, 0.25, 0.5, 0.75, 0.92]
  const target = targets.find((candidate) => Math.abs(candidate - value) <= 0.018)
  return tidyNumber(target ?? clamp(value))
}

const paperHistory = (history: EditorHistory, paperId: PaperId): EditorHistory => {
  if (paperId === history.present.paperId) return history
  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY),
    present: { ...history.present, paperId },
    future: [],
  }
}

const layerName = (layer: CardLayer) => {
  if (layer.kind === 'stroke') return '浅色桌面线'
  if (layer.kind === 'text-stamp') return `“${layer.text}”字章`
  return assetById(layer.assetId)?.label ?? '装饰'
}

const characterAlt: Record<CommissionId, string> = {
  chino: '智乃与心爱在一旁陪你制作卡片',
  rize: '理世拿着活动邀请卡检查布置',
  'chiya-sharo': '千夜与纱路为午后茶会卡出主意',
}

function MaterialTile({
  asset,
  onAdd,
}: Readonly<{
  asset: AssetDefinition
  onAdd: (assetId: string) => void
}>) {
  return (
    <button
      type="button"
      className="material-tile"
      data-sound="none"
      draggable
      aria-label={`添加${asset.label}`}
      onClick={() => onAdd(asset.id)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(MATERIAL_MIME, asset.id)
        event.dataTransfer.setData('text/plain', asset.id)
      }}
    >
      <span className="material-tile__glyph" aria-hidden="true">
        {assetImage(asset.id) ? <img src={assetImage(asset.id)} alt="" draggable={false} /> : asset.glyph}
      </span>
      <span className="material-tile__label">{asset.label}</span>
      <span className="material-tile__grip" aria-hidden="true">⠿</span>
    </button>
  )
}

function IconUndo() {
  return <span aria-hidden="true">↶</span>
}

function IconRedo() {
  return <span aria-hidden="true">↷</span>
}

export function WorkbenchScreen({
  commissionId,
  history,
  selectedLayerId,
  onHistoryChange,
  onSelect,
  onSave,
}: WorkbenchScreenProps) {
  const { playSfx } = useAudio()
  const commission = commissionId === undefined ? undefined : commissionFor(commissionId)
  const availableAssets = useMemo(() => assetsForCommission(commissionId), [commissionId])
  const availableCategories = useMemo(
    () => CATEGORY_ORDER.filter((category) => availableAssets.some((asset) => asset.category === category)),
    [availableAssets],
  )
  const [activeCategory, setActiveCategory] = useState<AssetCategory>(availableCategories[0] ?? '饮品')
  const [pencilActive, setPencilActive] = useState(false)
  const [brushColor, setBrushColor] = useState<string>('cocoa-ink')
  const [brushWidth, setBrushWidth] = useState<number>(0.012)
  const [draftStroke, setDraftStroke] = useState<readonly NormalizedPoint[]>([])
  const moveGesture = useRef<MoveGesture | undefined>(undefined)
  const strokeGesture = useRef<{ pointerId: number; points: NormalizedPoint[] } | undefined>(undefined)
  const lastBrushAt = useRef(-Infinity)

  const checks = commission === undefined
    ? []
    : requirementChecks(commission, history.present)
  const selectedLayer = history.present.layers.find((layer) => layer.id === selectedLayerId)
  const strokeCount = history.present.layers.filter((layer) => layer.kind === 'stroke').length
  const canDraw = commissionId === undefined || commissionId === 'chiya-sharo'
  const freeDraw = commissionId === undefined
  const strokeY = (y: number) => freeDraw ? clamp(y, 0.02, 0.98) : clamp(y, 0.85, 0.95)
  const strokeX = (x: number) => freeDraw ? clamp(x, 0.02, 0.98) : clamp(x, 0.08, 0.92)

  const visibleAssets = availableAssets.filter((asset) => asset.category === activeCategory)
  const applyHistory = (next: EditorHistory, sound?: SfxId) => {
    if (next === history) return
    onHistoryChange(next)
    if (sound) playSfx(sound)
    if (
      selectedLayerId !== undefined &&
      !next.present.layers.some((layer) => layer.id === selectedLayerId)
    ) {
      onSelect(undefined)
    }
  }

  const addMaterial = (assetId: string, point?: NormalizedPoint) => {
    const instance = history.present.layers.filter((layer) => {
      if (layer.kind === 'sticker') return layer.assetId === assetId
      return layer.kind === 'text-stamp' && layer.styleId === assetId
    }).length
    const id = nextLayerId(assetId, history.present.layers)
    const layer = createLayerFromAsset(assetId, commissionId, instance, id)
    const placedLayer = point === undefined || layer.kind === 'stroke'
      ? layer
      : { ...layer, x: point.x, y: point.y }
    applyHistory(addLayer(history, placedLayer), 'piece_place')
    onSelect(id)
    setPencilActive(false)
  }

  const pointOnCard = (
    event: Pick<ReactPointerEvent<HTMLDivElement>, 'clientX' | 'clientY' | 'currentTarget'>,
  ): NormalizedPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: tidyNumber(clamp((event.clientX - bounds.left) / Math.max(1, bounds.width))),
      y: tidyNumber(clamp((event.clientY - bounds.top) / Math.max(1, bounds.height))),
    }
  }

  const dropPoint = (event: DragEvent<HTMLDivElement>): NormalizedPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: snapCoordinate((event.clientX - bounds.left) / Math.max(1, bounds.width)),
      y: snapCoordinate((event.clientY - bounds.top) / Math.max(1, bounds.height)),
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const assetId = event.dataTransfer.getData(MATERIAL_MIME) || event.dataTransfer.getData('text/plain')
    if (!availableAssets.some((asset) => asset.id === assetId)) return
    addMaterial(assetId, dropPoint(event))
  }

  const handleLayerPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    layerId: string,
  ) => {
    if (pencilActive) return
    const layer = history.present.layers.find((candidate) => candidate.id === layerId)
    if (layer === undefined || layer.kind === 'stroke') return
    onSelect(layerId)
    moveGesture.current = {
      pointerId: event.pointerId,
      layerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: layer.x,
      y: layer.y,
      startHistory: history,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handleSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pencilActive || !canDraw || strokeCount >= 20) {
      if (event.target === event.currentTarget) onSelect(undefined)
      return
    }
    event.preventDefault()
    const raw = pointOnCard(event)
    const first = { x: strokeX(raw.x), y: strokeY(raw.y) }
    strokeGesture.current = { pointerId: event.pointerId, points: [first] }
    setDraftStroke([first])
    playSfx('brush_stroke')
    lastBrushAt.current = performance.now()
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handleSurfacePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stroke = strokeGesture.current
    if (stroke !== undefined && stroke.pointerId === event.pointerId) {
      const raw = pointOnCard(event)
      const nextPoint = {
        x: tidyNumber(strokeX(raw.x)),
        y: tidyNumber(strokeY(raw.y)),
      }
      const previous = stroke.points.at(-1)!
      if (
        stroke.points.length < 128 &&
        (Math.abs(previous.x - nextPoint.x) >= 0.004 || Math.abs(previous.y - nextPoint.y) >= 0.004)
      ) {
        stroke.points.push(nextPoint)
        setDraftStroke([...stroke.points])
        const now = performance.now()
        if (now - lastBrushAt.current >= 150) {
          playSfx('brush_stroke')
          lastBrushAt.current = now
        }
      }
      return
    }

    const movement = moveGesture.current
    if (movement === undefined || movement.pointerId !== event.pointerId) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = snapCoordinate(movement.x + (event.clientX - movement.clientX) / Math.max(1, bounds.width))
    const y = snapCoordinate(movement.y + (event.clientY - movement.clientY) / Math.max(1, bounds.height))
    const layers = movement.startHistory.present.layers.map((layer) =>
      layer.id === movement.layerId ? { ...layer, x, y } : layer,
    ) as readonly CardLayer[]
    const present = { ...movement.startHistory.present, layers }
    movement.latestDesign = present
    onHistoryChange({
      past: movement.startHistory.past,
      present,
      future: [],
    })
  }

  const finishPointerGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const movement = moveGesture.current
    if (movement?.pointerId === event.pointerId) {
      if (movement.latestDesign !== undefined) {
        onHistoryChange({
          past: [...movement.startHistory.past, movement.startHistory.present].slice(-MAX_HISTORY),
          present: movement.latestDesign,
          future: [],
        })
        const moved = movement.latestDesign.layers.find(layer => layer.id === movement.layerId)
        if (event.type !== 'pointercancel' && moved && moved.kind !== 'stroke'
          && (moved.x !== movement.x || moved.y !== movement.y)) playSfx('piece_place')
      }
      moveGesture.current = undefined
    }

    const stroke = strokeGesture.current
    if (stroke === undefined || stroke.pointerId !== event.pointerId) return
    if (stroke.points.length === 1) {
      stroke.points.push({
        x: tidyNumber(strokeX(stroke.points[0].x + 0.01)),
        y: stroke.points[0].y,
      })
    }
    const line: StrokeLayer = {
      kind: 'stroke',
      id: nextLayerId('table-line', history.present.layers),
      points: [...stroke.points],
      colorId: freeDraw ? brushColor : 'cream-pencil',
      width: freeDraw ? brushWidth : 0.012,
    }
    applyHistory(addLayer(history, line))
    strokeGesture.current = undefined
    setDraftStroke([])
    if (!freeDraw) setPencilActive(false)
  }

  const alterSelected = (patch: { scale?: number; rotation?: number }) => {
    if (selectedLayer === undefined || selectedLayer.kind === 'stroke') return
    applyHistory(updateLayer(history, selectedLayer.id, patch))
  }

  const changeScale = (amount: number) => {
    if (selectedLayer === undefined || selectedLayer.kind === 'stroke') return
    alterSelected({ scale: tidyNumber(clamp(selectedLayer.scale + amount, 0.06, 0.8)) })
  }

  const changeRotation = (amount: number) => {
    if (selectedLayer === undefined || selectedLayer.kind === 'stroke') return
    let rotation = selectedLayer.rotation + amount
    if (rotation > 180) rotation -= 360
    if (rotation < -180) rotation += 360
    alterSelected({ rotation })
  }

  const moveSelected = (amount: number) => {
    if (selectedLayer === undefined) return
    const index = history.present.layers.findIndex((layer) => layer.id === selectedLayer.id)
    applyHistory(reorderLayer(history, selectedLayer.id, index + amount))
  }

  const copySelected = () => {
    if (selectedLayer === undefined) return
    const copyId = nextLayerId('copy', history.present.layers)
    applyHistory(duplicateLayer(history, selectedLayer.id, copyId), 'piece_place')
    onSelect(copyId)
  }

  const deleteSelected = () => {
    if (selectedLayer === undefined) return
    applyHistory(removeLayer(history, selectedLayer.id))
    onSelect(undefined)
  }

  const previewDesign: CardDesign = draftStroke.length === 0
    ? history.present
    : {
        ...history.present,
        layers: [
          ...history.present.layers,
          {
            kind: 'stroke',
            id: 'draft-table-line',
            points: draftStroke,
            colorId: freeDraw ? brushColor : 'cream-pencil',
            width: freeDraw ? brushWidth : 0.012,
          },
        ],
      }

  const orderTitle = commission?.title ?? '自由制作'
  const orderNumber = commission?.number ?? 'FREE'
  const art = commission?.art ?? '/assets/characters/cocoa-chino-tippy-api.png'
  const artAlt = commissionId === undefined
    ? '心爱与智乃陪你自由制作卡片'
    : characterAlt[commissionId]

  return (
    <main className="workbench-shell">
      <header className="workbench-topbar">
        <div className="brand-lockup" aria-label="Rabbit House 手作值班">
          <span className="brand-lockup__rabbit" aria-hidden="true">♢</span>
          <span className="brand-lockup__copy">
            <strong>Rabbit House</strong>
            <small>HANDMADE SHIFT</small>
          </span>
        </div>

        <div className="workbench-title">
          <span className="workbench-title__eyebrow">今日手作</span>
          <h1>制卡桌</h1>
        </div>

        <div className="workbench-actions">
          <div className="history-actions" aria-label="修改记录">
            <button
              type="button"
              className="tool-button"
              aria-label="撤销"
              disabled={history.past.length === 0}
              onClick={() => applyHistory(undo(history))}
            >
              <IconUndo />
            </button>
            <button
              type="button"
              className="tool-button"
              aria-label="重做"
              disabled={history.future.length === 0}
              onClick={() => applyHistory(redo(history))}
            >
              <IconRedo />
            </button>
          </div>
          <button type="button" className="save-button" data-sound="none" onClick={onSave}>
            <span aria-hidden="true">✦</span>
            收入 StampBook
          </button>
        </div>
      </header>

      <div className="workbench-grid">
        <aside
          className="order-panel"
          aria-label="今日委托"
          style={{ '--commission-accent': commission?.accent ?? '#b97872' } as CSSProperties}
        >
          <div className="character-card">
            <img className="character-card__art" src={art} alt={artAlt} />
            <div className="character-card__wash" aria-hidden="true" />
            <div className="character-card__caption">
              <span>{commission?.customer ?? 'Rabbit House'}</span>
              <small>{commission === undefined ? '随心创作' : '正在等候成品'}</small>
            </div>
          </div>

          <section className="order-ticket">
            <div className="order-ticket__head">
              <span className="order-ticket__number">ORDER {orderNumber}</span>
              <span className="order-ticket__pin" aria-hidden="true" />
            </div>
            <h2>{orderTitle}</h2>
            {commission === undefined ? (
              <p className="free-note">挑一张喜欢的卡纸，把今天的心情留在卡面上吧。</p>
            ) : (
              <>
                <p className="order-ticket__paper">推荐 · {commission.paperLabel}</p>
                <ul className="requirement-list">
                  {commission.requirements.map((requirement, index) => (
                    <li key={requirement} className={checks[index] ? 'is-done' : ''}>
                      <span aria-hidden="true">{checks[index] ? '✓' : ''}</span>
                      {requirement}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <div className="chino-note">
            <span className="chino-note__portrait" aria-hidden="true">☕</span>
            <p>{commission?.requirements[0] ?? '没有规定的答案，做一张你喜欢的卡片就好。'}</p>
          </div>
        </aside>

        <section className="canvas-panel" aria-label="卡片工作台">
          <div className="paper-shelf">
            <div className="paper-shelf__label">
              <span>01</span>
              选择卡纸
            </div>
            <div className="paper-options">
              {PAPERS.map((paper) => (
                <button
                  key={paper.id}
                  type="button"
                  className={`paper-chip${history.present.paperId === paper.id ? ' is-active' : ''}`}
                  aria-label={`${paper.label}卡纸`}
                  aria-pressed={history.present.paperId === paper.id}
                  data-sound="none"
                  onClick={() => applyHistory(paperHistory(history, paper.id), 'paper_pick')}
                >
                  <span className="paper-chip__swatch" style={{ backgroundColor: paper.swatch }} aria-hidden="true" />
                  <span>{paper.label}</span>
                  {history.present.paperId === paper.id && <i aria-hidden="true">✓</i>}
                </button>
              ))}
            </div>
          </div>

          <div className="canvas-stage">
            <div className="canvas-stage__header">
              <div>
                <span className="step-kicker">02 · 摆放与装饰</span>
                <strong>把素材拖到卡片上</strong>
              </div>
              <span className="canvas-stage__tip">虚线内是印刷安全区</span>
            </div>

            <div className={`card-mat${pencilActive ? ' is-drawing' : ''}`} data-sound="none">
              <span className="mat-corner mat-corner--one" aria-hidden="true" />
              <span className="mat-corner mat-corner--two" aria-hidden="true" />
              <CardPreview
                design={previewDesign}
                selectedLayerId={selectedLayerId}
                showSafeArea
                onSelect={onSelect}
                onLayerPointerDown={handleLayerPointerDown}
                onSurfacePointerDown={handleSurfacePointerDown}
                onSurfacePointerMove={handleSurfacePointerMove}
                onSurfacePointerUp={finishPointerGesture}
                onSurfacePointerCancel={finishPointerGesture}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                }}
                onDrop={handleDrop}
              />
              {pencilActive && (
                <div className="drawing-prompt" aria-live="polite">
                  {freeDraw ? "按住卡片任意位置涂画，再点一次画笔即可收起" : "按住卡片底部，轻轻画出一条桌面线"}
                </div>
              )}
            </div>

            <div className="selection-tray" aria-live="polite">
              {selectedLayer === undefined ? (
                <p className="selection-tray__empty">
                  <span aria-hidden="true">✦</span>
                  选中卡面装饰后，可以继续调整
                </p>
              ) : (
                <>
                  <div className="selection-tray__name">
                    <span>正在调整</span>
                    <strong>{layerName(selectedLayer)}</strong>
                  </div>
                  {selectedLayer.kind !== 'stroke' && (
                    <div className="control-group" aria-label="大小和方向">
                      <button type="button" aria-label="缩小" onClick={() => changeScale(-0.02)}>−</button>
                      <button type="button" aria-label="放大" onClick={() => changeScale(0.02)}>＋</button>
                      <button type="button" aria-label="左转" onClick={() => changeRotation(-15)}>↶</button>
                      <button type="button" aria-label="右转" onClick={() => changeRotation(15)}>↷</button>
                    </div>
                  )}
                  <div className="control-group" aria-label="叠放顺序">
                    <button type="button" aria-label="向后一层" onClick={() => moveSelected(-1)}>↓</button>
                    <button type="button" aria-label="向前一层" onClick={() => moveSelected(1)}>↑</button>
                  </div>
                  <div className="control-group control-group--final" aria-label="复制或删除">
                    <button type="button" aria-label="复制" data-sound="none" onClick={copySelected}>⧉</button>
                    <button type="button" className="is-danger" aria-label="删除" onClick={deleteSelected}>×</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <aside className="material-panel" aria-label="素材抽屉">
          <div className="material-panel__head">
            <div>
              <span className="step-kicker">CARD PARTS</span>
              <h2>素材抽屉</h2>
            </div>
            <span className="drawer-knob" aria-hidden="true" />
          </div>

          <div className="category-tabs" role="tablist" aria-label="素材分类">
            {availableCategories.map((category) => (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={activeCategory === category}
                className={activeCategory === category ? 'is-active' : ''}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="material-grid">
            {visibleAssets.map((asset) => (
              <MaterialTile key={asset.id} asset={asset} onAdd={addMaterial} />
            ))}
          </div>

          {canDraw && (
            <section className="pencil-drawer">
              <div>
                <span className="pencil-drawer__icon" aria-hidden="true">╱</span>
                <span>
                  <strong>浅色画笔</strong>
                  <small>{freeDraw ? '可在整张卡片上自由涂画' : '只在卡片底部留下一笔'} · {strokeCount}/20</small>
                </span>
              </div>
              <button
                type="button"
                className={pencilActive ? 'is-active' : ''}
                aria-pressed={pencilActive}
                disabled={strokeCount >= 20}
                onClick={() => {
                  setPencilActive((active) => !active)
                  onSelect(undefined)
                }}
              >
                浅色画笔
              </button>
            </section>
          )}
          {freeDraw && (
            <div className="brush-options" role="group" aria-label="画笔颜色与粗细">
              <div className="brush-options__colors">
                {STROKE_COLORS.map(color => <button key={color.id} type="button" className={brushColor === color.id ? 'is-active' : ''}
                  aria-label={`画笔颜色${color.label}`} aria-pressed={brushColor === color.id} style={{ backgroundColor: color.value }}
                  onClick={() => setBrushColor(color.id)} />)}
              </div>
              <div className="brush-options__widths">
                {STROKE_WIDTHS.map(width => <button key={width.id} type="button" className={brushWidth === width.value ? 'is-active' : ''}
                  aria-pressed={brushWidth === width.value} onClick={() => setBrushWidth(width.value)}>{width.label}</button>)}
              </div>
            </div>
          )}

          <div className="drag-hint">
            <span aria-hidden="true">☝</span>
            <p><strong>拖到卡片上</strong><br />也可以轻点素材快速摆放</p>
          </div>

          <footer className="material-panel__footer">
            <span>{history.present.layers.length}</span>
            <p>卡面上的<br />手作元素</p>
          </footer>
        </aside>
      </div>
    </main>
  )
}
