import { act, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ShiftProvider, useShift, type ShiftContextValue, type ShiftStore } from '../app/ShiftProvider'
import { PuzzlePanel } from '../components/PuzzlePanel'
import { AUTHORED_STAGES } from '../content/production'
import { InMemoryPrintShop } from '../domain/gateways'
import { initializeShift, transitionShift, type ShiftEngineAction } from '../domain/shift-engine'
import type { PuzzleAnswer, PuzzleInstance, ShiftRun, ShiftSnapshot } from '../domain/shift-types'
import { beginServerPuzzle, exitServerPuzzle, revealServerPuzzle, submitServerPuzzle, type PuzzleReply } from '../infrastructure/puzzle-api'

vi.mock('../infrastructure/puzzle-api', () => ({
  beginServerPuzzle: vi.fn(), submitServerPuzzle: vi.fn(), revealServerPuzzle: vi.fn(), exitServerPuzzle: vi.fn(),
}))

const START = 1_000_000
const INTENT = 'remote-calibration'
let context: ShiftContextValue

function Probe() {
  context = useShift()
  const puzzle = Object.values(context.run?.puzzles ?? {}).find(candidate => candidate.result.status === 'pending')
  return puzzle ? <PuzzlePanel puzzle={puzzle} nowMs={context.displayNowMs}
    onReveal={index => { void context.revealPuzzle(puzzle.id, index) }}
    onSubmit={answer => { void context.dispatch({ station: 'print', type: 'submit-puzzle', puzzleId: puzzle.id, answer }) }}
    onExit={() => { void context.dispatch({ station: 'print', type: 'exit-puzzle', puzzleId: puzzle.id }) }} /> : null
}

function confirmedRun(): ShiftRun {
  const stage = AUTHORED_STAGES.tutorial
  let run = initializeShift(stage, 'remote-puzzle-run', START)
  const apply = (action: ShiftEngineAction) => { run = transitionShift(run, action, START) }
  const order = stage.customers[0]
  apply({ station: 'reception', type: 'accept-order', orderId: order.id })
  const draft = Object.values(run.drafts)[0]
  apply({ station: 'preparation', type: 'select-preparation', draftId: draft.id, selection: order.order.requirements })
  apply({ station: 'preparation', type: 'cut-blank', draftId: draft.id })
  apply({ station: 'assembly', type: 'fix-assembly', draftId: draft.id })
  apply({ station: 'inspection', type: 'inspect', draftId: draft.id, freeDemo: false })
  apply({ station: 'print', type: 'archive', draftId: draft.id, snapshotId: 'remote-card' })
  apply({ type: 'switch-station', station: 'print' })
  apply({ station: 'print', type: 'confirm-print', snapshotId: 'remote-card', intentId: INTENT, machineId: 'fine' })
  expect(run.authorizations[INTENT]?.status).toBe('confirmed')
  expect(run.inspectionTimeOffsetMs).toBe(5000)
  return run
}

