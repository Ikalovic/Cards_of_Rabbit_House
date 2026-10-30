import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ShiftProvider, useShift, type ShiftContextValue } from '../app/ShiftProvider'
import { AUTHORED_STAGES } from '../content/production'
import { InMemoryPrintShop, createPrintRecord, toShiftPrintReceipt, type PrintShopGateway } from '../domain/gateways'
import { advanceShift, initializeShift, transitionShift, type ShiftEngineAction } from '../domain/shift-engine'
import type { PuzzleAnswer, PuzzleInstance, ShiftRun, ShiftSnapshot, StageDefinition } from '../domain/shift-types'
import { BROWSER_STORE_KEYS, BrowserPrintShop } from '../infrastructure/browser-store'
import { BrowserShiftStore, SHIFT_STORE_KEYS } from '../infrastructure/shift-store'
import { ShiftScreen } from '../screens/ShiftScreen'

const START = 1_000_000
const tutorial = AUTHORED_STAGES.tutorial
let context: ShiftContextValue
function Probe() {
  context = useShift()
  return null
}
function OrdinaryPanel() {
  const [open, setOpen] = useState(false)
  return <><button onClick={() => setOpen(!open)}>查看确认单</button>{open && <div role="dialog" aria-label="确认单"><input aria-label="备注" /></div>}</>
}
async function mount(options: { run?: ShiftRun; stage?: StageDefinition; gateway?: PrintShopGateway; store?: BrowserShiftStore; runId?: string; nowMs?: number } = {}) {
  let time = options.nowMs ?? options.run?.lastProcessedAtMs ?? START
  const now = () => time
  const store = options.store ?? new BrowserShiftStore()
  if (options.run) await store.saveCurrent({ version: 1, revision: 1, savedAtMs: time, run: options.run })
  const save = vi.spyOn(store, 'saveCurrent')
  const gateway = options.gateway ?? new InMemoryPrintShop(() => new Date(time).toISOString())
  const renderTree = () => <ShiftProvider stage={options.stage ?? options.run?.stage ?? tutorial} runId={options.runId ?? options.run?.id ?? 'ui-run'} now={now} scheduleTick={null} store={store} gateway={gateway}>
    <ShiftScreen><OrdinaryPanel /></ShiftScreen><Probe />
  </ShiftProvider>
  let view = render(renderTree())
  await waitFor(() => expect(context?.status).toBe('ready'))
  return {
    store, save, gateway, now,
    async at(milliseconds: number) { time = milliseconds; await act(async () => { await context.tick() }) },
    async send(action: ShiftEngineAction) { await act(async () => { await context.dispatch(action) }) },
    async remountAt(milliseconds: number) {
      view.unmount(); time = milliseconds
      view = render(renderTree())
      await waitFor(() => expect(context.status).toBe('ready'))
    },
    unmount() { view.unmount() },
  }
}
function answer(instance: PuzzleInstance): PuzzleAnswer {
  const p = instance.definition
  switch (p.kind) {
    case 'number-search': return { kind: p.kind, index: p.correctIndex }
    case 'connect': return { kind: p.kind, path: p.correctPath }
    case 'identify': return { kind: p.kind, optionId: p.correctOptionId }
    case 'sudoku': return { kind: p.kind, cells: p.solution }
    case 'minesweeper': return { kind: p.kind, flaggedIndices: p.mineIndices, revealedIndices: Array.from({ length: p.rows * p.columns }, (_, i) => i).filter(i => !p.mineIndices.includes(i)) }
    case 'math-choice': return { kind: p.kind, optionIds: p.correctOptionIds }
    case 'math-fill': return { kind: p.kind, text: p.acceptedAnswers[0] }
  }
}
function timerFixture(pendingStart = false) {
  const stage: StageDefinition = { ...tutorial, customers: tutorial.customers.slice(0, 3).map(customer => ({ ...customer, arrivalSeconds: 0 })) }
  let run = initializeShift(stage, 'ui-run', START)
  const apply = (action: ShiftEngineAction) => { run = transitionShift(run, action, START) }
  apply({ type: 'switch-station', station: 'print' })
  for (const [index, customer] of stage.customers.entries()) {
    apply({ station: 'reception', type: 'accept-order', orderId: customer.id })
    const draft = Object.values(run.drafts).find(draft => draft.orderId === customer.id)!
    apply({ station: 'print', type: 'archive', draftId: draft.id, snapshotId: `card-${index}` })
    apply({ station: 'print', type: 'confirm-print', snapshotId: `card-${index}`, intentId: `intent-${index}`, machineId: index ? 'fine' : 'quick' })
    apply({ station: 'print', type: 'begin-calibration', intentId: `intent-${index}`, machineId: index ? 'fine' : 'quick' })
    const puzzle = Object.values(run.puzzles).find(puzzle => puzzle.intentId === `intent-${index}`)!
    if (index === 0) {
      apply({ station: 'print', type: 'submit-puzzle', puzzleId: puzzle.id, answer: answer(puzzle) })
      if (!pendingStart) apply({ station: 'print', type: 'record-receipt', receipt: toShiftPrintReceipt(createPrintRecord('intent-0', 'card-0', { kind: 'shift', machineId: 'quick', shiftRunId: run.id }, new Date(START).toISOString())) })
    } else if (index === 1) apply({ station: 'print', type: 'exit-puzzle', puzzleId: puzzle.id })
  }
  return run
}

