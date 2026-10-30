import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTHORED_STAGES } from '../content/production'
import { initializeShift } from '../domain/shift-engine'
import type { PuzzleInstance, ShiftRun } from '../domain/shift-types'
import { ShiftSoundFeedback } from '../components/ShiftSoundFeedback'

const audio = vi.hoisted(() => ({
  playSfx: vi.fn(), setLoop: vi.fn(), stopEffects: vi.fn(),
  preferences: { muted: false, musicVolume: .3, effectsVolume: .65 },
}))
vi.mock('../app/AudioProvider', () => ({ useAudio: () => audio }))
const START = 1_000_000
const initial = () => initializeShift(AUTHORED_STAGES.tutorial, 'sound-run', START)

function completedPuzzle(run: ShiftRun, status: 'succeeded' | 'failed'): PuzzleInstance {
  return { id: status, shiftRunId: run.id, orderId: run.orders[0].id, intentId: 'intent', machineId: 'quick',
    attempt: 1, seed: 'sound', startedAtMs: START, deadlineAtMs: START + 10_000,
    definition: { kind: 'number-search', columns: 2, grid: [1, 2], target: 1, correctIndex: 0 },
    result: status === 'succeeded' ? { status, submittedAtMs: START, answer: { kind: 'number-search', index: 0 } }
      : { status, failedAtMs: START, reason: 'timeout', answer: null },
  }
}
function eventRun(run: ShiftRun, event: string): ShiftRun {
  if (event === 'machine') return { ...run, tasks: { ready: { id: 'ready', shiftRunId: run.id,
    intentId: 'intent', snapshotId: 'snapshot', orderId: run.orders[0].id, machineId: 'quick',
    createdAtMs: START, durationMs: 45_000, expedited: false, status: 'ready', readyAtMs: START,
  } } }
  if (event === 'patience') return { ...run, orders: [{ ...run.orders[0],
    patience: { phase: 'last_wait', startedAtMs: START, deadlineAtMs: START + 30_000, originalDurationSeconds: 30 },
  }, ...run.orders.slice(1)] }
  return { ...run, puzzles: { finished: completedPuzzle(run, event === 'success' ? 'succeeded' : 'failed') } }
}

beforeEach(() => {
  vi.clearAllMocks()
  audio.preferences.muted = false
  audio.preferences.effectsVolume = .65
})

describe('downloaded shift sound feedback', () => {
  it.each([
    ['machine', 'machine_ready'], ['patience', 'patience_warning'],
    ['success', 'puzzle_success'], ['failure', 'puzzle_failure'],
  ])('plays the %s event once and never repeats it on render', (event, sound) => {
    const run = initial(), view = render(<ShiftSoundFeedback run={run} />)
    expect(audio.playSfx).not.toHaveBeenCalled()
    const changed = eventRun(run, event)
    view.rerender(<ShiftSoundFeedback run={changed} />)
    expect(audio.playSfx).toHaveBeenCalledWith(sound)
    const count = audio.playSfx.mock.calls.length
    view.rerender(<ShiftSoundFeedback run={changed} />)
    expect(audio.playSfx).toHaveBeenCalledTimes(count)
  })

  it('does not replay restored events or events observed while muted', () => {
    const restored = eventRun(initial(), 'machine')
    const view = render(<ShiftSoundFeedback run={restored} />)
    expect(audio.playSfx).not.toHaveBeenCalled()
    audio.preferences.muted = true
    const changed = eventRun(restored, 'patience')
    view.rerender(<ShiftSoundFeedback run={changed} />)
    audio.preferences.muted = false
    view.rerender(<ShiftSoundFeedback run={changed} />)
    expect(audio.playSfx).not.toHaveBeenCalled()
  })

  it('follows actual printing across stations and stops the loop on unmount', () => {
    const run = initial(), view = render(<ShiftSoundFeedback run={run} />)
    const ready = eventRun(run, 'machine').tasks.ready
    const printing: ShiftRun = { ...run, tasks: { print: { ...ready, status: 'printing', startedAtMs: START, completesAtMs: START + 45_000 } } }
    view.rerender(<ShiftSoundFeedback run={printing} />)
    expect(audio.setLoop).toHaveBeenLastCalledWith('printer_loop')
    view.rerender(<ShiftSoundFeedback run={{ ...printing, station: 'assembly' }} />)
    expect(audio.setLoop).toHaveBeenLastCalledWith('printer_loop')
    view.unmount()
    expect(audio.setLoop).toHaveBeenLastCalledWith(null)
  })

  it('consumes background catch-up events but still plays genuinely new events', () => {
    const run = initial(), view = render(<ShiftSoundFeedback run={run} />)
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(START + 10_000)
    try {
      visibility.mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      visibility.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      const caughtUp = eventRun(run, 'machine')
      view.rerender(<ShiftSoundFeedback run={caughtUp} />)
      expect(audio.playSfx).not.toHaveBeenCalled()
      const warning = eventRun(caughtUp, 'patience')
      const current: ShiftRun = { ...warning, orders: [{ ...warning.orders[0], patience: {
        phase: 'last_wait', startedAtMs: START + 11_000, deadlineAtMs: START + 41_000, originalDurationSeconds: 30,
      } }, ...warning.orders.slice(1)] }
      view.rerender(<ShiftSoundFeedback run={current} />)
      expect(audio.playSfx).toHaveBeenCalledWith('patience_warning')
    } finally { visibility.mockRestore(); clock.mockRestore() }
  })
})
