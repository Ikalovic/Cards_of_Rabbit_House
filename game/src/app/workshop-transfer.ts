import { ASSETS, PAPERS as WORKSHOP_PAPERS } from '../content/assets'
import { BORDERS, DECORATIONS, LAYOUTS, MOTIFS, PAPERS, WORD_STAMPS } from '../content/production'
import type { ProductionDesign } from '../domain/shift-types'
import type { CardDesign, CardLayer } from '../domain/types'

/** Copy supported artwork into the independent editor; always describe lossy differences. */
export function prepareWorkshopTransfer(source: ProductionDesign): Readonly<{
  design: CardDesign; carried: readonly string[]; adjustments: readonly string[]
}> {
  const paper = WORKSHOP_PAPERS.find(paper => paper.id === source.preparation.paperId)
  const layout = LAYOUTS.find(layout => layout.id === source.preparation.layoutId)
  const carried: string[] = [paper ? `${paper.label}卡纸` : '奶油白卡纸']
  const adjustments: string[] = []
  const omitted: string[] = []
  const layers: CardLayer[] = []
  if (!paper && source.preparation.paperId) adjustments.push(`原来的${PAPERS.find(paper => paper.id === source.preparation.paperId)?.label ?? '卡纸'}换成奶油白，可到工坊重新选色。`)
  if (source.preparation.shapeId !== 'landscape' || source.preparation.orientation !== 'landscape') adjustments.push('自由工坊使用横向平卡，原来的卡胚形状与朝向会改为横向平卡。')
  for (const element of [...source.elements].sort((a, b) => Number(a.layer === 'front') - Number(b.layer === 'front'))) {
    const slot = layout?.slots.find(slot => slot.id === element.slotId)
    const catalog = element.kind === 'word-stamp' ? WORD_STAMPS : element.kind === 'border' ? BORDERS : element.kind === 'motif' ? MOTIFS : DECORATIONS
    const label = catalog.find(asset => asset.id === element.assetId)?.label ?? '一枚装饰'
    const base = { id: `workshop:${element.id}`, x: slot?.x ?? .5, y: slot?.y ?? .5,
      scale: Math.min(.8, Math.max(.06, (slot?.width ?? .24) * (element.size === 'small' ? .7 : element.size === 'large' ? 1.2 : 1))),
      rotation: element.direction === 'left' ? -15 : element.direction === 'right' ? 15 : element.direction === 'inverted' ? 180 : 0 }
    if (element.kind === 'word-stamp') {
      layers.push({ ...base, kind: 'text-stamp', styleId: 'thanks-stamp', text: label })
      carried.push(`${label}字章`)
    } else if (element.kind !== 'border' && ASSETS.some(asset => asset.id === element.assetId && asset.kind === 'sticker')) {
      layers.push({ ...base, kind: 'sticker', assetId: element.assetId })
      carried.push(label)
    } else omitted.push(label)
  }
  if (omitted.length) adjustments.push(`这些素材仍留在原草稿里，工坊中需要重新装饰：${[...new Set(omitted)].join('、')}。`)
  if (source.preparation.paperMaterialId !== 'smooth' || source.preparation.surfaceFinishId !== 'matte') adjustments.push('原有纸材与表面效果会换成工坊的普通卡纸效果。')
  if (source.crafts.length) {
    const names = { stamp: '盖章', trim: '裁边', ribbon: '缎带固定', foil: '烫金', wax: '蜡封' }
    adjustments.push(`已做的${[...new Set(source.crafts.map(craft => names[craft.kind]))].join('、')}工艺效果保留在原草稿预览里，不会带入工坊。`)
  }
  if (layers.length) adjustments.push('图案会换成工坊贴纸与字章的画风，保留相对位置、大小与方向；你可以继续调整。')
  return { design: { version: 1, paperId: paper?.id ?? 'cream', layers }, carried, adjustments }
}
