import { useRef, useState } from 'react'
import { isComplexOrder } from '../../content/production'
import { hasCompletedSurfaceFinish } from '../../domain/shift-engine'
import type { CustomerOrder, MachineId, PrintAuthorization, PrintTask, ShiftRun } from '../../domain/shift-types'
import { ProductionCard } from '../ProductionCard'
import { PuzzlePanel } from '../PuzzlePanel'
import { formatShiftTime } from '../ShiftHud'
import { EmptyStation, useStationAudio, useStationDraft } from './station-shared'
import '../../styles/printers.css'

const MACHINE_NAMES: Record<MachineId, string> = { quick: '快印机', fine: '精印机' }
type MachineChoice = Readonly<{ label: string; reason: string; disabled: boolean }>

function machineChoice(run: ShiftRun, order: CustomerOrder | null, snapshotId: string | null, authorization: PrintAuthorization | undefined, machineId: MachineId, nowMs: number): MachineChoice {
  const name = MACHINE_NAMES[machineId]
  const unavailable = (label: string, reason: string): MachineChoice => ({ label, reason, disabled: true })
  if (run.status !== 'running') return unavailable('暂不能冲印', run.status === 'paused' ? '教学与故事时间，所有工作计时已暂停。' : '本班已打烊，已安排的卡片会继续冲印。')
  if (!order) return unavailable('确认冲印', '请先选择一位仍在等候的客人的订单。')
  if (!snapshotId) return unavailable('确认冲印', '请先收入 StampBook，再选择机器确认冲印。')
  if (authorization?.status === 'calibrated_pending_start') return unavailable('等待冲印确认', `校准已经通过，${MACHINE_NAMES[authorization.machineId]}的原机位仍为这张卡保留。`)
  if (authorization?.status === 'bound') return unavailable('已安排冲印', `这张卡已交给${MACHINE_NAMES[authorization.machineId]}，请在成品架取卡后亲手交付。`)
  if (authorization?.status === 'rejected') return unavailable('本次未能安排冲印', '冲印室未能接下这张卡，机位已经释放，作品仍在卡册中。')
  if (authorization?.status === 'expired_unprinted') return unavailable('本次冲印已结束', '这次未完成校准，作品仍在卡册中。')
  if (authorization?.status === 'calibrating') return unavailable('正在校准', authorization.machineId === machineId
    ? '已为这道校准预留一个机位，请在倒计时内完成。'
    : '请先退出当前校准，再换机。退出会让原机器对本单锁定 30 秒。')
  const printer = run.printers[machineId]
  const lockedMs = (printer.orderLockUntilMs[order.id] ?? 0) - nowMs
  if (lockedMs > 0) return unavailable('本单稍候', `本单还需等待 ${Math.ceil(lockedMs / 1000)} 秒；这台机器仍能服务其他订单。`)
  const occupied = Number(Boolean(printer.currentTaskId)) + printer.queuedTaskIds.length + printer.reservations.length
  if (occupied >= 3) return unavailable('暂时排满', '3 个机位均已占用，等一张卡冲印完成或校准机位释放后再来。')
  if (authorization?.status === 'confirmed' && authorization.nextAttempt === 1 && authorization.machineId !== machineId) return unavailable('已选另一台机器', `这张卡已确认使用${MACHINE_NAMES[authorization.machineId]}，请先在原机开始校准。`)
  const label = authorization?.status === 'failed' || authorization?.status === 'confirmed' && authorization.nextAttempt > 1 ? authorization.machineId === machineId ? '重新校准' : `改用${name}校准`
    : authorization?.status === 'confirmed' ? '开始校准' : '确认冲印'
  return { label, reason: '确认后立即开始限时校准，占用一个机位；营业与耐心计时照常前进。', disabled: false }
}

