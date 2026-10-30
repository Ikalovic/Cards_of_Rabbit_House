import type {
  CardLayer,
  CommissionId,
  StickerLayer,
  TextStampLayer,
} from '../domain/types'

export type AssetCategory = '饮品' | '兔兔' | '装饰' | '字章'

export type AssetDefinition = Readonly<{
  id: string
  label: string
  category: AssetCategory
  kind: 'sticker' | 'text-stamp'
  glyph: string
  text?: string
}>

export const PAPERS = [
  { id: 'cream', label: '奶油白', swatch: '#f7ecd7' },
  { id: 'coffee', label: '咖啡棕', swatch: '#9a6d4c' },
  { id: 'mint', label: '薄荷绿', swatch: '#cfe6d7' },
  { id: 'pink', label: '樱花粉', swatch: '#f2ccd2' },
] as const

export const ASSETS: readonly AssetDefinition[] = [
  { id: 'coffee-cup', label: '咖啡杯', category: '饮品', kind: 'sticker', glyph: '☕' },
  { id: 'tea-cup', label: '茶杯', category: '饮品', kind: 'sticker', glyph: '🍵' },
  { id: 'rabbit', label: '小兔', category: '兔兔', kind: 'sticker', glyph: '🐇' },
  { id: 'tippy', label: '提比', category: '兔兔', kind: 'sticker', glyph: '☁' },
  { id: 'coffee-bean', label: '咖啡豆', category: '饮品', kind: 'sticker', glyph: '◒' },
  { id: 'sugar', label: '方糖', category: '饮品', kind: 'sticker', glyph: '◇' },
  { id: 'ribbon', label: '缎带', category: '装饰', kind: 'sticker', glyph: '〜' },
  { id: 'star', label: '星星', category: '装饰', kind: 'sticker', glyph: '★' },
  { id: 'flower', label: '小花', category: '装饰', kind: 'sticker', glyph: '✿' },
  {
    id: 'thanks-stamp',
    label: '谢谢光临',
    category: '字章',
    kind: 'text-stamp',
    glyph: '谢',
    text: '谢谢光临',
  },
  {
    id: 'today-stamp',
    label: '今日推荐',
    category: '字章',
    kind: 'text-stamp',
    glyph: '今',
    text: '今日推荐',
  },
  {
    id: 'tea-party-stamp',
    label: '午后茶会',
    category: '字章',
    kind: 'text-stamp',
    glyph: '茶',
    text: '午后茶会',
  },
] as const

const COMMISSION_ASSETS: Record<CommissionId, readonly string[]> = {
  chino: ['coffee-cup', 'rabbit', 'thanks-stamp', 'coffee-bean', 'sugar', 'tippy'],
  rize: ['coffee-cup', 'ribbon', 'star', 'today-stamp', 'rabbit'],
  'chiya-sharo': ['tea-cup', 'flower', 'tea-party-stamp', 'rabbit'],
}

type Placement = Readonly<{ x: number; y: number; scale: number; rotation?: number }>

