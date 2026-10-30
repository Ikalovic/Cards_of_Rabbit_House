import { describe, expect, it } from 'vitest'
import { MATH_QUESTION_BANK } from '../../server/math-questions'
import { AUTHORED_STAGES, LAYOUTS } from '../content/production'
import { createPuzzle, gradePuzzle, toPublicPuzzle } from '../../server/puzzles'
import type { PrivatePuzzleInstance } from '../../server/private-puzzle-types'
import { advanceShift, initializeShift, transitionShift, type ShiftPuzzleServices } from '../domain/shift-engine'
import type {
  AuthoredStageId, CraftMeasurements, MachineId, PrintReceipt, PuzzleAnswer,
  ShiftAction, ShiftRun,
} from '../domain/shift-types'

const START = 1_000_000
const at = (seconds: number) => START + seconds * 1000

type RouteOrder = Readonly<{
  accept: number
  assembled: number
  calibrate: number
  deliver: number
  machine: MachineId
  inspect?: boolean
  expedite?: boolean
  puzzle?: 'sudoku' | 'math'
}>

// Section 11.4's manual-work budgets are 45/50/50/130/50 seconds:
// preparation + the actual generated puzzle limit + 5 seconds for handoff;
// order 4 additionally spends 5 seconds on inspection. Printing and waiting
// are separate, and both printers can work while the player makes another card.
const TUTORIAL_ROUTE: readonly RouteOrder[] = [
  { accept: 0, assembled: 26, calibrate: 26, deliver: 140, machine: 'quick' },
  { accept: 55, assembled: 94, calibrate: 94, deliver: 210, machine: 'quick' },
  { accept: 130, assembled: 166, calibrate: 166, deliver: 270, machine: 'quick' },
  { accept: 210, assembled: 250, inspect: true, calibrate: 270, deliver: 460, machine: 'fine', puzzle: 'sudoku' },
  { accept: 350, assembled: 386, calibrate: 386, deliver: 480, machine: 'quick' },
]

const BEGINNER_ROUTE: readonly RouteOrder[] = [
  { accept: 0, assembled: 34, calibrate: 34, deliver: 95, machine: 'quick' },
  { accept: 45, assembled: 83, calibrate: 83, deliver: 140, machine: 'quick' },
  { accept: 105, assembled: 145, inspect: true, calibrate: 150, deliver: 320, machine: 'fine', puzzle: 'sudoku' },
  { accept: 226, assembled: 265, calibrate: 265, deliver: 325, machine: 'quick' },
  { accept: 325, assembled: 365, inspect: true, calibrate: 370, deliver: 495, machine: 'fine', puzzle: 'math', expedite: true },
  { accept: 445, assembled: 482, calibrate: 482, deliver: 540, machine: 'quick' },
]

const STORY_ROUTE: readonly RouteOrder[] = [
  { accept: 0, assembled: 33, calibrate: 33, deliver: 95, machine: 'quick' },
  { accept: 45, assembled: 85, inspect: true, calibrate: 95, deliver: 305, machine: 'fine', puzzle: 'math' },
  { accept: 155, assembled: 252, calibrate: 252, deliver: 310, machine: 'quick' },
  { accept: 260, assembled: 326, inspect: true, calibrate: 331, deliver: 485, machine: 'fine', puzzle: 'sudoku' },
  { accept: 395, assembled: 431, calibrate: 431, deliver: 490, machine: 'quick' },
  { accept: 440, assembled: 477, calibrate: 477, deliver: 530, machine: 'quick' },
  { accept: 490, assembled: 514, calibrate: 514, deliver: 590, machine: 'quick' },
]

