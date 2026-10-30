import { useState } from 'react'
import { LAYOUTS } from '../../content/production'
import type { ElementDirection, ElementKind, ElementLayer, ElementSize, PlacedElement } from '../../domain/shift-types'
import { AssetArt, ProductionCard } from '../ProductionCard'
import { costLabel, ELEMENT_CATALOGS, EmptyStation, KIND_NAMES, StationNext, useStationAudio, useStationDraft } from './station-shared'

type AssetChoice = { kind: ElementKind; assetId: string }
export function AssemblyStation() {
  const { draft, dispatch, run } = useStationDraft()
  useStationAudio(run, draft)
  const [category, setCategory] = useState<ElementKind>('motif')
  const [choice, setChoice] = useState<AssetChoice | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hint, setHint] = useState('先从素材盒选取一件，再点卡片上的位置；也可以直接拖进去。')
  if (!draft || !run) return <EmptyStation />
  if (draft.stage === 'not_started' || draft.stage === 'preparing') return <div className="station-empty"><h3>先准备一张卡胚</h3><p>在备料台完成选择，再按下“裁出卡胚”。</p><StationNext station="preparation">去备料</StationNext></div>
  const layout = LAYOUTS.find(item => item.id === draft.design.preparation.layoutId)
  const selected = draft.design.elements.find(item => item.id === selectedId)
  const selectedSlot = layout?.slots.find(item => item.id === selected?.slotId)
  const place = (slotId: string, asset = choice) => {
    if (!asset) { const existing = draft.design.elements.find(item => item.slotId === slotId); setSelectedId(existing?.id ?? null); setHint(existing ? '可以调整大小、方向与前后层次。' : '先从素材盒选取一件素材。'); return }
    const slot = layout?.slots.find(item => item.id === slotId)
    if (!slot?.accepts.includes(asset.kind)) { setHint(`这里是${slot?.label ?? '空位'}，请放入对应的${slot?.accepts.map(kind => KIND_NAMES[kind]).join('或') ?? '素材'}。`); return }
    const item = ELEMENT_CATALOGS[asset.kind].find(item => item.id === asset.assetId)
    if (!item) return
    if (item.materialCosts.some(cost => run.materials.stock[cost.materialId].available < cost.quantity)) { setHint('这份高级素材暂时用完了，请换一种或撤下尚未固定的素材。'); return }
    const existing = draft.design.elements.find(item => item.slotId === slotId)
    const element: PlacedElement = { id: existing?.id ?? `${draft.id}:piece:${draft.revision + 1}`, ...asset, slotId, size: 'small', direction: 'upright', layer: 'front' }
    void dispatch({ station: 'assembly', type: 'place-element', draftId: draft.id, element })
    setSelectedId(element.id); setChoice(null); setHint(`${item.label}已放进${slot.label}，请亲自调整大小和方向。`)
  }
  const adjust = (changes: Partial<Pick<PlacedElement, 'size' | 'direction' | 'layer'>>) => { if (selected) void dispatch({ station: 'assembly', type: 'place-element', draftId: draft.id, element: { ...selected, ...changes } }) }
  return <div className="station-stack">
    <p className="station-intro" role="status">{hint}</p>
    <div className="station-assembly-layout"><div className="station-asset-box"><div className="station-catalog-tabs">{(Object.keys(KIND_NAMES) as ElementKind[]).map(kind => <button key={kind} aria-pressed={category === kind} onClick={() => setCategory(kind)}>{KIND_NAMES[kind]}</button>)}</div><div className="station-asset-grid">{ELEMENT_CATALOGS[category].map(asset => <button data-sound="paper_pick" key={asset.id} aria-label={`选取${asset.label}`} aria-pressed={choice?.assetId === asset.id && choice.kind === category} draggable onDragStart={event => { event.dataTransfer.setData('application/x-rabbit-asset', JSON.stringify({ kind: category, assetId: asset.id })); event.dataTransfer.effectAllowed = 'copy' }} onClick={() => { setChoice({ kind: category, assetId: asset.id }); setHint(`拿起了${asset.label}，请点选卡片上的${KIND_NAMES[category]}位置。`) }} title={`${asset.label} · ${costLabel(asset.materialCosts)}`}><AssetArt kind={category} assetId={asset.id} /><span>{asset.label}</span>{asset.materialCosts.length > 0 && <small>限量</small>}</button>)}</div></div>
      <div className="station-assembly-card" data-sound="none"><ProductionCard design={draft.design} showSlots selectedSlotId={selected?.slotId} onSlotSelect={slotId => place(slotId)} onSlotDrop={place} /><div className="station-slot-strip">{layout?.slots.map(slot => <button key={slot.id} aria-label={`选择${slot.label}`} onClick={() => place(slot.id)}>{slot.label}</button>)}</div></div>
    </div>
    {selected && <fieldset className="station-adjust"><legend>调整这一件 · {ELEMENT_CATALOGS[selected.kind].find(asset => asset.id === selected.assetId)?.label}</legend><label>元素大小<select aria-label="元素大小" value={selected.size} onChange={event => adjust({ size: event.target.value as ElementSize })}><option value="small">小</option><option value="medium">中</option><option value="large">大</option></select></label><label>元素方向<select aria-label="元素方向" value={selected.direction} onChange={event => adjust({ direction: event.target.value as ElementDirection })}><option value="upright">正向</option><option value="left">朝左</option><option value="right">朝右</option><option value="inverted">倒置</option></select></label><label>元素层次<select aria-label="元素层次" value={selected.layer} onChange={event => adjust({ layer: event.target.value as ElementLayer })}><option value="front">前层</option><option value="back">后层</option></select></label><button data-sound="none" className="station-secondary" onClick={() => { void dispatch({ station: 'assembly', type: 'remove-element', draftId: draft.id, elementId: selected.id }); setSelectedId(null) }}>取下这一件</button><small>{selectedSlot?.label}可用尺寸：{selectedSlot?.sizes.map(size => ({ small: '小', medium: '中', large: '大' })[size]).join('、')}；倒置会影响整齐程度。</small></fieldset>}
    <div className="station-actions"><p>{draft.stage === 'crafting' ? '✓ 本轮组装已固定' : '固定时会用掉本轮保留的花边、特殊边框与高级饰片。'}</p><button data-sound="none" className="station-primary" disabled={run.status !== 'running' || draft.stage === 'crafting' || draft.stage === 'archived'} onClick={() => { void dispatch({ station: 'assembly', type: 'fix-assembly', draftId: draft.id }) }}>固定组装</button>{(draft.stage === 'crafting' || draft.stage === 'archived') && <StationNext station="craft">去做工艺</StationNext>}</div>
  </div>
}