const placementFor = (
  assetId: string,
  commissionId: CommissionId | undefined,
  instance: number,
): Placement => {
  if (commissionId === 'chino') {
    if (assetId === 'coffee-cup') return { x: 0.25, y: 0.55, scale: 0.26, rotation: -4 }
    if (assetId === 'thanks-stamp') return { x: 0.68, y: 0.45, scale: 0.24 }
    if (assetId === 'rabbit') return { x: 0.82, y: 0.78, scale: 0.12, rotation: 5 }
  }

  if (commissionId === 'rize') {
    if (assetId === 'today-stamp') return { x: 0.5, y: 0.18, scale: 0.26 }
    if (assetId === 'coffee-cup') return { x: 0.5, y: 0.48, scale: 0.3 }
    if (assetId === 'ribbon') return { x: 0.5, y: 0.82, scale: 0.54 }
    if (assetId === 'star') {
      return { x: instance % 2 === 0 ? 0.25 : 0.75, y: 0.5, scale: 0.12 }
    }
  }

  if (commissionId === 'chiya-sharo') {
    if (assetId === 'tea-party-stamp') return { x: 0.5, y: 0.18, scale: 0.27 }
    if (assetId === 'tea-cup') {
      return { x: instance % 2 === 0 ? 0.32 : 0.68, y: 0.68, scale: 0.2 }
    }
    if (assetId === 'flower') {
      const flowers = [
        { x: 0.22, y: 0.3 },
        { x: 0.78, y: 0.3 },
        { x: 0.5, y: 0.83 },
      ]
      return { ...(flowers[instance % flowers.length] ?? flowers[0]), scale: 0.12 }
    }
  }

  const column = instance % 4
  const row = Math.floor(instance / 4) % 3
  return { x: 0.24 + column * 0.17, y: 0.28 + row * 0.2, scale: 0.18 }
}

export function assetsForCommission(commissionId?: CommissionId): readonly AssetDefinition[] {
  if (commissionId === undefined) return ASSETS
  const allowed = new Set(COMMISSION_ASSETS[commissionId])
  return ASSETS.filter((asset) => allowed.has(asset.id))
}

export function createLayerFromAsset(
  assetId: string,
  commissionId: CommissionId | undefined,
  instance: number,
  layerId: string,
): CardLayer {
  const asset = ASSETS.find((candidate) => candidate.id === assetId)
  if (asset === undefined) throw new Error(`Unknown card asset: ${assetId}`)
  const placement = placementFor(assetId, commissionId, instance)

  if (asset.kind === 'text-stamp') {
    const layer: TextStampLayer = {
      kind: 'text-stamp',
      id: layerId,
      styleId: asset.id,
      text: asset.text ?? asset.label,
      x: placement.x,
      y: placement.y,
      scale: placement.scale,
      rotation: placement.rotation ?? 0,
    }
    return layer
  }

  const layer: StickerLayer = {
    kind: 'sticker',
    id: layerId,
    assetId: asset.id,
    x: placement.x,
    y: placement.y,
    scale: placement.scale,
    rotation: placement.rotation ?? 0,
  }
  return layer
}

export const assetById = (assetId: string) => ASSETS.find((asset) => asset.id === assetId)

const STICKER_IMAGES: Readonly<Record<string, string>> = {
  'coffee-cup': 'coffee-cup', 'tea-cup': 'tea-cup', rabbit: 'rabbit', tippy: 'tippy', 'coffee-bean': 'coffee-bean',
  sugar: 'sugar', ribbon: 'ribbon', star: 'star', flower: 'flower',
}

/** Generated sticker art for an asset id; text stamps have none. */
export const assetImage = (assetId: string): string | undefined =>
  STICKER_IMAGES[assetId] ? `/assets/v2/stickers/${STICKER_IMAGES[assetId]}.png` : undefined

export const paperImage = (paperId: string) => `/assets/v2/papers/${paperId}.png`

export const STROKE_COLORS = [
  { id: 'cream-pencil', label: '奶油白', value: '#fff4d6' },
  { id: 'cocoa-ink', label: '可可棕', value: '#6b4b3e' },
  { id: 'rose-ink', label: '玫瑰红', value: '#d4687a' },
  { id: 'sky-ink', label: '天空蓝', value: '#5f9eae' },
  { id: 'leaf-ink', label: '叶片绿', value: '#6fa57c' },
  { id: 'gold-ink', label: '蜂蜜金', value: '#d9a441' },
] as const

export const STROKE_WIDTHS = [
  { id: 'thin', label: '细', value: 0.006 },
  { id: 'medium', label: '中', value: 0.012 },
  { id: 'thick', label: '粗', value: 0.024 },
] as const

export const strokeColorValue = (colorId: string) =>
  STROKE_COLORS.find(color => color.id === colorId)?.value ?? '#6b4b3e'