function expediteReason(run: ShiftRun, task: PrintTask, order: CustomerOrder | undefined): string | null {
  if (run.status !== 'running') return '当前不能安排加急。'
  if (!order || order.outcome.status !== 'pending') return '客人已经离店，成品会继续留在店里。'
  if (task.expedited) return '这张卡已经加急过了。'
  if (order.remedy !== 'none') return `${order.content.customer.name}已经接受过一次补救。`
  if (!run.remedies.expediteAvailable) return '本班的加急冲印已经用完。'
  if (run.authorizations[task.intentId]?.status !== 'bound') return '请等待冲印室确认接下这张卡。'
  return null
}

function TaskSlip({ task, estimatedReadyAtMs, run, nowMs, onExpedite, queuePosition, queueLength, onMove }: { task: PrintTask; estimatedReadyAtMs: number; run: ShiftRun; nowMs: number; onExpedite: () => void; queuePosition?: number; queueLength?: number; onMove?: (offset: -1 | 1) => void }) {
  const order = run.orders.find(item => item.id === task.orderId)
  const name = order?.content.customer.name ?? '客人'
  const reason = expediteReason(run, task, order)
  return <article className={`production-printer-task${task.status === 'printing' ? ' is-printing' : ''}`}>
    <div><strong>{task.status === 'printing' ? '▣ 正在冲印' : '◷ 排队中'} · {name}</strong><span>{order?.content.title ?? '珍藏卡片'}</span></div>
    <p>{task.status === 'printing' ? '剩余' : '预计出片'} {formatShiftTime((estimatedReadyAtMs - nowMs) / 1000)}{task.expedited && ' · 已加急'}</p>
    {task.status === 'printing' && <progress aria-label={`${name}的冲印进度`} value={Math.max(0, nowMs - task.startedAtMs)} max={Math.max(1, task.completesAtMs - task.startedAtMs)} />}
    <button className="station-text-button" disabled={reason !== null} onClick={onExpedite}>加急冲印 · {name}</button>
    <small>{reason ?? (task.status === 'queued' ? '提到本机队首，工时减半；正在冲印的卡片会先完成。' : '将剩余冲印工时减半。')}</small>
    {task.status === 'queued' && onMove && queuePosition !== undefined && <div className="production-printer-queue-order" aria-label={`${name}的排队顺序`}>
      <button className="station-text-button" aria-label={`${name}的冲印单上移`} disabled={run.status !== 'running' || queuePosition === 0} onClick={() => onMove(-1)}>↑ 上移</button>
      <button className="station-text-button" aria-label={`${name}的冲印单下移`} disabled={run.status !== 'running' || queuePosition === (queueLength ?? 0) - 1} onClick={() => onMove(1)}>↓ 下移</button>
    </div>}
  </article>
}