it('connects remote begin, reveal and submit to the provider and restores the same pending puzzle on reload', async () => {
  const run = confirmedRun()
  let saved: ShiftSnapshot = { version: 1, revision: 1, savedAtMs: START, run }
  const save = vi.fn(async (snapshot: ShiftSnapshot) => { saved = structuredClone(snapshot); return structuredClone(saved) })
  const store: ShiftStore = {
    inspectCurrent: vi.fn(async () => ({ status: 'valid' as const, snapshot: structuredClone(saved) })),
    loadCurrent: vi.fn(async () => structuredClone(saved)),
    saveCurrent: save, saveArchive: save,
    recoverPendingPrint: vi.fn(async () => undefined),
    listReconciliations: vi.fn(async () => []),
    saveReconciliation: vi.fn(async snapshot => snapshot),
    finalizeReconciliation: vi.fn(async () => {}),
  }
  let wallNow = START
  const now = () => wallNow
  const gateway = new InMemoryPrintShop()
  const tree = () => <ShiftProvider stage={run.stage} runId={run.id} now={now} scheduleTick={null} store={store} gateway={gateway}><Probe /></ShiftProvider>
  let view = render(tree())
  await waitFor(() => expect(context.status).toBe('ready'))

  const puzzle: PuzzleInstance = {
    id: 'remote-public-puzzle', shiftRunId: run.id, orderId: run.selectedOrderId!, intentId: INTENT, machineId: 'fine', attempt: 1,
    startedAtMs: START + 6500, deadlineAtMs: START + 66_500, result: { status: 'pending' },
    definition: { kind: 'minesweeper', rows: 3, columns: 4, mineCount: 2,
      revealedCells: [1, 4, 5, 6, 7, 8, 9, 10, 11].map(index => ({ index, clue: index < 8 ? 1 : 0 })) },
  }
  let respond!: (reply: PuzzleReply) => void
  vi.mocked(beginServerPuzzle).mockReturnValue(new Promise(resolve => { respond = resolve }))
  let beginning!: Promise<void>
  act(() => { beginning = context.dispatch({ station: 'print', type: 'begin-calibration', intentId: INTENT, machineId: 'fine' }) })
  await waitFor(() => expect(beginServerPuzzle).toHaveBeenCalledExactlyOnceWith(run.id, INTENT, 'fine'))
  // The response arrives after its server start time. The provider must subtract the
  // persisted inspection cost before passing that start time to the engine.
  wallNow = START + 4500
  await act(async () => { respond({ puzzle, serverNowMs: START + 1500 }); await beginning })
  expect(context.run!.puzzles[puzzle.id]).toEqual(puzzle)
  expect(context.run!.lastProcessedAtMs).toBe(puzzle.startedAtMs)
  expect(context.run!.authorizations[INTENT].status).toBe('calibrating')
  expect(screen.getByRole('region', { name: '微型扫雷' })).toBeInTheDocument()

  const revealed: PuzzleInstance = { ...puzzle, definition: { ...puzzle.definition as Extract<PuzzleInstance['definition'], { kind: 'minesweeper' }>,
    revealedCells: [...(puzzle.definition as Extract<PuzzleInstance['definition'], { kind: 'minesweeper' }>).revealedCells, { index: 2, clue: 1 }] } }
  vi.mocked(revealServerPuzzle).mockResolvedValue({ puzzle: revealed, serverNowMs: START + 5000 })
  await act(async () => { await context.revealPuzzle(puzzle.id, 2) })
  expect(revealServerPuzzle).toHaveBeenCalledExactlyOnceWith(puzzle.id, 2)
  expect(screen.getByRole('button', { name: '第 1 行第 3 列，周围 1 颗雷' })).toHaveTextContent('1')
  expect(saved.run.puzzles[puzzle.id]).toEqual(revealed)

  view.unmount()
  view = render(tree())
  await waitFor(() => expect(context.status).toBe('ready'))
  expect(context.origin).toBe('resumed')
  expect(context.run!.puzzles[puzzle.id]).toEqual(revealed)
  expect(screen.getByRole('region', { name: '微型扫雷' })).toBeInTheDocument()
  expect(beginServerPuzzle).toHaveBeenCalledTimes(1)

  const answer: PuzzleAnswer = { kind: 'minesweeper', revealedIndices: [1, 2, 4, 5, 6, 7, 8, 9, 10, 11], flaggedIndices: [0, 3] }
  const result = { status: 'succeeded' as const, submittedAtMs: START + 11_000, answer }
  vi.mocked(submitServerPuzzle).mockResolvedValue({ result, serverNowMs: START + 6000 })
  await act(async () => { await context.dispatch({ station: 'print', type: 'submit-puzzle', puzzleId: puzzle.id, answer }) })
  expect(submitServerPuzzle).toHaveBeenCalledExactlyOnceWith(puzzle.id, answer)
  expect(context.run!.puzzles[puzzle.id].result).toEqual(result)
  expect(context.run!.authorizations[INTENT].status).toBe('calibrated_pending_start')
  expect(saved.run.authorizations[INTENT].status).toBe('calibrated_pending_start')
  expect(exitServerPuzzle).not.toHaveBeenCalled()
  view.unmount()
})
