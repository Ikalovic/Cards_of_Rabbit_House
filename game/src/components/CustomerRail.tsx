import { useShift } from '../app/ShiftProvider'
import { CUSTOMER_COPY, OPERATIONAL_COPY, STORY_STAGES, SUPPORTING_CUSTOMER_COPY } from '../content/story'
import { ORDER_TEMPLATES } from '../content/production'
import type { CustomerOrder } from '../domain/shift-types'
import { formatShiftTime } from './ShiftHud'
import { CustomerPortrait } from './CustomerPortrait'
import { ISSUE_LABELS } from './stations/InspectionStation'
import { ownValue } from '../domain/own-value'

export function CustomerRail() {
  const { run, displayNowMs, dispatch } = useShift()
  if (!run) return null
  const orders = run.orders.filter(order => order.arrivalAtMs <= displayNowMs)
  const story = run.stage.kind === 'authored' ? STORY_STAGES[run.stage.id] : undefined
  function patience(order: CustomerOrder) {
    if (order.outcome.status !== 'pending') return null
    const current = order.patience
    const remaining = current.phase === 'normal' ? current.remainingSeconds
      : current.phase === 'last_wait' ? Math.max(0, (current.deadlineAtMs - displayNowMs) / 1000) : 0
    const maximum = Math.max(1, current.phase === 'last_wait' ? Math.max(current.originalDurationSeconds, remaining) : order.basePatienceSeconds)
    const value = Math.min(maximum, Math.max(0, remaining))
    return <div className={`shift-patience ${current.phase === 'last_wait' ? 'shift-patience-urgent' : ''}`}>
      <svg className="shift-patience-ring" viewBox="0 0 40 40" role="progressbar" aria-label={`${order.content.customer.name}的耐心`}
        aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={value} aria-valuetext={`剩余 ${formatShiftTime(remaining)}`}>
        <circle className="shift-patience-track" cx="20" cy="20" r="16" />
        <circle className="shift-patience-value" cx="20" cy="20" r="16" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - value / maximum * 100} />
      </svg>
      <span className={current.phase === 'last_wait' ? 'shift-warning' : undefined}>{current.phase === 'last_wait' ? '⚠ 最后等候' : '◷ 耐心等候'} · {formatShiftTime(remaining)}</span>
    </div>
  }
  return <aside className="shift-customer-rail" aria-label="门口等候">
    <div className="shift-section-title"><h2>门口等候</h2><span>接单上限 3</span></div>
    <div className="shift-customer-list">
      {orders.length === 0 && <p className="shift-empty">门铃还没有响，先整理一下台面吧。</p>}
      {orders.map(order => {
        const template = ORDER_TEMPLATES.find(template => (template.id === order.content.id || template.title === order.content.title)
          && template.customer.kind === order.content.customer.kind && template.customer.name === order.content.customer.name)
        const authoredCopy = story?.customers.find(customer => customer.id === order.content.id && customer.name === order.content.customer.name
          && template?.id === customer.id && JSON.stringify(template.requirements) === JSON.stringify(order.content.requirements))
        const characterCopy = order.content.customer.kind === 'official'
          ? ownValue(SUPPORTING_CUSTOMER_COPY, order.content.customer.characterId) : undefined
        const copy = authoredCopy ?? characterCopy ?? (template ? ownValue(CUSTOMER_COPY, template.id) : undefined)
        const delivered = order.outcome.status === 'delivered' ? order.outcome.evaluation : undefined
        const reaction = order.outcome.status === 'left' ? copy?.leftWithoutCard ?? OPERATIONAL_COPY.worldErrors.customerLeft
          : delivered ? delivered.satisfied ? copy?.greatDelivery ?? '这张卡片很合心意，谢谢你！' : copy?.okayDelivery ?? '卡片收到了，谢谢你。'
            : order.patience.phase === 'last_wait' ? copy?.patienceWarning ?? '还需要多久呢？我得准备出门了。'
              : authoredCopy?.greeting ?? characterCopy?.greeting ?? order.content.customer.situation
        return <article className={`shift-customer ${order.outcome.status !== 'pending' ? 'shift-customer-closed' : ''}`} key={order.id}>
          <div className="shift-customer-heading"><CustomerPortrait customer={order.content.customer} portrait={copy?.portrait} /><div><h3>{order.content.customer.name}</h3><span>{order.outcome.status === 'left' ? '↪ 已离店' : order.outcome.status === 'delivered' ? '✓ 已交付' : order.position === 'active' ? '✂ 制作中' : '♧ 门口等候'}</span></div></div>
          <p className="shift-customer-request">{authoredCopy?.requestSummary ?? order.content.title}</p>
          <p className="shift-customer-speech">{reaction}</p>
          {patience(order)}
          {delivered && <section className="shift-delivery-feedback" aria-label={`${order.content.customer.name}的本单评价`}>
            <strong>{delivered.score} 分 · {delivered.grade} 级</strong><span>{delivered.satisfied ? '满意' : '尚未满意'}</span>
            {delivered.advice.length ? <ul>{[...new Set(delivered.advice)].slice(0, 3).map(code => <li key={code}>{ownValue(ISSUE_LABELS, code) ?? '下次再对照订单，留意制作细节。'}</li>)}</ul>
              : <p>各项要求都照顾到了，继续保持这个步调。</p>}
          </section>}
          {order.position === 'door_waiting' && order.outcome.status === 'pending' && <button className="shift-accept" disabled={run.activeOrderIds.length >= 3 || run.status !== 'running'} onClick={() => { void dispatch({ station: 'reception', type: 'accept-order', orderId: order.id }) }}>接下 {order.content.customer.name} 的订单</button>}
        </article>
      })}
    </div>
  </aside>
}
