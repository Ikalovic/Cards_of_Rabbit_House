import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useShift, type ShiftContextValue } from '../app/ShiftProvider'
import { PrintStation } from '../components/stations/PrintStation'
import { AUTHORED_STAGES } from '../content/production'
import { advanceShift, initializeShift, transitionShift } from '../domain/shift-engine'
import type { ShiftRun } from '../domain/shift-types'

vi.mock('../app/ShiftProvider', () => ({ useShift: vi.fn() }))
const START = 1_000_000
const explain = (run: ShiftRun, orderId = run.orders[0].id, seconds = 0) => transitionShift(run,
  { station: 'reception', type: 'explain-progress', orderId }, START + seconds * 1000)
function initial() {
  const source = AUTHORED_STAGES.tutorial
  return initializeShift({ ...source, customers: source.customers.map((customer, index) => ({ ...customer,
    arrivalSeconds: index < 2 ? 0 : 200, basePatienceSeconds: 35, lastWaitSeconds: 20,
  })) }, 'progress-regression', START)
}
beforeEach(() => vi.clearAllMocks())

describe('progress explanation', () => {
  it('extends normal active patience immediately and grants exactly 25 seconds in total', () => {
    let run = initial()
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    run = explain(run, run.orders[0].id, 5)
    expect(run.orders[0].patience).toEqual({ phase: 'normal', depletesAtMs: START + 60_000,
      remainingSeconds: 55, updatedAtMs: START + 5_000 })
    const later = advanceShift(run, START + 60_000)
    expect(later.orders[0].patience).toEqual({ phase: 'last_wait', startedAtMs: START + 60_000,
      deadlineAtMs: START + 80_000, originalDurationSeconds: 20 })
    expect(advanceShift(run, START + 79_999).orders[0].outcome.status).toBe('pending')
    expect(advanceShift(run, START + 80_000).orders[0].outcome.status).toBe('left')
    expect(explain(run, run.orders[1].id, 5).orders[1].remedy).toBe('none')
  })

  it('extends a door customer by 25 wall seconds at the slower patience rate', () => {
    const run = explain(initial(), undefined, 5)
    expect(run.orders[0]).toMatchObject({ position: 'door_waiting', remedy: 'explain-progress',
      patience: { phase: 'normal', depletesAtMs: START + 125_000, remainingSeconds: 42, updatedAtMs: START + 5_000 } })
    const accepted = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START + 5_000)
    expect(accepted.orders[0].patience).toMatchObject({ phase: 'normal', depletesAtMs: START + 47_000, remainingSeconds: 42 })
  })

  it('extends current final wait once and rejects future and departed customers', () => {
    let run = initial()
    expect(explain(run, run.orders[2].id).remedies.explainProgressAvailable).toBe(true)
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    run = explain(run, run.orders[0].id, 40)
    expect(run.orders[0].patience).toMatchObject({ phase: 'last_wait', startedAtMs: START + 35_000,
      deadlineAtMs: START + 80_000, originalDurationSeconds: 20 })
    expect(explain(run, run.orders[0].id, 40)).toEqual(run)
    const departed = advanceShift(initial(), START + 150_000)
    expect(explain(departed, departed.orders[0].id, 150).remedies.explainProgressAvailable).toBe(true)
  })

  it('lets the counter target arrived door customers independently of the selected active order', () => {
    let run = initial()
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useShift).mockReturnValue({ run, displayNowMs: START, selectedOrderId: run.selectedOrderId,
      selectedOrder: run.orders[0], dispatch } as ShiftContextValue)
    render(<PrintStation />)
    const region = screen.getByRole('region', { name: '说明进度' })
    const selector = within(region).getByRole('combobox', { name: '选择说明进度的客人' })
    expect(within(selector).getAllByRole('option')).toHaveLength(2)
    expect(selector).toHaveValue(run.orders[0].id)
    fireEvent.change(selector, { target: { value: run.orders[1].id } })
    const button = within(region).getByRole('button', { name: `说明进度 · ${run.orders[1].content.customer.name}` })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(dispatch).toHaveBeenCalledWith({ station: 'reception', type: 'explain-progress', orderId: run.orders[1].id })
    expect(run.selectedOrderId).toBe(run.orders[0].id)
  })
})