function PrinterMachine({ machineId, run, order, snapshotId, authorization, nowMs, busy, onConfirm, onExpedite, onReorder }: {
  machineId: MachineId; run: ShiftRun; order: CustomerOrder | null; snapshotId: string | null; authorization: PrintAuthorization | undefined
  nowMs: number; busy: boolean; onConfirm: () => void; onExpedite: (taskId: string) => void; onReorder: (taskIds: readonly string[]) => void
}) {
  const machine = run.printers[machineId]
  const current = machine.currentTaskId ? run.tasks[machine.currentTaskId] : undefined
  const complex = order ? isComplexOrder(order.content) : false
  const seconds = machineId === 'quick' ? complex ? 60 : 45 : complex ? 85 : 65
  const choice = machineChoice(run, order, snapshotId, authorization, machineId, nowMs)
  const occupied = Number(Boolean(current)) + machine.queuedTaskIds.length + machine.reservations.length
  let readyAtMs = current?.status === 'printing' ? current.completesAtMs : nowMs
  const queue = machine.queuedTaskIds.flatMap(id => {
    const task = run.tasks[id]
    if (!task) return []
    readyAtMs += task.durationMs
    return [{ task, readyAtMs }]
  })
  return <section className={`production-printer-machine production-printer-${machineId}`} aria-label={MACHINE_NAMES[machineId]}>
    <header><span className="production-printer-emblem" aria-hidden="true">{machineId === 'quick' ? 'ϟ' : '✦'}</span><div><small>{machineId === 'quick' ? '轻快出片 · 反应校准' : '细腻呈现 · 逻辑校准'}</small><h3>{MACHINE_NAMES[machineId]}</h3></div><b>{occupied} / 3</b></header>
    <p className="production-printer-capacity">容量：1 正在冲印 + 2 排队或校准</p>
    <div className="production-printer-slots" aria-label={`${MACHINE_NAMES[machineId]}机位占用`}>{Array.from({ length: 3 }, (_, index) => <span key={index} className={index < occupied ? 'is-occupied' : ''}>{index < occupied ? '●' : '○'}</span>)}<small>排队 {machine.queuedTaskIds.length} · 预留 {machine.reservations.length}</small></div>
    <p className="production-printer-duration">{order ? `本单${complex ? '复杂卡' : '普通卡'} · 冲印 ${seconds} 秒` : `普通卡 ${seconds} 秒 · 复杂卡 ${machineId === 'quick' ? 60 : 85} 秒`}</p>
    <p className={machineId === 'quick' && complex ? 'production-printer-quality station-warning' : 'production-printer-quality'}>{machineId === 'quick' && complex ? '精细效果会有损失：机器品质固定扣 6 分。' : machineId === 'fine' ? '保留完整精细效果，机器品质不扣分。' : '普通卡与精印机的机器品质得分相同。'}</p>
    <button className="station-primary" disabled={choice.disabled || busy} onClick={onConfirm}>{choice.label}</button>
    <p className="production-printer-choice-reason">{choice.reason}</p>
    <div className="production-printer-worklist">
      {current?.status === 'printing' ? <TaskSlip task={current} estimatedReadyAtMs={current.completesAtMs} run={run} nowMs={nowMs} onExpedite={() => onExpedite(current.id)} /> : <p className="production-printer-idle">○ 印台空闲</p>}
      {queue.map(({ task, readyAtMs: estimate }, index) => <TaskSlip key={task.id} task={task} estimatedReadyAtMs={estimate} run={run} nowMs={nowMs} onExpedite={() => onExpedite(task.id)} queuePosition={index} queueLength={queue.length} onMove={offset => {
        const next = index + offset
        if (next < 0 || next >= queue.length) return
        const ids = [...machine.queuedTaskIds]
        ;[ids[index], ids[next]] = [ids[next], ids[index]]
        onReorder(ids)
      }} />)}
      {machine.reservations.map(reservation => <p className="production-printer-reservation" key={reservation.id}><strong>{run.orders.find(item => item.id === reservation.orderId)?.content.customer.name ?? '客人'}</strong> · {reservation.status === 'calibrating' ? '校准中 · 已预留机位' : '校准通过 · 等待冲印确认'}</p>)}
    </div>
    <p className="production-printer-eta">已排定工作预计 {formatShiftTime((readyAtMs - nowMs) / 1000)} 后腾空。{machine.reservations.length > 0 ? '预留中的作品尚未计入，实际等候时间以入队后为准。' : '校准时间另计。'}</p>
  </section>
}

