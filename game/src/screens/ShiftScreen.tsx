import { useEffect, type PropsWithChildren } from 'react'
import { useShift } from '../app/ShiftProvider'
import { useAudio } from '../app/AudioProvider'
import { CustomerRail } from '../components/CustomerRail'
import { OrderTickets } from '../components/OrderTickets'
import { ShiftHud, ShiftResources } from '../components/ShiftHud'
import { ShiftChatter } from '../components/ShiftChatter'
import { ShiftSoundFeedback } from '../components/ShiftSoundFeedback'
import { OrderStation } from '../components/stations/OrderStation'
import { PrepStation } from '../components/stations/PrepStation'
import { AssemblyStation } from '../components/stations/AssemblyStation'
import { CraftStation } from '../components/stations/CraftStation'
import { InspectionStation } from '../components/stations/InspectionStation'
import { PrintStation } from '../components/stations/PrintStation'
import type { StationId } from '../domain/shift-types'
import '../styles/shift.css'
import '../styles/stations.css'
import '../styles/shift-v2.css'

export const SHIFT_STATIONS: readonly { id: StationId; label: string; icon: string }[] = [
  { id: 'reception', label: '接单台', icon: '♧' }, { id: 'preparation', label: '备料台', icon: '▤' },
  { id: 'assembly', label: '组装台', icon: '✂' }, { id: 'craft', label: '工艺台', icon: '✦' },
  { id: 'inspection', label: '检查台', icon: '⌕' }, { id: 'print', label: '冲印台', icon: '▣' },
]
const STATION_COMPONENTS = { reception: OrderStation, preparation: PrepStation, assembly: AssemblyStation, craft: CraftStation, inspection: InspectionStation, print: PrintStation }
export function ShiftScreen({ children }: PropsWithChildren) {
  const { playSfx } = useAudio()
  const { run, status, station, selectedOrder, dispatch, error, notice, displayNowMs } = useShift()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing || run?.status !== 'running') return
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable || target.closest('[contenteditable="true"]'))) return
      const next = SHIFT_STATIONS[Number(event.key) - 1]
      if (next) {
        event.preventDefault()
        if (run.station !== next.id) playSfx('ui_click')
        void dispatch({ type: 'switch-station', station: next.id })
        return
      }
      const index = ['q', 'w', 'e'].indexOf(event.key.toLowerCase())
      const orderId = run.activeOrderIds[index]
      if (orderId) { event.preventDefault(); if (run.selectedOrderId !== orderId) playSfx('ui_click'); void dispatch({ type: 'select-order', orderId }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, run, playSfx])
  if (status === 'loading') return <main className="shift-loading" aria-busy="true"><p role="status">正在翻开营业记录……</p></main>
  if (!run) return <main className="shift-loading"><p role="alert">{error ?? '暂时无法打开营业记录，请回到店门后再试。'}</p></main>
  const selectedStation = SHIFT_STATIONS.find(item => item.id === station)!
  const Station = STATION_COMPONENTS[station]
  return <div className="shift-shell">
    <ShiftHud />
    <ShiftSoundFeedback key={`sound:${run.id}`} run={run} />
    <div className="shift-notices">
      {error && <p className="shift-notice shift-error" role="alert">{error}</p>}
      {notice && <p className="shift-notice" role="status">{notice}</p>}
      {run.status === 'settled' && <p className="shift-notice" role="status">本班已打烊，正在整理今天的营业成绩。</p>}
      {run.status === 'paused' && <p className="shift-notice" role="status">Ⅱ 教学与故事时间，所有工作计时已暂停。</p>}
    </div>
    <div className="shift-floor">
      <CustomerRail />
      <main className="shift-workspace" aria-label="制卡工作台">
        <nav className="shift-station-tabs" aria-label="工作台切换">{SHIFT_STATIONS.map((item, index) => <button key={item.id} disabled={run.status !== 'running'} aria-pressed={station === item.id} onClick={() => { void dispatch({ type: 'switch-station', station: item.id }) }}><i aria-hidden="true">{item.icon}</i><span>{index + 1} {item.label}</span></button>)}</nav>
        <section className="shift-workspace-content" aria-label={selectedStation.label}>
          <div className="shift-workspace-heading"><div><small>今日制卡工作</small><h2>{selectedStation.icon} {selectedStation.label}</h2></div><span>{selectedOrder ? `当前订单：${selectedOrder.content.customer.name} · ${selectedOrder.content.title}` : '当前尚未选择订单'}</span></div>
          {children ?? <Station key={`${station}:${selectedOrder?.id ?? 'none'}`} />}
        </section>
        <ShiftChatter key={`chatter:${run.id}`} run={run} nowMs={displayNowMs} />
      </main>
      <div className="shift-side">
        <OrderTickets />
        <ShiftResources />
      </div>
    </div>
  </div>
}