function correctAnswer({ definition }: PrivatePuzzleInstance): PuzzleAnswer {
  switch (definition.kind) {
    case 'number-search': return { kind: definition.kind, index: definition.correctIndex }
    case 'connect': return { kind: definition.kind, path: definition.correctPath }
    case 'identify': return { kind: definition.kind, optionId: definition.correctOptionId }
    case 'sudoku': return { kind: definition.kind, cells: definition.solution }
    case 'minesweeper': return {
      kind: definition.kind, flaggedIndices: definition.mineIndices,
      revealedIndices: Array.from({ length: definition.rows * definition.columns }, (_, index) => index)
        .filter(index => !definition.mineIndices.includes(index)),
    }
    case 'math-choice': return { kind: definition.kind, optionIds: definition.correctOptionIds }
    case 'math-fill': return { kind: definition.kind, text: definition.acceptedAnswers[0] }
  }
}

/** The only writes to business state are the three public engine entry points. */
function playRoute(stageId: AuthoredStageId, route: readonly RouteOrder[], mistakeSeconds = 0): ShiftRun {
  const stage = AUTHORED_STAGES[stageId]
  let run = initializeShift(stage, `authored-route:${stageId}:${mistakeSeconds}`, START)
  const events: { seconds: number; priority: number; perform: () => void }[] = []
  // Route times and puzzle deadlines use operating time; public engine calls
  // take wall time and add the accumulated inspection cost themselves.
  const wallAt = (seconds: number) => at(seconds) - (run.inspectionTimeOffsetMs ?? 0)
  // Stand in for the print service: the engine only sees public puzzles, while
  // the route keeps the private answers to grade them like the server would.
  const privatePuzzles = new Map<string, PrivatePuzzleInstance>()
  const services: ShiftPuzzleServices = {
    createPuzzle: (input) => {
      const instance = createPuzzle(input)
      privatePuzzles.set(instance.id, instance)
      return toPublicPuzzle(instance)
    },
    gradePuzzle: (instance, answer, submittedAtMs) => gradePuzzle(privatePuzzles.get(instance.id)!, answer, submittedAtMs),
  }
  const dispatch = (action: ShiftAction, seconds: number) => { run = transitionShift(run, action, wallAt(seconds), services) }
  const schedule = (seconds: number, priority: number, perform: () => void) => events.push({ seconds, priority, perform })
  const customer = (id: string) => run.orders.find(order => order.id === id)!
  const draft = (id: string) => Object.values(run.drafts).find(draft => draft.orderId === id)!
  const focus = (id: string, station: 'preparation' | 'assembly' | 'craft' | 'inspection' | 'print', seconds: number) => {
    dispatch({ type: 'select-order', orderId: id }, seconds)
    dispatch({ type: 'switch-station', station }, seconds)
    expect(run.selectedOrderId).toBe(id)
    expect(run.station).toBe(station)
  }

  expect(MATH_QUESTION_BANK).toHaveLength(41)
  expect(route).toHaveLength(stage.customers.length)

  if (mistakeSeconds) {
    // Accept customer 1 at zero, then lose 120 real operating seconds. This is
    // deliberately not a controlled pause: arrivals, patience and closing run on.
    schedule(mistakeSeconds, 5, () => {
      expect(run.status).toBe('running')
      expect(customer(stage.customers[0].id).patience).toMatchObject({
        phase: 'normal', remainingSeconds: stage.customers[0].basePatienceSeconds - mistakeSeconds,
      })
      expect(run.orders.map(order => order.arrivalAtMs)).toEqual(stage.customers.map(order => at(order.arrivalSeconds)))
      expect(run.deadlineAtMs).toBe(at(720))
      expect(run.pauses).toEqual([])
    })
  }

  route.forEach((plan, index) => {
    const id = stage.customers[index].id
    const snapshotId = `snapshot:${id}`
    const intentId = `intent:${id}`
    const taskId = `task:${id}`
    const acceptAt = index === 0 ? plan.accept : plan.accept + mistakeSeconds
    const assembledAt = plan.assembled + mistakeSeconds
    const calibrateAt = plan.calibrate + mistakeSeconds
    const deliverAt = plan.deliver + mistakeSeconds

    schedule(acceptAt, 20, () => {
      dispatch({ type: 'switch-station', station: 'reception' }, acceptAt)
      dispatch({ station: 'reception', type: 'accept-order', orderId: id }, acceptAt)
      expect(customer(id).acceptedAtMs, `accept ${id}`).toBe(at(acceptAt))
      expect(run.activeOrderIds).toContain(id)
      expect(run.activeOrderIds.length).toBeLessThanOrEqual(3)
    })

    schedule(assembledAt, 30, () => {
      const requirements = customer(id).content.requirements
      const { paperId, paperMaterialId, shapeId, orientation, layoutId, surfaceFinishId } = requirements
      focus(id, 'preparation', assembledAt)
      dispatch({ station: 'preparation', type: 'select-preparation', draftId: draft(id).id,
        selection: { paperId, paperMaterialId, shapeId, orientation, layoutId, surfaceFinishId } }, assembledAt)
      dispatch({ station: 'preparation', type: 'cut-blank', draftId: draft(id).id }, assembledAt)
      expect(draft(id).stage).toBe('assembling')
      focus(id, 'assembly', assembledAt)
      const layout = LAYOUTS.find(layout => layout.id === layoutId)!
      const occupied = new Set<string>()
      for (const requirement of requirements.elements) {
        for (let unit = 0; unit < requirement.quantity; unit++) {
          const slot = layout.slots.find(slot => slot.accepts.includes(requirement.kind) && !occupied.has(slot.id))!
          expect(slot, `compatible slot for ${id}/${requirement.id}`).toBeDefined()
          occupied.add(slot.id)
          dispatch({ station: 'assembly', type: 'place-element', draftId: draft(id).id, element: {
            id: `${requirement.id}:${unit}`, assetId: requirement.assetId, kind: requirement.kind,
            slotId: slot.id, size: slot.sizes[0], direction: 'upright', layer: 'front',
          } }, assembledAt)
        }
      }
      dispatch({ station: 'assembly', type: 'fix-assembly', draftId: draft(id).id }, assembledAt)
      expect(draft(id).stage).toBe('crafting')
      for (const craft of requirements.crafts) {
        focus(id, 'craft', assembledAt)
        const measurements: CraftMeasurements = Object.fromEntries(Object.entries(craft.targets)
          .map(([dimension, target]) => [dimension, (target.min + target.max) / 2]))
        dispatch({ station: 'craft', type: 'select-craft', draftId: draft(id).id, craftId: craft.id,
          operationId: `craft:${id}:${craft.id}`, discrete: craft.discrete }, assembledAt)
        dispatch({ station: 'craft', type: 'begin-craft', draftId: draft(id).id, craftId: craft.id }, assembledAt)
        dispatch({ station: 'craft', type: 'finish-craft', draftId: draft(id).id, craftId: craft.id,
          measurements, discrete: craft.discrete }, assembledAt)
        expect(draft(id).design.crafts).toContainEqual(expect.objectContaining({
          requirementId: craft.id, kind: craft.kind, measurements, discrete: craft.discrete,
        }))
      }
      if (plan.inspect) {
        focus(id, 'inspection', assembledAt)
        dispatch({ station: 'inspection', type: 'inspect', draftId: draft(id).id, freeDemo: false }, assembledAt)
        expect(run.lastProcessedAtMs).toBe(at(assembledAt + 5))
        expect(draft(id).inspections).toHaveLength(1)
        expect(draft(id).inspections[0].issues).toEqual([])
      }
    })

    schedule(calibrateAt, 40, () => {
      focus(id, 'print', calibrateAt)
      dispatch({ station: 'print', type: 'archive', draftId: draft(id).id, snapshotId }, calibrateAt)
      expect(draft(id).stage, `archive ${id}`).toBe('archived')
      expect(run.snapshots[snapshotId].design).toEqual(draft(id).design)
      dispatch({ station: 'print', type: 'confirm-print', snapshotId, intentId, machineId: plan.machine }, calibrateAt)
      expect(run.authorizations[intentId].status).toBe('confirmed')
      dispatch({ station: 'print', type: 'begin-calibration', intentId, machineId: plan.machine }, calibrateAt)
      const authorization = run.authorizations[intentId]
      expect(authorization.status, `begin calibration ${id}`).toBe('calibrating')
      if (authorization.status !== 'calibrating') throw new Error(`No calibration for ${id}`)
      const puzzle = run.puzzles[authorization.puzzleId]
      expect(puzzle.result.status).toBe('pending')
      expect(puzzle.machineId).toBe(plan.machine)
      if (plan.puzzle === 'sudoku') expect(puzzle.definition.kind).toBe('sudoku')
      if (plan.puzzle === 'math') {
        expect(['math-choice', 'math-fill']).toContain(puzzle.definition.kind)
        expect(MATH_QUESTION_BANK).toContainEqual(privatePuzzles.get(puzzle.id)!.definition)
      }

      // Use the persisted, final definition and its full real time limit, even
      // for mathematics. Never synthesize a success or replace a puzzle.
      const submitAt = (puzzle.deadlineAtMs - START) / 1000
      schedule(submitAt, 0, () => {
        expect(run.selectedOrderId).toBe(id)
        expect(run.station).toBe('print')
        expect(run.puzzles[puzzle.id].result.status, `uninterrupted calibration ${id}`).toBe('pending')
        const answer = correctAnswer(privatePuzzles.get(puzzle.id)!)
        dispatch({ station: 'print', type: 'submit-puzzle', puzzleId: puzzle.id, answer }, submitAt)
        expect(run.puzzles[puzzle.id].result).toEqual({ status: 'succeeded', submittedAtMs: at(submitAt), answer })
        expect(run.authorizations[intentId].status).toBe('calibrated_pending_start')
        const receipt: PrintReceipt = {
          receiptId: `receipt:${id}`, intentId, snapshotId, machineId: plan.machine,
          shiftRunId: run.id, receivedAtMs: at(submitAt), authority: 'local', details: null,
          status: 'accepted', taskId,
        }
        dispatch({ station: 'print', type: 'record-receipt', receipt }, submitAt)
        expect(run.authorizations[intentId]).toMatchObject({ status: 'bound', taskId, receipt })
        expect(run.tasks[taskId]).toMatchObject({ status: 'printing', orderId: id, machineId: plan.machine })
        if (plan.machine === 'fine') expect(run.tasks[taskId].durationMs).toBe(85_000)
        if (plan.expedite) {
          dispatch({ station: 'print', type: 'expedite', taskId }, submitAt)
          expect(run.tasks[taskId]).toMatchObject({ expedited: true, durationMs: 42_500 })
          expect(customer(id).remedy).toBe('expedite')
        }
      })
    })

    schedule(deliverAt, 10, () => {
      expect(customer(id).outcome.status, `still waiting for ${id}`).toBe('pending')
      expect(run.tasks[taskId].status, `printed before handing over ${id}`).toBe('ready')
      focus(id, 'print', deliverAt)
      dispatch({ station: 'print', type: 'deliver', taskId }, deliverAt)
      expect(customer(id).outcome).toMatchObject({ status: 'delivered', deliveredAtMs: at(deliverAt),
        evaluation: { satisfied: true, missingRequiredIds: [], tabooViolated: false } })
      expect(run.tasks[taskId]).toMatchObject({ status: 'delivered', deliveredAtMs: at(deliverAt) })
    })
  })

  while (events.length) {
    // Answer first at an exact deadline, then hand over ready work before
    // accepting another customer or changing the station in the same second.
    events.sort((a, b) => a.seconds - b.seconds || a.priority - b.priority)
    const event = events.shift()!
    expect(at(event.seconds), 'route actions must not travel backwards').toBeGreaterThanOrEqual(run.lastProcessedAtMs)
    run = advanceShift(run, wallAt(event.seconds))
    event.perform()
  }

  expect(run.status).toBe('running')
  expect(run.stage).toEqual(stage)
  expect(run.deadlineAtMs).toBe(at(720))
  expect(run.pauses).toEqual([])
  expect(Object.values(run.puzzles)).toHaveLength(route.length)
  expect(Object.values(run.puzzles).every(puzzle => puzzle.result.status === 'succeeded')).toBe(true)
  return run
}

