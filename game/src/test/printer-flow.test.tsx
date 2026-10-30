import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShiftProvider, useShift, type ShiftContextValue } from '../app/ShiftProvider'
import { AUTHORED_STAGES } from '../content/production'
import { InMemoryPrintShop, createPrintRecord, toShiftPrintReceipt, type PrintShopGateway } from '../domain/gateways'
import { initializeShift, transitionShift, type ShiftEngineAction } from '../domain/shift-engine'
import type { MachineId, PuzzleAnswer, PuzzleInstance, ShiftRun, StageDefinition } from '../domain/shift-types'
import { BrowserShiftStore } from '../infrastructure/shift-store'
import { ShiftScreen } from '../screens/ShiftScreen'
import productionPrinterStyles from '../styles/printers.css?inline'

const START = 1_000_000
let context: ShiftContextValue
function Probe() { context = useShift(); return null }
function correctAnswer(puzzle: PuzzleInstance): PuzzleAnswer {
  const d = puzzle.definition
  switch (d.kind) {
    case 'number-search': return { kind: d.kind, index: d.correctIndex }
    case 'connect': return { kind: d.kind, path: d.correctPath }
    case 'identify': return { kind: d.kind, optionId: d.correctOptionId }
    case 'minesweeper': return { kind: d.kind, flaggedIndices: d.mineIndices, revealedIndices: Array.from({ length: d.rows * d.columns }, (_, i) => i).filter(i => !d.mineIndices.includes(i)) }
    case 'sudoku': return { kind: d.kind, cells: d.solution }
    case 'math-choice': return { kind: d.kind, optionIds: d.correctOptionIds }
    case 'math-fill': return { kind: d.kind, text: d.acceptedAnswers[0] }
  }
}
function preparedRun(archive = true): ShiftRun {
  const stage: StageDefinition = { ...AUTHORED_STAGES.tutorial, customers: AUTHORED_STAGES.tutorial.customers.slice(0, 3).map(customer => ({ ...customer, arrivalSeconds: 0 })) }
  let run = initializeShift(stage, 'printer-run', START)
  const apply = (action: ShiftEngineAction) => { run = transitionShift(run, action, START) }
  for (const [index, scheduled] of stage.customers.entries()) {
    apply({ station: 'reception', type: 'accept-order', orderId: scheduled.id })
    const draft = Object.values(run.drafts).find(item => item.orderId === scheduled.id)!
    const r = scheduled.order.requirements
    apply({ station: 'preparation', type: 'select-preparation', draftId: draft.id, selection: { paperId: r.paperId, paperMaterialId: r.paperMaterialId, shapeId: r.shapeId, orientation: r.orientation, layoutId: r.layoutId, surfaceFinishId: r.surfaceFinishId } })
    apply({ station: 'preparation', type: 'cut-blank', draftId: draft.id })
    apply({ station: 'assembly', type: 'fix-assembly', draftId: draft.id })
    if (archive) apply({ station: 'print', type: 'archive', draftId: draft.id, snapshotId: `card-${index}` })
  }
  apply({ type: 'select-order', orderId: stage.customers[0].id })
  apply({ type: 'switch-station', station: 'print' })
  return run
}
function addCalibration(run: ShiftRun, index = 0, machineId: MachineId = 'quick', suffix = ''): ShiftRun {
  const intentId = `intent-${index}${suffix}`
  const selectedOrderId = run.selectedOrderId
  run = { ...run, station: 'print', selectedOrderId: run.orders[index].id }
  run = transitionShift(run, { station: 'print', type: 'confirm-print', snapshotId: `card-${index}`, intentId, machineId }, START)
  run = transitionShift(run, { station: 'print', type: 'begin-calibration', intentId, machineId }, START)
  return { ...run, selectedOrderId }
}
function numberCalibration(): ShiftRun {
  const run = addCalibration(preparedRun())
  const puzzle = Object.values(run.puzzles)[0]
  return { ...run, puzzles: { [puzzle.id]: { ...puzzle, definition: { kind: 'number-search', columns: 3, grid: [31, 13, 37, 73, 17, 71, 33, 11, 77], target: 37, correctIndex: 2 } } } }
}
function addTask(run: ShiftRun, index: number, machineId: MachineId, suffix = ''): ShiftRun {
  run = addCalibration(run, index, machineId, suffix)
  const intentId = `intent-${index}${suffix}`
  const puzzle = Object.values(run.puzzles).find(item => item.intentId === intentId)!
  run = transitionShift(run, { station: 'print', type: 'submit-puzzle', puzzleId: puzzle.id, answer: correctAnswer(puzzle) }, START)
  return transitionShift(run, { station: 'print', type: 'record-receipt', receipt: toShiftPrintReceipt(createPrintRecord(intentId, `card-${index}`, { kind: 'shift', machineId, shiftRunId: run.id }, new Date(START).toISOString())) }, START)
}
async function mount(run = preparedRun(), gateway?: PrintShopGateway) {
  let time = START
  const now = () => time
  const store = new BrowserShiftStore()
  await store.saveCurrent({ version: 1, revision: 1, savedAtMs: time, run })
  const printGateway = gateway ?? new InMemoryPrintShop(() => new Date(time).toISOString())
  const tree = () => <ShiftProvider stage={run.stage} runId={run.id} now={now} scheduleTick={null} store={store} gateway={printGateway}><ShiftScreen /><Probe /></ShiftProvider>
  let view = render(tree())
  await waitFor(() => expect(context?.status).toBe('ready'))
  return {
    store, gateway: printGateway,
    async send(action: ShiftEngineAction) { await act(async () => { await context.dispatch(action) }) },
    async at(at: number) { time = at; await act(async () => { await context.tick() }) },
    async remount() { view.unmount(); view = render(tree()); await waitFor(() => expect(context.status).toBe('ready')) },
  }
}
const click = async (button: HTMLElement) => { await act(async () => { fireEvent.click(button) }) }
const printer = (machine: '快印机' | '精印机') => screen.getByRole('region', { name: machine })

