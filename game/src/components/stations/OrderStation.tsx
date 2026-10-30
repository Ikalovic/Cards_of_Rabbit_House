import { LAYOUTS, PAPERS, SHAPES, SURFACE_FINISHES, isComplexOrder } from '../../content/production'
import { AssetArt } from '../ProductionCard'
import { ownValue } from '../../domain/own-value'
import { CRAFT_NAMES, DIMENSION_NAMES, DISCRETE_NAMES, EmptyStation, MATERIAL_NAMES, StationNext, useStationDraft } from './station-shared'

export function OrderStation() {
  const { selectedOrder } = useStationDraft()
  if (!selectedOrder) return <EmptyStation />
  const { requirements, customer, preferences, taboo } = selectedOrder.content
  return <div className="station-order">
    <div className="station-note"><small>Rabbit House · 本日订单</small><h3>{selectedOrder.content.title}</h3><p>“{customer.situation}”</p><span className="station-tag">{isComplexOrder(selectedOrder.content) ? '精细工艺卡 · 精印机更细腻' : '普通卡 · 两台机器皆可'}</span></div>
    <dl className="station-order-specs">
      <div><dt>卡纸</dt><dd>{PAPERS.find(item => item.id === requirements.paperId)?.label} · {MATERIAL_NAMES[requirements.paperMaterialId]}</dd></div>
      <div><dt>卡型与方向</dt><dd>{SHAPES.find(item => item.id === requirements.shapeId)?.label} · {requirements.orientation === 'landscape' ? '横向' : '竖向'}</dd></div>
      <div><dt>版式</dt><dd>{LAYOUTS.find(item => item.id === requirements.layoutId)?.label}</dd></div>
      <div><dt>表面</dt><dd>{SURFACE_FINISHES.find(item => item.id === requirements.surfaceFinishId)?.label}</dd></div>
    </dl>
    <h3 className="station-subtitle">请一定放进卡片里</h3><div className="station-required">{requirements.elements.map(item => <div key={item.id}><AssetArt kind={item.kind} assetId={item.assetId} /><span>{item.label}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span></div>)}</div>
    {requirements.crafts.length > 0 && <div className="station-note"><h3>手工要求</h3>{requirements.crafts.map(craft => <p key={craft.id}><strong>{CRAFT_NAMES[craft.kind]}</strong> · {Object.entries(craft.targets).map(([name, target]) => `${DIMENSION_NAMES[name as keyof typeof DIMENSION_NAMES]} ${Math.round(target.min * 100)}–${Math.round(target.max * 100)}`).join('；')}{Object.values(craft.discrete).map(value => ` · ${ownValue(DISCRETE_NAMES, value) ?? '指定款式'}`)}</p>)}</div>}
    <div className="station-preferences"><p><strong>♡ 喜欢</strong> {preferences.map(item => item.label).join('；')}</p><p><strong>△ 请避免</strong> {taboo.label}</p></div>
    <StationNext station="preparation">读好订单，去备料</StationNext>
  </div>
}