function expectSuccessfulClosing(run: ShiftRun, deliveries: readonly number[]) {
  const deliveredAt = run.orders.map(order => {
    expect(order.outcome.status).toBe('delivered')
    if (order.outcome.status !== 'delivered') throw new Error(`Undelivered ${order.id}`)
    return (order.outcome.deliveredAtMs - START) / 1000
  })
  expect(deliveredAt).toEqual(deliveries)
  expect(Math.max(...deliveredAt)).toBe(deliveries.at(-1))
  expect(run.lastProcessedAtMs).toBe(at(deliveries.at(-1)!))
  const settled = advanceShift(run, at(720) - (run.inspectionTimeOffsetMs ?? 0))
  expect(settled.status).toBe('settled')
  if (settled.status !== 'settled') throw new Error('Shift did not settle')
  expect(settled.result).toMatchObject({ closedAtMs: at(720), delivered: deliveries.length,
    satisfied: deliveries.length, left: 0, passed: true, failureReasons: [] })
}

describe('authored routes with final production content (specification 11.4)', () => {
  it('delivers all tutorial cards by 140/210/270/460/480 using the full generated puzzle limits', () => {
    const run = playRoute('tutorial', TUTORIAL_ROUTE)
    const manualBudgets = run.orders.map((order, index) => {
      const puzzle = Object.values(run.puzzles).find(puzzle => puzzle.orderId === order.id)!
      return TUTORIAL_ROUTE[index].assembled - TUTORIAL_ROUTE[index].accept
        + (puzzle.deadlineAtMs - puzzle.startedAtMs) / 1000 + (TUTORIAL_ROUTE[index].inspect ? 5 : 0) + 5
    })
    expect(manualBudgets).toEqual([45, 50, 50, 130, 50])
    expectSuccessfulClosing(run, [140, 210, 270, 460, 480])
  })

  it('still passes at 260/330/390/580/600 after losing 120 operating seconds following first acceptance', () => {
    const run = playRoute('tutorial', TUTORIAL_ROUTE, 120)
    const deliveries = [260, 330, 390, 580, 600]
    const earliestDepartures = [315, 430, 480, 620, 630]
    deliveries.forEach((seconds, index) => expect(seconds).toBeLessThan(earliestDepartures[index]))
    expect((run.deadlineAtMs - run.lastProcessedAtMs) / 1000).toBe(120)
    expectSuccessfulClosing(run, deliveries)
  })

  it('passes beginner at 95/140/320/325/495/540 with order 3 sudoku and expedited order 5 bank mathematics', () => {
    const run = playRoute('beginner', BEGINNER_ROUTE)
    expect(Object.values(run.tasks).filter(task => task.expedited).map(task => task.orderId)).toEqual(['beginner:customer:5'])
    expectSuccessfulClosing(run, [95, 140, 320, 325, 495, 540])
  })

  it('passes story at 95/305/310/485/490/530/590 with bank mathematics, sudoku and both 85-second fine prints', () => {
    const run = playRoute('story', STORY_ROUTE)
    const fineTasks = Object.values(run.tasks).filter(task => task.machineId === 'fine')
    expect(fineTasks.map(task => [task.orderId, task.durationMs])).toEqual([
      ['story:customer:2', 85_000], ['story:customer:4', 85_000],
    ])
    expectSuccessfulClosing(run, [95, 305, 310, 485, 490, 530, 590])
  })
})
