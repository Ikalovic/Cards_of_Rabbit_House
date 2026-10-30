import { useShift } from '../app/ShiftProvider'
import { MATERIALS } from '../content/production'
import type { MachineId, ShiftRun } from '../domain/shift-types'

export function formatShiftTime(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}
function PrinterSummary({ run, machineId, nowMs }: { run: ShiftRun; machineId: MachineId; nowMs: number }) {
  const printer = run.printers[machineId]
  const task = printer.currentTaskId ? run.tasks[printer.currentTaskId] : undefined
  const order = task ? run.orders.find(order => order.id === task.orderId) : undefined
  const eta = printer.estimatedFreeAtMs === null ? '空闲' : formatShiftTime((printer.estimatedFreeAtMs - nowMs) / 1000)
  return <div className="shift-printer-summary">
    <strong>{machineId === 'quick' ? '⚡ 快速冲印机' : '✦ 精细冲印机'}</strong>
    <span>{task?.status === 'printing' ? `正在冲印：${order?.content.customer.name ?? '卡片'} · ${formatShiftTime((task.completesAtMs - nowMs) / 1000)}` : '○ 当前空闲'}</span>
    <span>排队 {printer.queuedTaskIds.length} · 预留机位 {printer.reservations.length} · 预计腾空 {eta}</span>
  </div>
}
export function ShiftResources() {
  const { run, displayNowMs } = useShift()
  if (!run) return null
  return <section className="shift-resources" aria-label="冲印与物料">
    <div className="shift-printer-pair">
      <PrinterSummary run={run} machineId="quick" nowMs={displayNowMs} />
      <PrinterSummary run={run} machineId="fine" nowMs={displayNowMs} />
    </div>
    <div className="shift-support-summary">
      <span>⌕ 检查剩余 {run.inspectionsRemaining} 次{run.freeDemoInspectionsRemaining > 0 ? ' · 教学检查 1 次' : ''}</span>
      <span>☕ 说明进度：{run.remedies.explainProgressAvailable ? '可用' : '已用'}</span>
      <span>↗ 紧急加印：{run.remedies.expediteAvailable ? '可用' : '已用'}</span>
    </div>
    <div className="shift-material-summary" aria-label="物料库存">
      <strong>▤ 物料</strong>
      {MATERIALS.map(material => <span key={material.id}>{material.label} {run.materials.stock[material.id].available}<small> / 预留 {run.materials.stock[material.id].reserved}</small></span>)}
    </div>
  </section>
}
export function ShiftHud() {
  const { run, displayNowMs, remainingSeconds, dispatch } = useShift()
  if (!run) return null
  const closingSoon = run.status !== 'settled' && remainingSeconds <= 60
  const arrived = run.orders.filter(order => order.arrivalAtMs <= displayNowMs)
  const tasks = Object.values(run.tasks)
  const printingIds = new Set(tasks.filter(task => task.status === 'printing' || task.status === 'queued').map(task => task.orderId))
  const readyIds = new Set(tasks.filter(task => task.status === 'ready').map(task => task.orderId))
  const counts = [
    ['✓ 已交付', run.orders.filter(order => order.outcome.status === 'delivered').length],
    ['♧ 等候', arrived.filter(order => order.position === 'door_waiting' && order.outcome.status === 'pending').length],
    ['✂ 制作', run.activeOrderIds.filter(id => !printingIds.has(id) && !readyIds.has(id)).length],
    ['▣ 冲印', tasks.filter(task => task.status === 'printing' || task.status === 'queued').length],
    ['◇ 待交付', tasks.filter(task => task.status === 'ready').length],
    ['↪ 已离店', run.orders.filter(order => order.outcome.status === 'left').length],
  ] as const
  return <header className="shift-hud">
    <div className="shift-brand"><span>Rabbit House · 小小制卡室</span><h1>{run.stage.label}</h1><p className="shift-business-day">第 {run.stage.day} 营业日</p></div>
    <div className={`shift-clock${closingSoon ? ' shift-clock-urgent' : ''}`}>
      <span>{run.status === 'paused' ? 'Ⅱ 教学与故事暂停' : run.status === 'settled' ? '☾ 营业结束' : '◷ 营业中'}</span>
      <strong aria-label="本班剩余时间">{formatShiftTime(remainingSeconds)}</strong>
      <small>营业时长 12:00</small>
      {closingSoon && <span className="shift-warning">⚠ 即将打烊：最后一分钟</span>}
      {run.status === 'running' && run.orders.every(order => order.outcome.status !== 'pending') && <button className="shift-close-button" onClick={() => { void dispatch({ type: 'close-shift' }) }}>提前打烊</button>}
    </div>
    <dl className="shift-counts">{counts.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
  </header>
}