export function PrintStation() {
  const { draft, run, selectedOrder, dispatch, revealPuzzle, displayNowMs } = useStationDraft()
  useStationAudio(run, draft)
  const working = useRef(false)
  const [busy, setBusy] = useState(false)
  const puzzleAction = (work: () => Promise<void>) => {
    if (working.current) return
    working.current = true
    setBusy(true)
    void work().finally(() => { working.current = false; setBusy(false) })
  }
  const [explainOrderId, setExplainOrderId] = useState<string | null>(null)
  if (!run) return null
  const pendingAuthorization = Object.values(run.authorizations).find(item => item.orderId === selectedOrder?.id && item.status === 'calibrating')
  const snapshotId = pendingAuthorization?.snapshotId ?? (draft?.stage === 'archived' ? draft.snapshotId : null)
  const authorization = pendingAuthorization ?? Object.values(run.authorizations).find(item => item.snapshotId === snapshotId)
  const puzzle = authorization?.status === 'calibrating' ? run.puzzles[authorization.puzzleId] : undefined
  const failedPuzzle = authorization?.status === 'failed' ? run.puzzles[authorization.puzzleId] : undefined
  const unfinished = !draft || (draft.stage !== 'crafting' && draft.stage !== 'archived') || (draft.stage === 'crafting' && draft.activeCraft !== null)
  const unconsumed = draft?.reservationIds.some(id => run.materials.reservations[id]?.status === 'reserved') ?? false
  const finishIncomplete = draft ? !hasCompletedSurfaceFinish(run, draft) : false
  const print = async (machineId: MachineId) => {
    if (!snapshotId || working.current || machineChoice(run, selectedOrder, snapshotId, authorization, machineId, displayNowMs).disabled) return
    working.current = true
    setBusy(true)
    try {
      // Identity belongs to the immutable saved version, and survives reopens and repeat clicks.
      const intentId = authorization?.id ?? `shift-print:${JSON.stringify([run.id, snapshotId])}`
      if (!authorization) await dispatch({ station: 'print', type: 'confirm-print', snapshotId, intentId, machineId })
      await dispatch({ station: 'print', type: 'begin-calibration', intentId, machineId })
    } finally { working.current = false; setBusy(false) }
  }
  const explainOrders = run.orders.filter(order => order.arrivalAtMs <= displayNowMs && order.outcome.status === 'pending')
  const explainOrder = explainOrders.find(order => order.id === explainOrderId)
    ?? explainOrders.find(order => order.id === selectedOrder?.id) ?? explainOrders[0]
  const explainReason = !explainOrder ? '目前没有仍在等候的客人。' : run.status !== 'running' ? '当前不能说明进度。'
    : explainOrder.remedy !== 'none' ? '这位客人已经接受过一次补救。' : !run.remedies.explainProgressAvailable ? '本班的说明进度已经用完。' : null
  const rack = (status: 'ready' | 'unclaimed') => Object.values(run.tasks).filter(task => task.status === status)
  return <div className="station-stack production-print-station">
    {draft && selectedOrder ? <div className="production-print-archive">
      <div className="production-print-card-preview"><ProductionCard design={snapshotId ? run.snapshots[snapshotId].design : draft.design} /></div>
      <div><small>先把此刻的心意收好</small><h3>{selectedOrder.content.customer.name}的卡片</h3>
        <p>收入卡册会保存这一版作品。选好机器后，还要另行确认冲印。</p>
        <button data-sound="none" className="station-secondary" disabled={unfinished || unconsumed || finishIncomplete || draft.stage === 'archived' || busy || Boolean(puzzle) || run.status !== 'running'} onClick={() => { void dispatch({ station: 'print', type: 'archive', draftId: draft.id, snapshotId: `${draft.id}:card:${draft.revision}` }) }}>{draft.stage === 'archived' ? '已收入 StampBook' : '收入 StampBook'}</button>
        {(unfinished || unconsumed) && <p className="station-warning">请先裁好卡胚、固定组装，并收好手上正在做的工艺。</p>}
        {finishIncomplete && <p className="station-warning">请先到工艺台完成所选表面工艺。</p>}
      </div>
    </div> : <EmptyStation />}
    {failedPuzzle?.result.status === 'failed' && <p className="production-printer-feedback is-failure" role="status">{failedPuzzle.result.reason === 'timeout' ? '校准超时' : failedPuzzle.result.reason === 'exit' ? '已退出校准' : '校准未通过'}。机位已释放，{MACHINE_NAMES[failedPuzzle.machineId]}对本单暂时锁定 30 秒；可尝试另一台有空位的机器。</p>}
    {authorization?.status === 'calibrated_pending_start' && <p className="production-printer-feedback" role="status">校准已通过，正在等待冲印确认。原机位已保留，无需再次答题；确认送达后才进入机器队列。</p>}
    {puzzle && <PuzzlePanel key={puzzle.id} puzzle={puzzle} nowMs={displayNowMs} disabled={run.status !== 'running' || busy}
      onSubmit={answer => puzzleAction(() => dispatch({ station: 'print', type: 'submit-puzzle', puzzleId: puzzle.id, answer }))}
      onReveal={index => puzzleAction(() => revealPuzzle(puzzle.id, index))}
      onExit={() => puzzleAction(() => dispatch({ station: 'print', type: 'exit-puzzle', puzzleId: puzzle.id }))} />}
    <div className="production-printer-pair">{(['quick', 'fine'] as const).map(machineId => <PrinterMachine key={machineId} machineId={machineId} run={run} order={selectedOrder} snapshotId={snapshotId} authorization={authorization} nowMs={displayNowMs} busy={busy} onConfirm={() => { void print(machineId) }} onExpedite={taskId => { void dispatch({ station: 'print', type: 'expedite', taskId }) }} onReorder={taskIds => { void dispatch({ station: 'print', type: 'reorder-queue', machineId, taskIds }) }} />)}</div>
    <section className="production-printer-remedy" aria-label="说明进度"><div><h3>☕ 和客人说一声</h3><p>本班可为任意已到店且订单尚未完成的客人说明一次进度，将当前等候延长 25 秒。每位客人最多接受一种补救。</p></div><div className="station-stack"><label className="station-label">说明对象<select aria-label="选择说明进度的客人" value={explainOrder?.id ?? ''} disabled={run.status !== 'running' || explainOrders.length === 0} onChange={event => setExplainOrderId(event.target.value)}>{explainOrders.length === 0 && <option value="">暂无等候客人</option>}{explainOrders.map(order => <option key={order.id} value={order.id}>{order.content.customer.name} · {order.position === 'door_waiting' ? '门口等候' : '制作与冲印中'}</option>)}</select></label><button className="station-secondary" disabled={explainReason !== null} onClick={() => { if (explainOrder) void dispatch({ station: 'reception', type: 'explain-progress', orderId: explainOrder.id }) }}>说明进度{explainOrder ? ` · ${explainOrder.content.customer.name}` : ''}</button></div>{explainReason && <small>{explainReason}</small>}</section>
    <div className="production-printer-racks">{(['ready', 'unclaimed'] as const).map(status => <section key={status} className={`production-printer-rack production-rack-${status}`} aria-label={status === 'ready' ? '待交付成品' : '无人领取'}><h3>{status === 'ready' ? '◇ 待交付成品' : '☾ 无人领取'}</h3>{rack(status).length === 0 && <p>{status === 'ready' ? '出片后会放在这里。记得亲手交给客人。' : '客人离店后的成品，会替你留在这里。'}</p>}{rack(status).map(task => {
      const customer = run.orders.find(order => order.id === task.orderId)
      return <article key={task.id}><strong>{customer?.content.customer.name ?? '客人'} · {MACHINE_NAMES[task.machineId]}</strong><span>{customer?.content.title ?? '珍藏卡片'}</span>{status === 'ready' ? <button data-sound="none" className="station-primary" disabled={run.status !== 'running' || customer?.outcome.status !== 'pending'} onClick={() => { void dispatch({ station: 'print', type: 'deliver', taskId: task.id }) }}>亲手交给{customer?.content.customer.name ?? '客人'}</button> : <small>客人已不在等候，这张作品保留在店里。</small>}</article>
    })}</section>)}</div>
  </div>
}
