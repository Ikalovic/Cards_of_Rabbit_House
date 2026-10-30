import { useShift } from '../app/ShiftProvider'
import { isComplexOrder, LAYOUTS, PAPERS, SHAPES, SURFACE_FINISHES } from '../content/production'
import type { CustomerOrder, ShiftRun } from '../domain/shift-types'
import { ownValue } from '../domain/own-value'
import { CRAFT_NAMES, DIMENSION_NAMES, DISCRETE_NAMES, MATERIAL_NAMES } from './stations/station-shared'

function progressFor(run: ShiftRun, order: CustomerOrder): string {
  const tasks = Object.values(run.tasks).filter(task => task.orderId === order.id)
  if (tasks.some(task => task.status === 'ready')) return '◇ 冲印完成 · 等待交付'
  if (tasks.some(task => task.status === 'printing')) return '▣ 正在冲印'
  if (tasks.some(task => task.status === 'queued')) return '◷ 等候冲印'
  const authorization = Object.values(run.authorizations).find(auth => auth.orderId === order.id && (auth.status === 'calibrating' || auth.status === 'calibrated_pending_start'))
  if (authorization) return authorization.status === 'calibrating' ? '⌖ 正在校准' : '⌖ 校准完成 · 确认冲印中'
  const draft = Object.values(run.drafts).filter(draft => draft.orderId === order.id).sort((a, b) => b.revision - a.revision)[0]
  const labels = { not_started: '① 等待备料', preparing: '① 正在备料', assembling: '② 正在组装', crafting: '③ 正在制作工艺', archived: '④ 已收进卡册 · 等候冲印' }
  return draft ? labels[draft.stage] : '① 等待备料'
}
export function OrderTickets() {
  const { run, dispatch } = useShift()
  if (!run) return null
  return <aside className="shift-tickets" aria-label="进行中的订单">
    <div className="shift-section-title"><h2>进行中的订单</h2><span>{run.activeOrderIds.length} / 3</span></div>
    <div className="shift-ticket-list">{['Q', 'W', 'E'].map((key, index) => {
      const order = run.orders.find(order => order.id === run.activeOrderIds[index] && order.position === 'active' && order.outcome.status === 'pending')
      if (!order) return <div key={key} className="shift-ticket shift-ticket-empty" data-testid="ticket-slot"><span>{key} · 订单位 {index + 1}</span><strong>空闲订单位</strong><p>去接单台迎接一位客人</p></div>
      const requirements = order.content.requirements
      const preparation = [PAPERS.find(paper => paper.id === requirements.paperId)?.label, MATERIAL_NAMES[requirements.paperMaterialId], SHAPES.find(shape => shape.id === requirements.shapeId)?.label,
        requirements.orientation === 'landscape' ? '横向' : '竖向',
        LAYOUTS.find(layout => layout.id === requirements.layoutId)?.label].filter(Boolean).join(' · ')
      const assembly = requirements.elements.map(element => `${element.label}${element.quantity > 1 ? ` ×${element.quantity}` : ''}`).join(' · ')
      const crafts = requirements.crafts.map(craft => `${CRAFT_NAMES[craft.kind]}：${[
        ...Object.entries(craft.targets).map(([name, target]) => `${DIMENSION_NAMES[name as keyof typeof DIMENSION_NAMES]} ${Math.round(target.min * 100)}–${Math.round(target.max * 100)}`),
        ...Object.values(craft.discrete).map(value => ownValue(DISCRETE_NAMES, value) ?? '指定款式'),
      ].join('、')}`).join('；')
      return <button key={key} data-testid="ticket-slot" className="shift-ticket" aria-label={`${key} 订单位 ${index + 1} ${order.content.customer.name}`} aria-pressed={run.selectedOrderId === order.id} disabled={run.status !== 'running'} onClick={() => { void dispatch({ type: 'select-order', orderId: order.id }) }}>
        <span className="shift-ticket-heading"><span>{key} · 订单位 {index + 1}</span><strong>{order.content.customer.name}</strong></span>
        <strong>{order.content.title}</strong>
        <span className="shift-ticket-classification">{isComplexOrder(order.content) ? '复杂卡' : '普通卡'}</span>
        <span><b>备料</b> {preparation}</span>
        <span><b>组装</b> {assembly}</span>
        <span><b>工艺</b> {SURFACE_FINISHES.find(finish => finish.id === requirements.surfaceFinishId)?.label} · {crafts || '无需手工作业'}</span>
        <span><b>喜欢</b> {order.content.preferences.map(preference => preference.label).join(' · ') || '按订单细心制作'}</span>
        <span><b>避免</b> {order.content.taboo.label}</span>
        <span className="shift-ticket-progress">{progressFor(run, order)}</span>
      </button>
    })}</div>
  </aside>
}
