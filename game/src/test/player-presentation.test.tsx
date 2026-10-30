import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShift, type ShiftContextValue } from '../app/ShiftProvider'
import { createInitialShiftProgression } from '../app/progression'
import { CustomerRail } from '../components/CustomerRail'
import { OrderTickets } from '../components/OrderTickets'
import { InspectionStation } from '../components/stations/InspectionStation'
import { AUTHORED_STAGES, ORDER_TEMPLATES } from '../content/production'
import { STORY_STAGES } from '../content/story'
import { initializeShift, transitionShift } from '../domain/shift-engine'
import type { OrderEvaluation, ShiftRun } from '../domain/shift-types'
import { ShiftScreen } from '../screens/ShiftScreen'
import { StampBookScreen } from '../screens/StampBookScreen'
import { TitleScreen } from '../screens/TitleScreen'

vi.mock('../app/ShiftProvider', () => ({ useShift: vi.fn() }))
const START = 1_000_000
const dispatch = vi.fn().mockResolvedValue(undefined)
function showRun(run: ShiftRun, nowMs = run.lastProcessedAtMs) {
  vi.mocked(useShift).mockReturnValue({ run, status: 'ready', origin: 'resumed', displayNowMs: nowMs,
    remainingMs: run.deadlineAtMs - nowMs, remainingSeconds: (run.deadlineAtMs - nowMs) / 1000,
    selectedOrderId: run.selectedOrderId, selectedOrder: run.orders.find(order => order.id === run.selectedOrderId) ?? null,
    station: run.station, error: null, notice: null, dispatch, tick: vi.fn(), pause: vi.fn(), resume: vi.fn(), clearNotice: vi.fn(),
  } satisfies ShiftContextValue)
}
const initial = () => initializeShift(AUTHORED_STAGES.tutorial, 'presentation-run', START)
const evaluation: OrderEvaluation = { accuracy: 40, preferences: 10, quality: 10, printing: 15, timeliness: 5,
  rawScore: 80, score: 80, grade: 'A', satisfied: true, missingRequiredIds: [], tabooViolated: false,
  advice: ['preference-unmet', 'normal-patience-elapsed'] }

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('player presentation', () => {
  it('renders fallback advice for inherited dictionary keys in restored feedback and inspection records', () => {
    let run = initial()
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    const draft = Object.values(run.drafts)[0]
    showRun({ ...run, drafts: { [draft.id]: { ...draft,
      inspections: [{ id: 'restored-inspection', draftRevision: draft.revision, checkedAtMs: START,
        freeDemo: true, issues: [{ code: '__proto__', label: 'unknown' }] }],
    } } })
    const view = render(<InspectionStation />)
    expect(screen.getByText('卡片上还有需要留意的制作细节')).toBeInTheDocument()
    showRun({ ...run, orders: [{ ...run.orders[0], outcome: { status: 'delivered', taskId: 'delivered', deliveredAtMs: START,
      evaluation: { ...evaluation, advice: ['__proto__'] } } }, ...run.orders.slice(1)] })
    view.rerender(<CustomerRail />)
    expect(screen.getByText('下次再对照订单，留意制作细节。')).toBeInTheDocument()
  })

  it('offers explicit early closing only after every scheduled customer has an outcome', () => {
    const run = initial()
    showRun(run)
    const view = render(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByRole('button', { name: '提前打烊' })).not.toBeInTheDocument()
    const left = run.orders.map(order => ({ ...order, position: 'closed' as const,
      outcome: { status: 'left' as const, leftAtMs: START, reason: 'patience' as const } }))
    showRun({ ...run, orders: left.map((order, index) => index === left.length - 1 ? run.orders[index] : order) })
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByRole('button', { name: '提前打烊' })).not.toBeInTheDocument()
    showRun({ ...run, orders: left })
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(dispatch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '提前打烊' }))
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'close-shift' })
  })

  it('shows the mapped local portrait and greeting, then only the matching patience warning', () => {
    const run = initial(), copy = STORY_STAGES.tutorial.customers[0]
    showRun(run)
    const view = render(<CustomerRail />)
    expect(screen.getByRole('img', { name: '心爱的头像' })).toBeInTheDocument()
    expect(screen.getByText(copy.greeting)).toBeInTheDocument()
    expect(screen.queryByText(copy.patienceWarning)).not.toBeInTheDocument()
    showRun({ ...run, orders: [{ ...run.orders[0], patience: { phase: 'last_wait', startedAtMs: START, deadlineAtMs: START + 30_000, originalDurationSeconds: 30 } }, ...run.orders.slice(1)] })
    view.rerender(<CustomerRail />)
    expect(screen.getByText(copy.patienceWarning)).toBeInTheDocument()
    expect(screen.queryByText(copy.greeting)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.departure)).not.toBeInTheDocument()
    showRun({ ...run, orders: [{ ...run.orders[0], outcome: { status: 'left', reason: 'patience', leftAtMs: START } }, ...run.orders.slice(1)] })
    view.rerender(<CustomerRail />)
    expect(screen.getByText(/客人已经离店/)).toBeInTheDocument()
    expect(screen.queryByText(copy.departure)).not.toBeInTheDocument()
  })

  it.each([true, false])('shows scored delivery feedback and an honest reaction (satisfied: %s)', satisfied => {
    const run = initial(), copy = STORY_STAGES.tutorial.customers[0]
    showRun({ ...run, orders: [{ ...run.orders[0], outcome: { status: 'delivered', taskId: 'delivered', deliveredAtMs: START, evaluation: { ...evaluation, satisfied } } }, ...run.orders.slice(1)] })
    render(<CustomerRail />)
    expect(screen.getByText('80 分 · A 级')).toBeInTheDocument()
    expect(screen.getByText(satisfied ? '满意' : '尚未满意')).toBeInTheDocument()
    expect(screen.getByText(satisfied ? copy.greatDelivery : copy.okayDelivery)).toBeInTheDocument()
    expect(screen.getByText(/喜好/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('preference-unmet')
    expect(document.body.textContent).not.toContain('普通等候时间已经用完')
  })

  it('gives Maya her own stable portrait outside authored story schedules', () => {
    const run = initial()
    const customer = { kind: 'official' as const, characterId: 'maya' as const, name: '麻耶', situation: '准备一份心意' }
    showRun({ ...run, orders: [{ ...run.orders[0], content: { ...run.orders[0].content, id: 'new-order', customer } }] })
    const view = render(<CustomerRail />)
    const portrait = screen.getByRole('img', { name: '麻耶的头像' })
    expect(portrait.outerHTML).toContain('/assets/production/customers/maya.png')
    const markup = portrait.outerHTML
    view.rerender(<CustomerRail />)
    expect(screen.getByRole('img', { name: '麻耶的头像' }).outerHTML).toBe(markup)
  })

  it('keeps generated official requests accurate instead of quoting a different card order', () => {
    const run = initial(), keepsake = ORDER_TEMPLATES.find(order => order.id === 'chino-keepsake')!
    showRun({ ...run, orders: [{ ...run.orders[0], content: { ...keepsake, id: 'generated-keepsake' } }] })
    render(<CustomerRail />)
    expect(screen.getByRole('img', { name: '智乃的头像' })).toBeInTheDocument()
    expect(screen.getByText(keepsake.title)).toBeInTheDocument()
    expect(screen.getByText(keepsake.customer.situation)).toBeInTheDocument()
    expect(screen.queryByText(STORY_STAGES.tutorial.customers[1].greeting)).not.toBeInTheDocument()
  })

  it('does not turn an outdated inspection into a current character warning', () => {
    let run = initial()
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    const draft = Object.values(run.drafts)[0]
    showRun({ ...run, drafts: { [draft.id]: { ...draft, revision: 2,
      inspections: [{ id: 'old-inspection', draftRevision: 1, checkedAtMs: START, freeDemo: true, issues: [{ code: 'taboo-violated', label: 'taboo-violated' }] }],
    } } })
    render(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(STORY_STAGES.tutorial.midShift.find(line => line.trigger === 'taboo_placed')!.text)).not.toBeInTheDocument()
  })

  it('does not offer a second remedy in character chatter', () => {
    let run = initializeShift(AUTHORED_STAGES.beginner, 'remedy-talk', START)
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    showRun({ ...run, orders: [{ ...run.orders[0], remedy: 'expedite',
      patience: { phase: 'last_wait', startedAtMs: START, deadlineAtMs: START + 30_000, originalDurationSeconds: 30 } }, ...run.orders.slice(1)] })
    render(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(STORY_STAGES.beginner.midShift.find(line => line.trigger === 'client-wait')!.text)).not.toBeInTheDocument()
  })

  it.each(['customer-remedy', 'shift-remedy', 'delivered', 'left'] as const)('immediately withdraws a displayed wait reminder after %s and never replays it', change => {
    vi.useFakeTimers()
    let run = initializeShift(AUTHORED_STAGES.beginner, 'live-remedy-talk', START)
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    run = { ...run, orders: [{ ...run.orders[0], patience: { phase: 'last_wait', startedAtMs: START, deadlineAtMs: START + 30_000, originalDurationSeconds: 30 } }, ...run.orders.slice(1)] }
    showRun(run)
    const view = render(<ShiftScreen><p>台面</p></ShiftScreen>)
    const line = STORY_STAGES.beginner.midShift.find(line => line.trigger === 'client-wait')!.text
    expect(screen.getByText(line)).toBeInTheDocument()
    const customer = run.orders[0]
    const changed: ShiftRun = change === 'shift-remedy' ? { ...run, remedies: { ...run.remedies, explainProgressAvailable: false } }
      : { ...run, orders: [{ ...customer, ...(change === 'customer-remedy' ? { remedy: 'explain-progress' as const }
        : { outcome: change === 'left' ? { status: 'left' as const, reason: 'patience' as const, leftAtMs: START }
          : { status: 'delivered' as const, taskId: 'card-delivered', deliveredAtMs: START, evaluation } }) }, ...run.orders.slice(1)] }
    showRun(changed)
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(line)).not.toBeInTheDocument()
    showRun(run)
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(line)).not.toBeInTheDocument()
  })

  it('immediately withdraws a displayed inspection warning when its draft is edited', () => {
    vi.useFakeTimers()
    let run = initial()
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    const draft = Object.values(run.drafts)[0]
    run = { ...run, drafts: { [draft.id]: { ...draft,
      inspections: [{ id: 'current-inspection', draftRevision: draft.revision, checkedAtMs: START, freeDemo: true, issues: [{ code: 'taboo-violated', label: 'taboo-violated' }] }],
    } } }
    showRun(run)
    const view = render(<ShiftScreen><p>台面</p></ShiftScreen>)
    const line = STORY_STAGES.tutorial.midShift.find(line => line.trigger === 'taboo_placed')!.text
    expect(screen.getByText(line)).toBeInTheDocument()
    showRun({ ...run, drafts: { [draft.id]: { ...run.drafts[draft.id], revision: draft.revision + 1 } } })
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(line)).not.toBeInTheDocument()
    showRun(run)
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(line)).not.toBeInTheDocument()
  })

  it('does not retarget a displayed inspection warning to another selected order', () => {
    vi.useFakeTimers()
    let run = initial()
    run = { ...run, orders: run.orders.map((order, index) => index < 2 ? { ...order, arrivalAtMs: START } : order) }
    for (const order of run.orders.slice(0, 2)) run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: order.id }, START)
    run = { ...run, selectedOrderId: run.orders[0].id, drafts: Object.fromEntries(Object.values(run.drafts).map(draft => [draft.id, { ...draft,
      inspections: [{ id: `${draft.id}:inspection`, draftRevision: draft.revision, checkedAtMs: START, freeDemo: true, issues: [{ code: 'taboo-violated', label: 'taboo-violated' }] }],
    }])) }
    showRun(run)
    const view = render(<ShiftScreen><p>台面</p></ShiftScreen>)
    const line = STORY_STAGES.tutorial.midShift.find(line => line.trigger === 'taboo_placed')!.text
    expect(screen.getByText(line)).toBeInTheDocument()
    showRun({ ...run, selectedOrderId: run.orders[1].id })
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(line)).not.toBeInTheDocument()
    showRun(run)
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(line)).not.toBeInTheDocument()
  })

  it.each(['answered', 'deadline', 'customer-left'] as const)('immediately withdraws a displayed puzzle reminder after %s', change => {
    vi.useFakeTimers()
    let run = initial()
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    run = { ...run, station: 'print', puzzles: { current: { id: 'current', shiftRunId: run.id, orderId: run.orders[0].id,
      intentId: 'intent', machineId: 'quick', attempt: 1, seed: 'puzzle', startedAtMs: START, deadlineAtMs: START + 1_000,
      definition: { kind: 'number-search', columns: 2, grid: [1, 2], target: 1, correctIndex: 0 }, result: { status: 'pending' },
    } } }
    showRun(run)
    const view = render(<ShiftScreen><p>台面</p></ShiftScreen>)
    const line = STORY_STAGES.tutorial.midShift.find(line => line.trigger === 'print_fast_math')!.text
    expect(screen.getByText(line)).toBeInTheDocument()
    const changed: ShiftRun = change === 'answered' ? { ...run, puzzles: { current: { ...run.puzzles.current,
      result: { status: 'succeeded', submittedAtMs: START, answer: { kind: 'number-search', index: 0 } },
    } } } : change === 'customer-left' ? { ...run, orders: [{ ...run.orders[0], outcome: { status: 'left', leftAtMs: START, reason: 'patience' } }, ...run.orders.slice(1)] } : run
    showRun(changed, change === 'deadline' ? START + 2_000 : START)
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(line)).not.toBeInTheDocument()
    showRun(run)
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(line)).not.toBeInTheDocument()
  })

  it('does not call an unfinished premium surface ready for the collection', () => {
    let run = initial()
    run = { ...run, orders: run.orders.slice(0, 3).map(order => ({ ...order, arrivalAtMs: START })) }
    for (const order of run.orders) run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: order.id }, START)
    const draft = Object.values(run.drafts)[0]
    showRun({ ...run, drafts: { ...run.drafts, [draft.id]: { ...draft, stage: 'crafting', activeCraft: null,
      design: { ...draft.design, preparation: { ...draft.design.preparation, surfaceFinishId: 'foil' } },
    } } })
    render(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(STORY_STAGES.tutorial.midShift.find(line => line.trigger === 'station_clogged')!.text)).not.toBeInTheDocument()
  })

  it('triggers brief story talk from live work, keeps the clock running, and remembers it across remounts', () => {
    vi.useFakeTimers()
    let run = initializeShift(AUTHORED_STAGES.beginner, 'midshift-run', START)
    showRun(run)
    const view = render(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByLabelText('店内闲话')).not.toBeInTheDocument()
    run = { ...run, orders: run.orders.map(order => ({ ...order, arrivalAtMs: START })) }
    showRun(run)
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    const line = STORY_STAGES.beginner.midShift.find(item => item.trigger === 'queue-grow')!
    expect(screen.getByLabelText('店内闲话')).toHaveTextContent(line.text)
    expect(dispatch).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    showRun(run, START + 5_000)
    view.rerender(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.getByLabelText('本班剩余时间')).toHaveTextContent('11:55')
    act(() => vi.advanceTimersByTime(8_000))
    expect(screen.queryByText(line.text)).not.toBeInTheDocument()
    view.unmount()
    render(<ShiftScreen><p>台面</p></ShiftScreen>)
    expect(screen.queryByText(line.text)).not.toBeInTheDocument()
  })

  it('separates preparation, assembly and public craft targets on a classified order ticket', () => {
    let run = initial()
    run = { ...run, orders: run.orders.map(order => ({ ...order, arrivalAtMs: START })) }
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[3].id }, START)
    showRun(run)
    render(<OrderTickets />)
    const ticket = screen.getByRole('button', { name: /千夜/ })
    expect(ticket).toHaveAttribute('aria-pressed', 'true')
    expect(within(ticket).getByText('复杂卡')).toBeInTheDocument()
    for (const label of ['备料', '组装', '工艺']) expect(within(ticket).getByText(label)).toBeInTheDocument()
    expect(ticket).toHaveTextContent('压力')
    expect(ticket).toHaveTextContent('位置')
  })

  it('exposes the selected production page to assistive technology', () => {
    const run = initial()
    const card = { kind: 'production-card' as const, version: 1 as const, id: 'card', shiftRunId: run.id,
      orderId: run.orders[0].id, draftId: 'draft', draftRevision: 1, savedAtMs: START,
      design: { version: 1 as const, preparation: run.orders[0].content.requirements, elements: [], crafts: [] } }
    render(<StampBookScreen cards={[]} productionCards={[card, { ...card, id: 'card-two' }]}
      onSelect={vi.fn()} onEdit={vi.fn()} onPrint={vi.fn()} onBack={vi.fn()} />)
    const first = screen.getByRole('button', { name: /值班纪念 01/ }), second = screen.getByRole('button', { name: /值班纪念 02/ })
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(second).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(second)
    expect(second).toHaveAttribute('aria-pressed', 'true')
    expect(first).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the existing best daily survival score on the title screen', () => {
    render(<TitleScreen progress={{ ...createInitialShiftProgression(), highestDailyScore: 87 }} hasSave={false} hydrated
      onStartStory={vi.fn()} onContinue={vi.fn()} onSurvival={vi.fn()} onFreeCreate={vi.fn()} />)
    expect(screen.getByText(/单日最高分.*87/)).toBeInTheDocument()
  })
})
