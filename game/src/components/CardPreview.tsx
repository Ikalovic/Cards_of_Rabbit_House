import type {
  CSSProperties,
  DragEventHandler,
  PointerEvent as ReactPointerEvent,
  PointerEventHandler,
} from 'react'
import { assetById, assetImage, paperImage, PAPERS, strokeColorValue } from '../content/assets'
import type { CardDesign, CardLayer } from '../domain/types'

export type CardPreviewProps = Readonly<{
  design: CardDesign
  selectedLayerId?: string
  showSafeArea?: boolean
  className?: string
  onSelect?: (layerId?: string) => void
  onLayerPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    layerId: string,
  ) => void
  onSurfacePointerDown?: PointerEventHandler<HTMLDivElement>
  onSurfacePointerMove?: PointerEventHandler<HTMLDivElement>
  onSurfacePointerUp?: PointerEventHandler<HTMLDivElement>
  onSurfacePointerCancel?: PointerEventHandler<HTMLDivElement>
  onDragOver?: DragEventHandler<HTMLDivElement>
  onDrop?: DragEventHandler<HTMLDivElement>
}>

const paperTexture = (paperId: CardDesign['paperId']) => {
  switch (paperId) {
    case 'cream':
      return 'radial-gradient(circle at 24% 18%, rgba(255,255,255,.7), transparent 34%), linear-gradient(135deg, #fffaf0, #efe0c5)'
    case 'coffee':
      return 'radial-gradient(circle at 78% 16%, rgba(255,255,255,.16), transparent 28%), linear-gradient(145deg, #b88967, #81573d)'
    case 'mint':
      return 'radial-gradient(circle at 20% 15%, rgba(255,255,255,.55), transparent 32%), linear-gradient(135deg, #e5f4e9, #b8d8c6)'
    case 'pink':
      return 'radial-gradient(circle at 75% 18%, rgba(255,255,255,.5), transparent 30%), linear-gradient(135deg, #fae5e8, #e9bcc5)'
  }
}

const tidy = (value: number) => Number(value.toFixed(4))

const layerStyle = (layer: Exclude<CardLayer, { kind: 'stroke' }>): CSSProperties => {
  const widthPercent = tidy(layer.scale * 100)
  return ({
    left: `${layer.x * 100}%`,
    top: `${layer.y * 100}%`,
    '--layer-turn': `${layer.rotation}deg`,
    '--layer-width': `${widthPercent}%`,
    '--layer-glyph-size': `${tidy(layer.scale * 76)}cqw`,
    '--layer-stamp-size': `${tidy(Math.min(3.2, Math.max(1.4, layer.scale * 10)))}cqw`,
  }) as CSSProperties
}

const layerLabel = (layer: Exclude<CardLayer, { kind: 'stroke' }>) => {
  if (layer.kind === 'text-stamp') return layer.text
  return assetById(layer.assetId)?.label ?? '贴纸'
}

function Stroke({ layer }: Readonly<{ layer: Extract<CardLayer, { kind: 'stroke' }> }>) {
  const points = layer.points.map((point) => `${point.x * 900},${point.y * 600}`).join(' ')

  return (
    <svg className="card-stroke" viewBox="0 0 900 600" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={strokeColorValue(layer.colorId)}
        strokeWidth={Math.max(3, layer.width * 900)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The shared, side-effect-free card renderer. The workbench supplies editing
 * callbacks; StampBook and result screens can use the same component read-only.
 */
export function CardPreview({
  design,
  selectedLayerId,
  showSafeArea = false,
  className = '',
  onSelect,
  onLayerPointerDown,
  onSurfacePointerDown,
  onSurfacePointerMove,
  onSurfacePointerUp,
  onSurfacePointerCancel,
  onDragOver,
  onDrop,
}: CardPreviewProps) {
  const paper = PAPERS.find((candidate) => candidate.id === design.paperId)

  return (
    <div
      className={`card-preview card-preview--${design.paperId} ${className}`.trim()}
      data-testid="card-surface"
      data-paper={design.paperId}
      style={{
        '--paper-color': paper?.swatch ?? '#f7ecd7',
        backgroundImage: `url(${paperImage(design.paperId)}), ${paperTexture(design.paperId)}`,
        backgroundSize: 'cover',
      } as CSSProperties}
      onPointerDown={onSurfacePointerDown}
      onPointerMove={onSurfacePointerMove}
      onPointerUp={onSurfacePointerUp}
      onPointerCancel={onSurfacePointerCancel}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="card-paper-grain" aria-hidden="true" />
      {showSafeArea && (
        <div className="card-safe-area" aria-label="印刷安全区">
          <span>安全区</span>
        </div>
      )}

      <div className="card-corner-mark card-corner-mark--top" aria-hidden="true">RH</div>
      <div className="card-corner-mark card-corner-mark--bottom" aria-hidden="true">HANDMADE</div>

      {design.layers.map((layer) => {
        if (layer.kind === 'stroke') return <Stroke key={layer.id} layer={layer} />

        const label = layerLabel(layer)
        const selected = selectedLayerId === layer.id
        const asset = layer.kind === 'sticker' ? assetById(layer.assetId) : undefined

        return (
          <button
            key={layer.id}
            type="button"
            className={`card-layer card-layer--${layer.kind}${selected ? ' is-selected' : ''}`}
            style={layerStyle(layer)}
            aria-label={`选择${label}`}
            aria-pressed={selected}
            data-layer-id={layer.id}
            data-asset-id={layer.kind === 'sticker' ? layer.assetId : undefined}
            onClick={(event) => {
              event.stopPropagation()
              onSelect?.(layer.id)
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              onLayerPointerDown?.(event, layer.id)
            }}
          >
            {layer.kind === 'sticker' ? (
              <span className="card-layer__glyph" aria-hidden="true">
                {asset && assetImage(asset.id) ? <img className="card-layer__art" src={assetImage(asset.id)} alt="" draggable={false} /> : (asset?.glyph ?? '✦')}
              </span>
            ) : (
              <span className="card-layer__stamp">{layer.text}</span>
            )}
            {selected && <span className="card-layer__handle" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}