describe('shift desktop flow', () => {
  it('starts at twelve minutes, shows only arrivals, supports six stations and three ticket shortcuts', async () => {
    const test = await mount()
    expect(screen.getByLabelText('本班剩余时间')).toHaveTextContent('12:00')
    expect(screen.getByText(`第 ${tutorial.day} 营业日`)).toBeInTheDocument()
    const door = screen.getByRole('complementary', { name: '门口等候' })
    expect(within(door).getByText('心爱')).toBeInTheDocument()
    expect(within(door).queryByText('智乃')).not.toBeInTheDocument()
    expect(within(door).queryByText('纱路')).not.toBeInTheDocument()
    await act(async () => fireEvent.click(within(door).getByRole('button', { name: /接下.*心爱/ })))
    await waitFor(() => expect(context.run!.activeOrderIds).toEqual([tutorial.customers[0].id]))
    const labels = ['接单台', '备料台', '组装台', '工艺台', '检查台', '冲印台']
    for (let i = 0; i < labels.length; i++) {
      await act(async () => fireEvent.keyDown(window, { key: String(i + 1) }))
      await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${i + 1} ${labels[i]}`) })).toHaveAttribute('aria-pressed', 'true'))
    }
    await test.at(START + 55_000)
    await act(async () => fireEvent.click(within(door).getByRole('button', { name: /接下.*智乃/ })))
    await test.at(START + 130_000)
    await act(async () => fireEvent.click(within(door).getByRole('button', { name: /接下.*理世/ })))
    for (const [index, key] of ['q', 'W', 'e'].entries()) {
      await act(async () => fireEvent.keyDown(window, { key }))
      await waitFor(() => expect(context.selectedOrderId).toBe(tutorial.customers[index].id))
    }
    await test.at(START + 210_000)
    expect(within(door).getByRole('button', { name: /接下.*千夜/ })).toBeDisabled()
    await test.send({ station: 'reception', type: 'accept-order', orderId: tutorial.customers[3].id })
    expect(context.run!.activeOrderIds).toHaveLength(3)
    expect(screen.getAllByTestId('ticket-slot')).toHaveLength(3)
    expect(within(door).queryByText('纱路')).not.toBeInTheDocument()
  })

  it('freezes every live deadline only for a controlled pause and moves them exactly on resume', async () => {
    const test = await mount({ run: timerFixture() })
    await act(async () => { await context.pause('tutorial') })
    const before = structuredClone(context.run!)
    const remaining = context.remainingMs
    await test.at(START + 90_000)
    expect(context.run).toEqual(before)
    expect(context.remainingMs).toBe(remaining)
    expect(context.displayNowMs).toBe(START)
    await act(async () => { await context.resume() })
    const after = context.run!
    expect(after.deadlineAtMs).toBe(before.deadlineAtMs + 90_000)
    expect(after.orders[0].patience.phase).toBe('normal')
    if (after.orders[0].patience.phase === 'normal' && before.orders[0].patience.phase === 'normal') {
      expect(after.orders[0].patience.depletesAtMs).toBe(before.orders[0].patience.depletesAtMs + 90_000)
      expect(after.orders[0].patience.remainingSeconds).toBe(before.orders[0].patience.remainingSeconds)
    }
    const pending = Object.values(before.puzzles).find(puzzle => puzzle.result.status === 'pending')!
    expect(after.puzzles[pending.id].deadlineAtMs).toBe(pending.deadlineAtMs + 90_000)
    const printing = Object.values(before.tasks).find(task => task.status === 'printing')!
    expect(after.tasks[printing.id]).toMatchObject({ completesAtMs: printing.status === 'printing' ? printing.completesAtMs + 90_000 : 0 })
    const locked = tutorial.customers[1].id
    expect(after.printers.fine.orderLockUntilMs[locked]).toBe(before.printers.fine.orderLockUntilMs[locked] + 90_000)
    expect(context.remainingMs).toBe(remaining)
  })

  it('keeps time moving through station panels, confirmation, visibility changes, and refresh', async () => {
    const test = await mount()
    await test.send({ station: 'reception', type: 'accept-order', orderId: tutorial.customers[0].id })
    await test.send({ type: 'switch-station', station: 'preparation' })
    fireEvent.click(screen.getByRole('button', { name: '查看确认单' }))
    fireEvent(document, new Event('visibilitychange'))
    await test.at(START + 5_000)
    expect(context.run!.status).toBe('running')
    expect(context.remainingSeconds).toBe(715)
    expect(context.run!.orders[0].patience).toMatchObject({ phase: 'normal', remainingSeconds: 280 })
    await test.remountAt(START + 20_000)
    expect(context.origin).toBe('resumed')
    expect(context.remainingSeconds).toBe(700)
    expect(context.run!.orders[0].patience).toMatchObject({ phase: 'normal', remainingSeconds: 265 })
    expect(context.run!.pauses).toEqual([])
  })

  it('persists transactions and timed events but not ordinary countdown ticks', async () => {
    const test = await mount()
    test.save.mockClear()
    await test.at(START + 1_000)
    await test.at(START + 2_000)
    expect(test.save).not.toHaveBeenCalled()
    await test.send({ station: 'reception', type: 'accept-order', orderId: tutorial.customers[0].id })
    expect(test.save).toHaveBeenCalledTimes(1)
    const draft = Object.values(context.run!.drafts)[0]
    await test.send({ station: 'preparation', type: 'select-preparation', draftId: draft.id, selection: { paperId: 'pink' } })
    expect(test.save).toHaveBeenCalledTimes(2)
    await test.at(START + 3_000)
    expect(test.save).toHaveBeenCalledTimes(2)
    await test.at(START + 55_000)
    expect(test.save).toHaveBeenCalledTimes(3)
    await test.at(START + 56_000)
    expect(test.save).toHaveBeenCalledTimes(3)
    const revisions = test.save.mock.calls.map(([snapshot]) => snapshot.revision)
    expect(revisions).toEqual([2, 3, 4])
  })

  it('retains inspection time through actions, refresh, and continued wall-clock ticks', async () => {
    const test = await mount()
    await test.send({ station: 'reception', type: 'accept-order', orderId: tutorial.customers[0].id })
    const draft = Object.values(context.run!.drafts)[0]
    await test.send({ station: 'inspection', type: 'inspect', draftId: draft.id, freeDemo: false })
    expect(context.remainingSeconds).toBe(715)
    expect(context.run!.orders[0].patience).toMatchObject({ remainingSeconds: 280 })

    await test.at(START + 1_000)
    await test.send({ type: 'switch-station', station: 'preparation' })
    await test.send({ station: 'preparation', type: 'select-preparation', draftId: draft.id, selection: { paperId: 'pink' } })
    expect(context.displayNowMs).toBe(START + 6_000)
    expect(context.remainingSeconds).toBe(714)
    expect(context.run!.orders[0].patience).toMatchObject({ remainingSeconds: 279 })

    await test.remountAt(START + 3_000)
    expect(context.origin).toBe('resumed')
    expect(context.remainingSeconds).toBe(712)
    expect(context.run!.drafts[draft.id].design.preparation.paperId).toBe('pink')
    await test.at(START + 6_000)
    expect(context.displayNowMs).toBe(START + 11_000)
    expect(context.remainingSeconds).toBe(709)
    expect(context.run!.orders[0].patience).toMatchObject({ remainingSeconds: 274 })
  })

  it('preserves inspection cost across an immediate controlled pause and paused restore', async () => {
    const test = await mount()
    await test.send({ station: 'reception', type: 'accept-order', orderId: tutorial.customers[0].id })
    await test.send({ station: 'inspection', type: 'inspect', draftId: Object.values(context.run!.drafts)[0].id, freeDemo: false })
    await act(async () => { await context.pause('tutorial') })
    expect(context.displayNowMs).toBe(START + 5_000)
    await test.remountAt(START + 20_000)
    expect(context.remainingSeconds).toBe(715)
    await act(async () => { await context.resume() })
    expect(context.run!.deadlineAtMs).toBe(START + 740_000)
    expect(context.displayNowMs).toBe(START + 25_000)
    expect(context.remainingSeconds).toBe(715)
    await test.at(START + 21_000)
    expect(context.remainingSeconds).toBe(714)
  })

  it('settles a restored shift when wall time plus inspection cost reaches closing', async () => {
    const stage: StageDefinition = { ...tutorial, customers: [{ ...tutorial.customers[0], basePatienceSeconds: 1_000 }] }
    const test = await mount({ stage })
    await test.send({ station: 'reception', type: 'accept-order', orderId: stage.customers[0].id })
    await test.at(START + 714_000)
    await test.send({ station: 'inspection', type: 'inspect', draftId: Object.values(context.run!.drafts)[0].id, freeDemo: false })
    expect(context.remainingSeconds).toBe(1)
    await test.remountAt(START + 715_000)
    expect(context.run).toMatchObject({ status: 'settled', result: { closedAtMs: START + 720_000 } })
    expect(context.remainingSeconds).toBe(0)
  })

  it('settles an overdue restored shift before enabling any interaction', async () => {
    const test = await mount()
    await test.remountAt(START + 900_000)
    expect(context.run!.status).toBe('settled')
    expect(screen.getByLabelText('本班剩余时间')).toHaveTextContent('00:00')
    expect(screen.getByRole('status')).toHaveTextContent('本班已打烊')
    expect(screen.queryByRole('button', { name: /接下/ })).not.toBeInTheDocument()
    expect((await test.store.loadCurrent())!.run.status).toBe('settled')
  })

  it('provides named landmarks, keyboard buttons, safe copy, and ignores typing and modified shortcuts', async () => {
    const test = await mount()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main', { name: '制卡工作台' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '工作台切换' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '进行中的订单' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '冲印与物料' })).toBeInTheDocument()
    expect(screen.getAllByTestId('ticket-slot')).toHaveLength(3)
    expect(screen.getByText('当前尚未选择订单')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看确认单' }))
    await act(async () => fireEvent.keyDown(screen.getByRole('textbox', { name: '备注' }), { key: '6' }))
    await act(async () => fireEvent.keyDown(window, { key: '5', ctrlKey: true }))
    expect(context.station).toBe('reception')
    await test.send({ type: 'select-order', orderId: tutorial.customers[4].id })
    expect(context.selectedOrderId).toBeNull()
    expect(document.body.textContent).not.toMatch(/\b(?:JSON|API|token|field|log|payload|schema)\b/i)
  })

  it('reloads the newest revision after a storage conflict and explains it in shop language', async () => {
    const test = await mount()
    const previous = (await test.store.loadCurrent())!
    const other = transitionShift(previous.run, { station: 'reception', type: 'accept-order', orderId: tutorial.customers[0].id }, START)
    await test.store.saveCurrent({ ...previous, revision: previous.revision + 1, run: other })
    await test.send({ type: 'switch-station', station: 'craft' })
    expect(context.run!.activeOrderIds).toEqual([tutorial.customers[0].id])
    expect(context.notice).toMatch(/另一处|最新/)
    expect(context.error).toBeNull()
    expect(document.body.textContent).not.toMatch(/\b(?:JSON|API|token|field|log|payload|schema)\b/i)
  })

  it('recovers persisted calibration by querying first and binds only its original shift receipt', async () => {
    const gateway = new InMemoryPrintShop(() => new Date(START).toISOString())
    const find = vi.spyOn(gateway, 'findByIntent')
    const start = vi.spyOn(gateway, 'startShift')
    const test = await mount({ run: timerFixture(true), gateway })
    await waitFor(() => expect(context.run!.authorizations['intent-0'].status).toBe('bound'))
    expect(find).toHaveBeenCalledWith('intent-0')
    expect(start).toHaveBeenCalledWith('intent-0', 'card-0', 'quick', 'ui-run')
    expect(find.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0])
    const stored = await test.store.loadCurrent()
    expect(stored!.run.authorizations['intent-0'].status).toBe('bound')
    expect(Object.keys(stored!.run.tasks)).toHaveLength(1)
  })

  it('retries failed current confirmation on a later ordinary tick with a cooldown', async () => {
    const gateway = new InMemoryPrintShop(() => new Date(START).toISOString())
    const find = vi.spyOn(gateway, 'findByIntent')
    const start = vi.spyOn(gateway, 'startShift').mockRejectedValueOnce(new Error('offline'))
    const test = await mount({ run: timerFixture(true), gateway })
    await waitFor(() => expect(context.error).toMatch(/冲印确认/))
    expect(context.run!.authorizations['intent-0'].status).toBe('calibrated_pending_start')
    await test.at(START + 1_000)
    await test.at(START + 4_000)
    expect(start).toHaveBeenCalledTimes(1)
    await test.at(START + 5_000)
    await waitFor(() => expect(context.run!.authorizations['intent-0'].status).toBe('bound'))
    expect(start.mock.calls).toEqual(Array(2).fill(['intent-0', 'card-0', 'quick', 'ui-run']))
    expect(find).toHaveBeenCalledTimes(2)
    expect(await gateway.list()).toHaveLength(1)
  })

  it('retries queued old shifts using their original identity, saves unclaimed prints and keeps current printers isolated', async () => {
    const store = new BrowserShiftStore()
    const closedAt = START + 720_000
    const old = advanceShift(timerFixture(true), closedAt)
    await store.saveCurrent({ version: 1, revision: 1, savedAtMs: closedAt, run: old })
    const gateway = new BrowserPrintShop()
    const find = vi.spyOn(gateway, 'findByIntent').mockRejectedValueOnce(new Error('offline'))
    const start = vi.spyOn(gateway, 'startShift')
    const recover = vi.spyOn(store, 'recoverPendingPrint')
    const saveOld = vi.spyOn(store, 'saveReconciliation')
    const finalize = vi.spyOn(store, 'finalizeReconciliation').mockRejectedValueOnce(new Error('temporarily full'))
    const archive = vi.spyOn(store, 'appendFinished')
    const remove = vi.spyOn(store, 'removeReconciliation')
    const test = await mount({ store, gateway, runId: 'next-run', nowMs: closedAt })
    const currentPrinters = structuredClone(context.run!.printers)
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1))
    expect(await store.listReconciliations()).toHaveLength(1)
    await test.at(closedAt + 1_000)
    await test.at(closedAt + 4_000)
    expect(find).toHaveBeenCalledTimes(1)
    await test.at(closedAt + 5_000)
    await waitFor(() => expect(finalize).toHaveBeenCalledTimes(1))
    expect(archive).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    const handled = (await store.listReconciliations())[0]
    expect(handled.run.authorizations['intent-0'].status).toBe('bound')
    expect(handled.run.pendingReconciliationIntentIds).toEqual([])
    expect(Object.values(handled.run.tasks)).toEqual([expect.objectContaining({ status: 'unclaimed', shiftRunId: 'ui-run' })])
    expect(saveOld).toHaveBeenCalled()
    expect(start).toHaveBeenCalledWith('intent-0', 'card-0', 'quick', 'ui-run')
    expect(recover.mock.calls.every(([, , originalRunId]) => originalRunId === 'ui-run')).toBe(true)
    expect(find.mock.invocationCallOrder[1]).toBeLessThan(start.mock.invocationCallOrder[0])
    await test.at(closedAt + 10_000)
    await waitFor(async () => expect(await store.listReconciliations()).toEqual([]))
    expect(finalize).toHaveBeenLastCalledWith(handled.run.id, old.status === 'settled' ? old.result : undefined, handled.revision)
    expect(remove).not.toHaveBeenCalled()
    expect(await store.listFinished()).toEqual([old.status === 'settled' ? old.result : undefined])
    expect((await new BrowserPrintShop().list())[0].context).toEqual({ kind: 'shift', machineId: 'quick', shiftRunId: 'ui-run' })
    expect(start).toHaveBeenCalledTimes(1)
    expect(context.run!.id).toBe('next-run')
    expect(context.run!.printers).toEqual(currentPrinters)
    expect(context.run!.tasks).toEqual({})
    expect((await store.loadCurrent())!.run.printers).toEqual(currentPrinters)
    expect(context.error).toBeNull()
  })

  it('settles a damaged current record visibly without touching the collection or print stores', async () => {
    localStorage.setItem(SHIFT_STORE_KEYS.current, '{damaged')
    const independentKeys = [BROWSER_STORE_KEYS.cardLibrary, BROWSER_STORE_KEYS.prints, SHIFT_STORE_KEYS.history, SHIFT_STORE_KEYS.progression]
    for (const key of independentKeys) localStorage.setItem(key, `preserved:${key}`)
    const test = await mount({ stage: AUTHORED_STAGES.beginner, runId: 'damaged-run' })
    expect(context.run).toMatchObject({ id: 'damaged-run', stage: { id: 'beginner' }, status: 'settled', result: { passed: false, failureReasons: expect.arrayContaining(['corrupt-save']) } })
    expect(context.notice).toMatch(/营业记录.*破损.*本班已结束/)
    expect(screen.getByLabelText('本班剩余时间')).toHaveTextContent('00:00')
    expect(screen.getByRole('button', { name: /^1 接单台/ })).toBeDisabled()
    expect((await test.store.loadCurrent())!.run).toEqual(context.run)
    for (const key of independentKeys) expect(localStorage.getItem(key)).toBe(`preserved:${key}`)
    expect(document.body.textContent).not.toMatch(/\b(?:JSON|API|token|field|log|payload|schema)\b/i)
  })

  it('shows an accessible patience ring and explicit animated last-wait and final-minute warnings', async () => {
    const test = await mount()
    const ring = screen.getByRole('progressbar', { name: '心爱的耐心' })
    expect(ring).toHaveClass('shift-patience-ring')
    expect(ring).toHaveAttribute('aria-valuenow', String(tutorial.customers[0].basePatienceSeconds))
    expect(ring).toHaveAttribute('aria-valuemax', String(tutorial.customers[0].basePatienceSeconds))
    expect(ring.querySelector('circle')).not.toBeNull()
    await test.send({ station: 'reception', type: 'accept-order', orderId: tutorial.customers[0].id })
    const first = context.run!.orders[0]
    const lastWaitAt = first.patience.phase === 'normal' ? first.patience.depletesAtMs : START
    await test.at(lastWaitAt)
    expect(screen.getByText(/⚠ 最后等候/)).toHaveClass('shift-warning')
    await test.at(START + 660_000)
    expect(screen.getByText('⚠ 即将打烊：最后一分钟')).toHaveClass('shift-warning')
    expect(screen.getByLabelText('本班剩余时间')).toHaveTextContent('01:00')
    expect(screen.getByText(`第 ${tutorial.day} 营业日`)).toBeInTheDocument()
  })

  it('discards delayed receipts after unmount without overwriting the next shift', async () => {
    const gateway = new InMemoryPrintShop(() => new Date(START).toISOString())
    let release!: () => void
    const original = gateway.findByIntent.bind(gateway)
    vi.spyOn(gateway, 'findByIntent').mockImplementation(async intentId => {
      await new Promise<void>(resolve => { release = resolve })
      return original(intentId)
    })
    const test = await mount({ run: timerFixture(true), gateway })
    await waitFor(() => expect(release).toBeTypeOf('function'))
    test.unmount()
    const next: ShiftSnapshot = { version: 1, revision: 1, savedAtMs: START, run: initializeShift(tutorial, 'next-run', START) }
    await test.store.saveCurrent(next)
    await act(async () => { release(); await Promise.resolve(); await Promise.resolve() })
    expect((await test.store.loadCurrent())!.run.id).toBe('next-run')
    expect((await test.store.loadCurrent())!.run.tasks).toEqual({})
  })
})