describe('printer counter flow', () => {
  it('keeps every production printer selector inside its own namespace', () => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(productionPrinterStyles)
    const selectors = (rules: CSSRuleList): string[] => Array.from(rules).flatMap(rule => 'selectorText' in rule
      ? (rule as CSSStyleRule).selectorText.split(',').map(selector => selector.trim())
      : 'cssRules' in rule ? selectors((rule as CSSGroupingRule).cssRules) : [])
    const scoped = selectors(sheet.cssRules)
    expect(scoped.length).toBeGreaterThan(0)
    expect(scoped.filter(selector => !selector.startsWith('.production-'))).toEqual([])
  })

  it('renders both production machines without matching the workshop machine or its pseudo-element selector', async () => {
    await mount()
    for (const name of ['快印机', '精印机'] as const) {
      const machine = printer(name)
      expect(machine).toHaveClass('production-printer-machine')
      expect(machine.matches('.printer-machine')).toBe(false)
    }
  })

  it('reorders only waiting tasks within their own machine and keeps the current task in place', async () => {
    const run = addTask(addTask(addTask(preparedRun(), 0, 'quick'), 1, 'quick'), 2, 'quick')
    await mount(run)
    const original = context.run!.printers.quick
    expect(screen.queryByRole('button', { name: '心爱的冲印单上移' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '智乃的冲印单上移' })).toBeDisabled()
    await click(screen.getByRole('button', { name: '理世的冲印单上移' }))
    expect(context.run!.printers.quick.queuedTaskIds).toEqual([...original.queuedTaskIds].reverse())
    expect(context.run!.printers.quick.currentTaskId).toBe(original.currentTaskId)
    expect(context.run!.printers.fine).toEqual(run.printers.fine)
    expect(screen.getByRole('button', { name: '理世的冲印单上移' })).toBeDisabled()
    await click(screen.getByRole('button', { name: '理世的冲印单下移' }))
    await waitFor(() => expect(context.run!.printers.quick.queuedTaskIds).toEqual(original.queuedTaskIds))
  })

  it('archives without printing, then explicitly confirms one stable reserved calibration across duplicate clicks and remount', async () => {
    const test = await mount(preparedRun(false))
    const start = vi.spyOn(test.gateway, 'startShift')
    expect(within(printer('快印机')).getByRole('button', { name: /确认冲印/ })).toBeDisabled()
    await click(screen.getByRole('button', { name: '收入 StampBook' }))
    expect(context.run!.snapshotIds).toHaveLength(1)
    expect(Object.values(context.run!.authorizations)).toHaveLength(0)
    expect(Object.values(context.run!.puzzles)).toHaveLength(0)
    expect(start).not.toHaveBeenCalled()
    const button = within(printer('快印机')).getByRole('button', { name: /确认冲印/ })
    await act(async () => { fireEvent.click(button); fireEvent.click(button) })
    await waitFor(() => expect(Object.values(context.run!.puzzles)).toHaveLength(1))
    const intent = Object.values(context.run!.authorizations)[0]
    expect(intent.status).toBe('calibrating')
    expect(context.run!.printers.quick.reservations).toHaveLength(1)
    expect(within(printer('快印机')).getByText(/1 正在冲印.*2 排队或校准/)).toBeInTheDocument()
    const puzzle = Object.values(context.run!.puzzles)[0]
    await test.remount()
    expect(Object.values(context.run!.authorizations)).toEqual([intent])
    expect(Object.values(context.run!.puzzles)).toEqual([puzzle])
    expect(start).not.toHaveBeenCalled()
  })

  it.each(['ticket', 'station', 'both'] as const)('does not start a stale calibration after %s changes during confirmation persistence', async change => {
    const test = await mount()
    const original = test.store.saveCurrent.bind(test.store)
    let release!: () => void
    vi.spyOn(test.store, 'saveCurrent').mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => { release = resolve })
      return original(...args)
    })
    await click(within(printer('快印机')).getByRole('button', { name: '确认冲印' }))
    await waitFor(() => expect(release).toBeTypeOf('function'))
    if (change !== 'station') await click(screen.getByRole('button', { name: /订单位 2 智乃/ }))
    if (change !== 'ticket') await click(screen.getByRole('button', { name: /3 组装台/ }))
    await act(async () => { release() })
    // Flush the provider queue after the UI continuation has enqueued its delayed start.
    await test.at(START)
    expect(context.selectedOrderId).toBe(context.run!.orders[change === 'station' ? 0 : 1].id)
    expect(context.station).toBe(change === 'ticket' ? 'print' : 'assembly')
    expect(Object.values(context.run!.authorizations)).toHaveLength(1)
    expect(Object.values(context.run!.authorizations)[0].status).toBe('confirmed')
    expect(Object.values(context.run!.puzzles)).toHaveLength(0)
    expect(context.run!.printers.quick.reservations).toHaveLength(0)
    expect(await test.gateway.list()).toEqual([])

    await test.send({ type: 'select-order', orderId: context.run!.orders[0].id })
    await test.send({ type: 'switch-station', station: 'print' })
    await click(within(printer('快印机')).getByRole('button', { name: '开始校准' }))
    expect(Object.values(context.run!.authorizations)).toHaveLength(1)
    expect(Object.values(context.run!.puzzles)).toHaveLength(1)
    expect(context.run!.printers.quick.reservations).toHaveLength(1)
  })

  it('explains a full queue before confirmation and creates neither an authorization nor a puzzle', async () => {
    let run = addTask(addTask(addTask(preparedRun(), 0, 'quick'), 0, 'quick', '-copy'), 1, 'quick')
    run = transitionShift(run, { type: 'select-order', orderId: run.orders[2].id }, START)
    const test = await mount(run)
    const count = Object.values(run.puzzles).length
    const full = within(printer('快印机')).getByRole('button', { name: /暂时排满/ })
    expect(full).toBeDisabled()
    expect(within(printer('快印机')).getByText(/3 个机位均已占用/)).toBeInTheDocument()
    await click(full)
    expect(Object.values(context.run!.puzzles)).toHaveLength(count)
    expect(Object.values(context.run!.authorizations)).toHaveLength(3)
    expect(await test.gateway.list()).toEqual([])
    expect(within(printer('精印机')).getByRole('button', { name: /确认冲印/ })).toBeEnabled()
  })

  it('shows the exact complex-card speed and six-point tradeoff before confirming', async () => {
    const run = preparedRun()
    const order = run.orders[0]
    const complex: ShiftRun = { ...run, orders: run.orders.map(item => item.id === order.id ? { ...item, content: { ...item.content, requirements: { ...item.content.requirements, surfaceFinishId: 'foil' } } } : item) }
    await mount(complex)
    expect(within(printer('快印机')).getByText(/60 秒/)).toBeInTheDocument()
    expect(within(printer('快印机')).getByText(/精细效果会有损失.*6 分/)).toBeInTheDocument()
    expect(within(printer('精印机')).getByText(/85 秒/)).toBeInTheDocument()
  })

  it('explains why an unfinished selected premium surface cannot be archived', async () => {
    const test = await mount(preparedRun(false))
    const draft = Object.values(context.run!.drafts).find(item => item.orderId === context.selectedOrderId)!
    await test.send({ station: 'preparation', type: 'select-preparation', draftId: draft.id, selection: { surfaceFinishId: 'foil' } })
    expect(screen.getByRole('button', { name: '收入 StampBook' })).toBeDisabled()
    expect(screen.getByText('请先到工艺台完成所选表面工艺。')).toBeInTheDocument()
    expect(context.run!.snapshotIds).toEqual([])
  })

  it('fails a wrong answer, releases only that reservation and retries the other machine with the same intent', async () => {
    const test = await mount(numberCalibration())
    await click(screen.getByRole('button', { name: '31' }))
    expect(context.run!.authorizations['intent-0']).toMatchObject({ status: 'failed', machineId: 'quick', machineLockUntilMs: START + 30_000 })
    expect(context.run!.printers.quick.reservations).toEqual([])
    expect(screen.getByText(/校准未通过/)).toBeInTheDocument()
    expect(within(printer('快印机')).getByRole('button', { name: /本单稍候/ })).toBeDisabled()
    await click(within(printer('精印机')).getByRole('button', { name: /改用精印机校准/ }))
    await waitFor(() => expect(context.run!.authorizations['intent-0']).toMatchObject({ status: 'calibrating', machineId: 'fine', attempt: 2 }))
    expect(Object.values(context.run!.authorizations)).toHaveLength(1)
    expect(context.run!.printers.fine.reservations).toHaveLength(1)
    expect(await test.gateway.list()).toEqual([])
  })

  it('uses the saved absolute deadline on timeout and allows the original machine after its remaining lock expires', async () => {
    const test = await mount(numberCalibration())
    const puzzle = Object.values(context.run!.puzzles)[0]
    await test.at(puzzle.deadlineAtMs + 5_000)
    expect(context.run!.authorizations['intent-0']).toMatchObject({ status: 'failed', machineLockUntilMs: puzzle.deadlineAtMs + 30_000 })
    expect(screen.getByText(/校准超时/)).toBeInTheDocument()
    expect(within(printer('快印机')).getByText(/本单还需等待 25 秒/)).toBeInTheDocument()
    await test.at(puzzle.deadlineAtMs + 30_000)
    expect(within(printer('快印机')).getByRole('button', { name: /重新校准/ })).toBeEnabled()
  })

  it.each(['close', 'station', 'ticket', 'accept'] as const)('counts %s leaving a calibration as failure', async method => {
    let run = numberCalibration()
    if (method === 'accept') run = { ...run, activeOrderIds: run.activeOrderIds.filter(id => id !== run.orders[2].id), orders: run.orders.map((order, index) => index === 2 ? { ...order, position: 'door_waiting', acceptedAtMs: null } : order) }
    const test = await mount(run)
    if (method === 'close') await click(screen.getByRole('button', { name: '退出校准' }))
    if (method === 'station') await test.send({ type: 'switch-station', station: 'craft' })
    if (method === 'ticket') await test.send({ type: 'select-order', orderId: run.orders[1].id })
    if (method === 'accept') await test.send({ station: 'reception', type: 'accept-order', orderId: run.orders[2].id })
    expect(context.run!.authorizations['intent-0']).toMatchObject({ status: 'failed', machineLockUntilMs: START + 30_000 })
    expect(Object.values(context.run!.puzzles)[0].result).toMatchObject({ status: 'failed', reason: 'exit' })
    expect(context.run!.printers.quick.reservations).toEqual([])
  })

  it('persists calibrated work before contacting the printer and keeps the reserved place until one receipt arrives', async () => {
    const gateway = new InMemoryPrintShop(() => new Date(START).toISOString())
    const original = gateway.startShift.bind(gateway)
    let release!: () => void
    let savedAtStart: ShiftRun | undefined
    const start = vi.spyOn(gateway, 'startShift').mockImplementation(async (...args) => {
      savedAtStart = (await test.store.loadCurrent())!.run
      await new Promise<void>(resolve => { release = resolve })
      return original(...args)
    })
    const test = await mount(numberCalibration(), gateway)
    await click(screen.getByRole('button', { name: '37' }))
    await waitFor(() => expect(release).toBeTypeOf('function'))
    expect(savedAtStart!.authorizations['intent-0'].status).toBe('calibrated_pending_start')
    expect(screen.getByText(/校准已通过，正在等待冲印确认/)).toBeInTheDocument()
    expect(context.run!.printers.quick.reservations).toHaveLength(1)
    expect(within(printer('精印机')).getByRole('button', { name: /等待冲印确认/ })).toBeDisabled()
    await test.at(START + 20_000)
    expect(context.run!.printers.quick.reservations).toHaveLength(1)
    await act(async () => { release() })
    await waitFor(() => expect(context.run!.authorizations['intent-0'].status).toBe('bound'))
    expect(Object.values(context.run!.tasks)).toHaveLength(1)
    await test.remount()
    expect(start).toHaveBeenCalledTimes(1)
    expect(await gateway.list()).toHaveLength(1)
  })

  it('keeps both printers moving elsewhere, announces ready work without switching stations, and hands only the named card to its customer', async () => {
    let run = addTask(addTask(preparedRun(), 0, 'quick'), 1, 'fine')
    run = addCalibration(run, 2, 'quick')
    run = { ...run, selectedOrderId: run.orders[2].id }
    const test = await mount(run)
    const tasks = Object.values(run.tasks)
    await test.at(START + 5_000)
    expect(Object.values(context.run!.tasks).map(task => task.status)).toEqual(['printing', 'printing'])
    await test.send({ type: 'switch-station', station: 'assembly' })
    await test.at(START + 65_000)
    expect(context.station).toBe('assembly')
    expect(context.notice).toMatch(/冲印完成.*心爱.*智乃/)
    expect(context.run!.orders[0].outcome.status).toBe('pending')
    expect(tasks.every(task => context.run!.tasks[task.id].status === 'ready')).toBe(true)
    await test.send({ type: 'switch-station', station: 'print' })
    await click(screen.getByRole('button', { name: '亲手交给心爱' }))
    expect(context.run!.orders[0].outcome.status).toBe('delivered')
    expect(context.run!.orders[1].outcome.status).toBe('pending')
    expect(context.selectedOrderId).toBe(run.orders[2].id)
  })

  it('shows unclaimed completed work even when there is no active order', async () => {
    const run = addTask(preparedRun(), 0, 'quick')
    const test = await mount(run)
    await test.at(START + 700_000)
    expect(context.selectedOrderId).toBeNull()
    expect(screen.getByRole('region', { name: '无人领取' })).toHaveTextContent('心爱')
    expect(screen.queryByRole('button', { name: '亲手交给心爱' })).not.toBeInTheDocument()
  })

  it('offers one progress explanation and one queued expedite with honest exclusions', async () => {
    const run = addTask(addTask(preparedRun(), 0, 'quick'), 1, 'quick')
    const test = await mount(run)
    await click(screen.getByRole('button', { name: '说明进度 · 心爱' }))
    expect(context.run!.orders[0].remedy).toBe('explain-progress')
    expect(screen.getByRole('button', { name: '加急冲印 · 心爱' })).toBeDisabled()
    expect(screen.getByText(/心爱已经接受过一次补救/)).toBeInTheDocument()
    const secondTask = Object.values(run.tasks).find(task => task.orderId === run.orders[1].id)!
    await click(screen.getByRole('button', { name: '加急冲印 · 智乃' }))
    await waitFor(() => expect(context.run!.tasks[secondTask.id]).toMatchObject({ status: 'queued', durationMs: secondTask.durationMs / 2, expedited: true }))
    expect(context.run!.remedies).toEqual({ explainProgressAvailable: false, expediteAvailable: false })
    expect(context.run!.printers.quick.currentTaskId).toBe(run.printers.quick.currentTaskId)
    expect(screen.getByRole('button', { name: '加急冲印 · 智乃' })).toBeDisabled()
    expect(document.body.textContent).not.toMatch(/\b(?:JSON|API|token|field|log|payload|schema)\b/i)
  })
})
