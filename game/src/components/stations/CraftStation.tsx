import { useRef, useState, type CSSProperties } from 'react'
import { useAudio } from '../../app/AudioProvider'
import { SURFACE_FINISHES } from '../../content/production'
import { ownValue } from '../../domain/own-value'
import type { ActiveCraftOperation, CraftDimension, CraftMeasurements, CraftProgress, CraftRequirement, MaterialCost, ProductionDraft } from '../../domain/shift-types'
import { ProductionCard } from '../ProductionCard'
import { CRAFT_NAMES, DIMENSION_NAMES, DISCRETE_NAMES, EmptyStation, StationNext, costLabel, useStationAudio, useStationDraft } from './station-shared'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const rounded = (value: number) => Math.round(value * 1000) / 1000
function Meter({ value, target, label }: { value: number; target?: { min: number; max: number }; label: string }) {
  return <div className="craft-meter-wrap"><div className="craft-meter-caption"><span>{label}</span><strong>{Math.round(value * 100)}</strong></div><div className="craft-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>{target && <span className="craft-meter-target" style={{ left: `${target.min * 100}%`, width: `${(target.max - target.min) * 100}%` }} />}<i style={{ left: `${clamp(value) * 100}%` }} /></div><small>{target ? `绿色目标区 ${Math.round(target.min * 100)}–${Math.round(target.max * 100)}` : '沿刻度调整'}</small></div>
}
function Slider({ label, value, onChange, disabled = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <label className="craft-slider"><span>{label}<strong>{Math.round(value * 100)}</strong></span><input aria-label={label} type="range" min="0" max="100" step="1" value={Math.round(value * 100)} disabled={disabled} onChange={event => onChange(Number(event.target.value) / 100)} /></label>
}
function TargetNote({ requirement }: { requirement: CraftRequirement }) {
  return <div className="craft-target-note"><strong>本次要求</strong><p>{Object.entries(requirement.targets).map(([key, target]) => `${DIMENSION_NAMES[key as CraftDimension]} ${Math.round(target.min * 100)}–${Math.round(target.max * 100)}`).join(' · ')}{Object.values(requirement.discrete).map(value => ` · ${ownValue(DISCRETE_NAMES, value) ?? '指定款式'}`)}</p><small>落在绿色区内最稳妥。越过边缘越远，成品越容易失误；颜色与图案也要符合订单。</small></div>
}
function craftCosts(requirement: CraftRequirement, finishId: string): readonly MaterialCost[] {
  const finish = SURFACE_FINISHES.find(item => item.id === finishId)!
  const matching = finish.id === 'foil' ? 'foil' : finish.id === 'wax' ? 'wax' : 'stamp'
  return requirement.kind === matching ? [...requirement.materialCosts, ...finish.materialCosts.filter(cost => !requirement.materialCosts.some(existing => existing.materialId === cost.materialId))] : requirement.materialCosts
}
function craftRequirements(draft: ProductionDraft, required: readonly CraftRequirement[]): readonly CraftRequirement[] {
  const finish = SURFACE_FINISHES.find(item => item.id === draft.design.preparation.surfaceFinishId)!
  if (!finish.materialCosts.length) return required
  const kind = finish.id === 'foil' ? 'foil' : finish.id === 'wax' ? 'wax' : 'stamp'
  if (required.some(item => item.kind === kind)) return required
  return [...required, { id: 'surface-finish', kind, label: `${finish.label}表面`, targets: kind === 'foil' ? { coverage: { min: .85, max: 1 } } : { position: { min: .45, max: .55 }, [kind === 'wax' ? 'time' : 'pressure']: { min: .4, max: .6 } }, discrete: {}, materialCosts: finish.materialCosts }]
}

export function CraftStation() {
  const { draft, run, selectedOrder, dispatch } = useStationDraft()
  useStationAudio(run, draft)
  if (!draft || !run || !selectedOrder) return <EmptyStation />
  if (draft.stage === 'not_started' || draft.stage === 'preparing' || draft.stage === 'assembling') return <div className="station-empty"><h3>先让卡片上的素材安稳就位</h3><p>在组装台亲手固定组装后，就能开始手工制作。</p><StationNext station="assembly">去固定组装</StationNext></div>
  const requirements = craftRequirements(draft, selectedOrder.content.requirements.crafts)
  const active = draft.stage === 'crafting' ? draft.activeCraft : null
  const requirement = requirements.find(item => item.id === active?.requirementId)
  return <div className="station-stack"><p className="station-intro">先读目标，再动手。第一次落章、落刀、固定缎带、接触烫金面或倒蜡就会用掉材料；放弃与重做都不会退回。</p><div className="station-craft-layout"><div className="station-craft-work">
    {active && requirement ? <CraftSession key={active.operationId} draft={draft} operation={active} requirement={requirement} /> : <div className="craft-menu">{requirements.map(item => {
      const done = draft.design.crafts.some(craft => craft.requirementId === item.id)
      const costs = craftCosts(item, draft.design.preparation.surfaceFinishId)
      const available = costs.every(cost => run.materials.stock[cost.materialId].available >= cost.quantity)
      return <article key={item.id} className="craft-menu-item"><h3>{item.id === 'surface-finish' ? item.label : CRAFT_NAMES[item.kind]} {done && <span>✓ 已做过</span>}</h3><TargetNote requirement={item} /><p>每次{done ? '重做' : '制作'}：{costLabel(costs)}</p><button className="station-primary" disabled={!available || run.status !== 'running'} onClick={() => { void dispatch({ station: 'craft', type: 'select-craft', draftId: draft.id, craftId: item.id, operationId: `${draft.id}:craft:${draft.revision + 1}:${item.id}`, discrete: {} }) }}>{done ? `重做${CRAFT_NAMES[item.kind]}` : `准备${CRAFT_NAMES[item.kind]}`}</button>{!available && <p className="station-warning">材料已用完，暂时无法开始这一项工艺。</p>}</article>
    })}{!requirements.length && <div className="station-note"><h3>这张卡保留纸张本来的模样</h3><p>订单没有额外手工要求，可以对照检查，或直接去卡册。</p></div>}</div>}
  </div><aside className="station-craft-preview"><ProductionCard design={draft.design} /><p>每次收好工艺后，效果会留在卡片上。</p></aside></div>{!active && <div className="station-actions"><StationNext station="inspection">去检查</StationNext><StationNext station="print">去卡册与冲印台</StationNext></div>}</div>
}

function CraftSession({ draft, operation, requirement }: { draft: ProductionDraft; operation: ActiveCraftOperation; requirement: CraftRequirement }) {
  const { dispatch, displayNowMs, run } = useStationDraft()
  const { playSfx } = useAudio()
  const lastBrushAt = useRef(-Infinity)
  const [position, setPosition] = useState(operation.progress.measurements.position ?? .15)
  const [length, setLength] = useState(operation.progress.measurements.length ?? .3)
  const savedChoice = (key: string, fallback: string) => operation.progress.completedSteps.find(step => step.startsWith(`${key}:`))?.slice(key.length + 1) ?? operation.discrete[key] ?? fallback
  const [color, setColor] = useState(() => savedChoice('color', 'cream'))
  const [seal, setSeal] = useState(() => savedChoice('stamp', 'rabbit'))
  const [start, setStart] = useState(operation.progress.trace[0]?.x ?? .05)
  const [end, setEnd] = useState(operation.progress.trace[1]?.x ?? .7)
  const [rulerStartedAt, setRulerStartedAt] = useState<number | null>(null)
  const progress = useRef<CraftProgress>(operation.progress)
  const started = useRef(operation.status === 'in_progress')
  const startedAt = useRef(operation.status === 'in_progress' ? operation.startedAtMs : null)
  const finished = useRef(false)
  const [localProgress, setLocalProgress] = useState<CraftProgress>(operation.progress)
  const [holding, setHolding] = useState(operation.status === 'in_progress' && (operation.kind === 'stamp' || operation.kind === 'wax'))
  const isRunning = run?.status === 'running'
  const elapsedSince = (startTime: number) => Math.max(0, displayNowMs - startTime - (run?.pauses ?? []).reduce((total, pause) => total + Math.max(0, Math.min(displayNowMs, pause.endedAtMs) - Math.max(startTime, pause.startedAtMs)), 0))
  const begin = () => {
    if (!isRunning || finished.current) return
    if (!started.current) {
      started.current = true; startedAt.current = displayNowMs
      void dispatch({ station: 'craft', type: 'begin-craft', draftId: draft.id, craftId: requirement.id })
    }
  }
  const update = (next: CraftProgress) => {
    progress.current = next; setLocalProgress(next)
    void dispatch({ station: 'craft', type: 'update-craft', draftId: draft.id, craftId: requirement.id, progress: next })
  }
  const finish = (measurements: CraftMeasurements, discrete: Record<string, string> = {}, sound = true) => {
    if (!isRunning || finished.current || !started.current) return
    finished.current = true; setHolding(false)
    void dispatch({ station: 'craft', type: 'finish-craft', draftId: draft.id, craftId: requirement.id, measurements, discrete })
    if (sound && (operation.kind === 'stamp' || operation.kind === 'wax')) playSfx('stamp_lift')
  }
  const holdStart = () => {
    if (!isRunning || finished.current || holding) return
    begin(); setHolding(true)
    update({ ...progress.current, measurements: { position }, completedSteps: ['pressed', `color:${color}`, `stamp:${seal}`] })
    playSfx(operation.kind === 'wax' ? 'wax_pour' : 'stamp_press')
  }
  const holdFinish = (sound = true) => {
    if (startedAt.current === null || finished.current) return
    const amount = rounded(clamp(elapsedSince(startedAt.current) / 2000))
    finish({ position: progress.current.measurements.position ?? position, [operation.kind === 'wax' ? 'time' : 'pressure']: amount }, operation.kind === 'wax' ? { color, stamp: seal } : {}, sound)
  }
  const pressure = startedAt.current === null ? 0 : clamp(elapsedSince(startedAt.current) / 2000)
  const ruler = rulerStartedAt === null ? 0 : 1 - Math.abs((elapsedSince(rulerStartedAt) / 2000) % 2 - 1)
  const ribbonStarted = localProgress.completedSteps.includes('left-end')
  const colorControl = (label: string) => <label className="station-label">{label}<select aria-label={label} value={color} disabled={started.current} onChange={event => setColor(event.target.value)}>{['cream', 'blue', 'pink', 'red'].map(value => <option key={value} value={value}>{DISCRETE_NAMES[value]}</option>)}</select></label>
  const foilTarget = (cell: number) => cell % 6 > 0 && cell % 6 < 5 && Math.floor(cell / 6) > 0 && Math.floor(cell / 6) < 5
  const foilMeasures = (value: CraftProgress) => {
    const covered = value.coverageCells.filter(foilTarget).length / 16
    const overflow = value.coverageCells.filter(cell => !foilTarget(cell)).length / 20
    const overheated = Math.max(0, value.trace.length - value.coverageCells.length)
    return { coverage: rounded(clamp(covered - overflow - overheated / 64)), covered, overflow, overheated }
  }
  const brush = (cell: number) => {
    if (!isRunning || finished.current) return
    begin()
    const cells = [...new Set([...progress.current.coverageCells, cell])]
    const next: CraftProgress = { ...progress.current, coverageCells: cells, trace: [...progress.current.trace, { x: cell % 6, y: Math.floor(cell / 6) }], completedSteps: ['contacted'] }
    const now = performance.now()
    if (!progress.current.coverageCells.includes(cell) && now - lastBrushAt.current >= 140) {
      playSfx('foil_brush')
      lastBrushAt.current = now
    }
    update({ ...next, measurements: { coverage: foilMeasures(next).coverage } })
  }
  const foil = foilMeasures(localProgress)
  return <div className={`craft-session craft-session-${operation.kind}`}><h3>{requirement.id === 'surface-finish' ? requirement.label : CRAFT_NAMES[operation.kind]}</h3><TargetNote requirement={requirement} />
    {(operation.kind === 'stamp' || operation.kind === 'wax') && <>
      {operation.kind === 'wax' && <div className="station-control-row">{colorControl('蜡封颜色')}<label className="station-label">蜡封图案<select aria-label="蜡封图案" value={seal} disabled={started.current} onChange={event => setSeal(event.target.value)}>{['rabbit', 'star', 'flower'].map(value => <option key={value} value={value}>{DISCRETE_NAMES[value]}</option>)}</select></label></div>}
      <Slider label={operation.kind === 'stamp' ? '落章位置' : '蜡封位置'} value={position} onChange={setPosition} disabled={started.current} />
      <div className="craft-position-stage" aria-hidden="true"><span className="craft-position-target" style={{ left: `${(requirement.targets.position?.min ?? .45) * 100}%`, width: `${((requirement.targets.position?.max ?? .55) - (requirement.targets.position?.min ?? .45)) * 100}%` }} /><span className={`craft-position-tool ${holding ? 'is-pressed' : ''}`} style={{ left: `${position * 100}%` }}>{operation.kind === 'wax' ? '✦' : '♧'}</span></div>
      <Meter label={operation.kind === 'wax' ? '按压时间' : '盖章压力'} value={pressure} target={requirement.targets[operation.kind === 'wax' ? 'time' : 'pressure']} />
      <button data-sound="none" className="station-primary craft-hold" disabled={!isRunning} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); holdStart() }} onPointerUp={() => holdFinish()} onPointerCancel={() => holdFinish(false)} onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); holdStart() } }} onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); holdFinish() } }} onClick={event => { if (event.detail === 0) { if (holding) holdFinish(); else holdStart() } }}>{holding ? '松开印章' : operation.kind === 'wax' ? '倒蜡并按章' : '按住盖章'}</button><p className="craft-help">按住鼠标或空格，刻度进入绿色区时松开。完整刻度为 2 秒；太早或太晚都会留下不同效果。</p>
    </>}
    {operation.kind === 'trim' && <><Slider label="裁边线位置" value={position} onChange={setPosition} /><div className="craft-trim-sheet" style={{ '--cut-line': `${position * 100}%` } as CSSProperties}><span>✂</span><i /></div><Meter label="移动裁边尺" value={ruler} target={requirement.targets.length} />{rulerStartedAt === null ? <button className="station-secondary" onClick={() => setRulerStartedAt(displayNowMs)}>启动裁边尺</button> : <button data-sound="none" className="station-primary" onClick={() => { begin(); finish({ position, length: rounded(ruler) }) }}>落刀裁边</button>}<p className="craft-help">先对齐裁边线，再等移动刻度进入目标区落刀。尺子来回移动，落刀只有一次。</p></>}
    {operation.kind === 'ribbon' && <>{colorControl('缎带颜色')}<Slider label="缎带长度" value={length} onChange={setLength} disabled={ribbonStarted} /><div className={`craft-ribbon-stage ribbon-${color}`}><span style={{ left: `${start * 100}%`, width: `${Math.max(0, end - start) * 100}%` }} /><i className={ribbonStarted ? 'is-fixed' : ''} style={{ left: `${start * 100}%` }}>●</i><i style={{ left: `${end * 100}%` }}>○</i><b style={{ left: '15%' }}>┆</b><b style={{ left: '85%' }}>┆</b></div><p className="craft-help">两条竖线是缎带落点：左端 15，右端 85。每端偏离都会影响位置刻度。</p><Slider label="左端位置" value={start} onChange={setStart} disabled={ribbonStarted} /><Slider label="右端位置" value={end} onChange={setEnd} disabled={!ribbonStarted} />{!ribbonStarted ? <button data-sound="none" className="station-primary" onClick={() => { if (!isRunning || finished.current) return; begin(); update({ ...progress.current, completedSteps: ['left-end', `color:${color}`], measurements: { length }, trace: [{ x: start, y: .5 }] }) }}>固定左端</button> : <button data-sound="none" className="station-primary" onClick={() => finish({ length: progress.current.measurements.length ?? length, position: rounded(clamp(.5 + Math.max(Math.abs(start - .15), Math.abs(end - .85)))) }, { color, startPosition: String(start), endPosition: String(end) })}>固定右端并收好</button>}</>}
    {operation.kind === 'foil' && <><p className="craft-help">按住并扫过中间的 16 格金色区域，也可以逐格点击或用键盘选格。重复接触会过热，扫到外圈会越界。</p><div className="craft-foil-grid" aria-label="烫金工作面">{Array.from({ length: 36 }, (_, cell) => <button data-sound="none" key={cell} aria-label={`烫金第${cell + 1}格 ${foilTarget(cell) ? '目标区' : '边缘'}`} aria-pressed={localProgress.coverageCells.includes(cell)} className={`${foilTarget(cell) ? 'foil-target' : 'foil-edge'} ${localProgress.coverageCells.includes(cell) ? 'foil-covered' : ''}`} onPointerDown={event => { event.preventDefault(); brush(cell) }} onPointerEnter={event => { if (event.buttons === 1) brush(cell) }} onClick={event => { if (event.detail === 0) brush(cell) }}>{localProgress.coverageCells.includes(cell) ? '✦' : foilTarget(cell) ? '·' : ''}</button>)}</div><Meter label="有效覆盖" value={foil.coverage} target={requirement.targets.coverage} /><p className="craft-help">已覆盖 {Math.round(foil.covered * 100)}% · 越界 {Math.round(foil.overflow * 100)}% · 过热接触 {foil.overheated} 次</p><button data-sound="none" className="station-primary" disabled={!isRunning || !started.current} onClick={() => finish({ coverage: foil.coverage }, { coverage: String(foil.covered), overflow: String(foil.overflow), overheated: String(foil.overheated) })}>揭下烫金纸</button></>}
    <div className="craft-cancel"><small>{started.current ? '材料已经用掉。放弃后重做需要另取一份。' : '材料已为你留好，动手前放弃可以归还。'}</small><button className="station-text-button" onClick={() => { finished.current = true; void dispatch({ station: 'craft', type: 'cancel-craft', draftId: draft.id, craftId: requirement.id }) }}>放弃本次工艺</button></div>
  </div>
}
