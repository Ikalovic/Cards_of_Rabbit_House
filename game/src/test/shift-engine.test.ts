import { describe, expect, expectTypeOf, it } from 'vitest'
import { AUTHORED_STAGES, generateSurvivalStage, ORDER_TEMPLATES } from '../content/production'
import { MATH_QUESTION_BANK } from '../../server/math-questions'
import { createPuzzle } from '../../server/puzzles'
import { advanceShift, finishClosedShiftPrints, initializeShift, transitionShift } from '../domain/shift-engine'
import type { ShiftEngineAction } from '../domain/shift-engine'
import type { AuthoredStageDefinition, MachineId, PlacedElement, PreparationSelection, PrintReceipt, PuzzleAnswer, PuzzleInstance, ShiftAction, ShiftRun } from '../domain/shift-types'

const START = 1_000_000
function stage(count = 5, patience = 35, arrival = 0): AuthoredStageDefinition {
  const source = AUTHORED_STAGES.tutorial
  return { ...source, customers: Array.from({ length: count }, (_, i) => ({ ...source.customers[0], id: `o${i}`, arrivalSeconds: arrival, basePatienceSeconds: patience, lastWaitSeconds: 20 })) }
}
function fresh(definition = stage()): ShiftRun { return initializeShift(definition, 'run', START) }
function act(run: ShiftRun, action: ShiftEngineAction, seconds = 0): ShiftRun {
  return transitionShift(run, action, START + seconds * 1000)
}
function accept(run: ShiftRun, id = 'o0', seconds = 0): ShiftRun {
  return act(run, { station: 'reception', type: 'accept-order', orderId: id }, seconds)
}
function order(run: ShiftRun, id = 'o0') { return run.orders.find((customer) => customer.id === id)! }
function draftId(run: ShiftRun, id = 'o0') { return Object.values(run.drafts).filter((draft) => draft.orderId === id).sort((a, b) => b.revision - a.revision)[0].id }
function prepare(run: ShiftRun, selection: Partial<PreparationSelection>, id = 'o0', seconds = 0) {
  return act(run, { station: 'preparation', type: 'select-preparation', draftId: draftId(run, id), selection }, seconds)
}
function archive(run: ShiftRun, snapshotId = 'snap', id = 'o0', seconds = 0) {
  return act(run, { station: 'print', type: 'archive', draftId: draftId(run, id), snapshotId }, seconds)
}
function checkLedger(run: ShiftRun) {
  for (const [id, stock] of Object.entries(run.materials.stock)) {
    expect(stock.available).toBeGreaterThanOrEqual(0)
    expect(stock.reserved).toBeGreaterThanOrEqual(0)
    expect(stock.consumed).toBeGreaterThanOrEqual(0)
    expect(stock.available + stock.reserved + stock.consumed).toBe(run.stage.inventory[id as keyof typeof run.stage.inventory])
  }
}
function confirm(run: ShiftRun, intentId: string, machineId: MachineId = 'quick', id = 'o0', seconds = 0) {
  let snapshot = Object.values(run.snapshots).find((snapshot) => snapshot.orderId === id)
  if (!snapshot) {
    run = archive(run, `${id}:snapshot`, id, seconds)
    snapshot = run.snapshots[`${id}:snapshot`]
  }
  return act({ ...run, station: 'print', selectedOrderId: id }, { station: 'print', type: 'confirm-print', intentId, snapshotId: snapshot.id, machineId }, seconds)
}
function puzzleFor(run: ShiftRun, intentId: string, machineId: MachineId, seconds = 0): PuzzleInstance {
  const auth = run.authorizations[intentId]
  return createPuzzle({ shiftSeed: run.seed, shiftRunId: run.id, orderId: auth.orderId, intentId, machineId,
    attempt: auth.nextAttempt, startedAtMs: START + seconds * 1000,
    difficulty: run.stage.kind === 'survival' ? run.stage.hardPuzzleWeight : run.stage.puzzleDifficulty,
    calibrationKind: run.stage.customers.find((customer) => customer.id === auth.orderId)?.calibrationPlan?.[machineId] })
}
function puzzle(run: ShiftRun, intentId: string, attempt = 1): PuzzleInstance {
  return Object.values(run.puzzles).find((instance) => instance.intentId === intentId && instance.attempt === attempt)!
}
function answerFor(instance: PuzzleInstance): PuzzleAnswer {
  const definition = instance.definition
  switch (definition.kind) {
    case 'number-search': return { kind: definition.kind, index: definition.correctIndex }
    case 'connect': return { kind: definition.kind, path: definition.correctPath }
    case 'identify': return { kind: definition.kind, optionId: definition.correctOptionId }
    case 'sudoku': return { kind: definition.kind, cells: definition.solution }
    case 'minesweeper': return { kind: definition.kind, flaggedIndices: definition.mineIndices,
      revealedIndices: Array.from({ length: definition.rows * definition.columns }, (_, index) => index).filter((index) => !definition.mineIndices.includes(index)) }
    case 'math-choice': return { kind: definition.kind, optionIds: definition.correctOptionIds }
    case 'math-fill': return { kind: definition.kind, text: definition.acceptedAnswers[0] }
  }
}
function begin(run: ShiftRun, intentId: string, machineId: MachineId = 'quick', seconds = 0) {
  // Supply fixture context without navigating away from other simultaneous test calibrations.
  return act({ ...run, station: 'print', selectedOrderId: run.authorizations[intentId]?.orderId ?? run.selectedOrderId }, { station: 'print', type: 'begin-calibration', intentId, machineId }, seconds)
}
function succeed(run: ShiftRun, intentId: string, seconds = 0) {
  const auth = run.authorizations[intentId]
  if (auth.status !== 'calibrating') throw new Error('Expected calibrating fixture')
  return act(run, { station: 'print', type: 'submit-puzzle', puzzleId: auth.puzzleId, answer: answerFor(run.puzzles[auth.puzzleId]) }, seconds)
}
function receiptFor(run: ShiftRun, intentId: string, seconds = 0, accepted = true): PrintReceipt {
  const auth = run.authorizations[intentId]
  if (auth.status !== 'calibrated_pending_start') throw new Error('Expected calibrated fixture')
  const base = { receiptId: `receipt:${intentId}`, intentId, snapshotId: auth.snapshotId, machineId: auth.machineId,
    shiftRunId: run.id, receivedAtMs: START + seconds * 1000, authority: 'local' as const, details: null }
  return accepted ? { ...base, status: 'accepted', taskId: `task:${intentId}` } : { ...base, status: 'rejected', reasonCode: 'test-rejection', message: 'Test fixture rejection' }
}
function bind(run: ShiftRun, intentId: string, seconds = 0) {
  return act(run, { station: 'print', type: 'record-receipt', receipt: receiptFor(run, intentId, seconds) }, seconds)
}
function print(run: ShiftRun, intentId: string, machineId: MachineId = 'quick', id = 'o0', seconds = 0) {
  return bind(succeed(begin(confirm(run, intentId, machineId, id, seconds), intentId, machineId, seconds), intentId, seconds), intentId, seconds)
}
function correctCard(run: ShiftRun, id = 'o0', seconds = 0) {
  const requirements = order(run, id).content.requirements
  run = prepare(run, requirements, id, seconds)
  run = act(run, { station: 'preparation', type: 'cut-blank', draftId: draftId(run, id) }, seconds)
  for (const element of requirements.elements) {
    run = act(run, { station: 'assembly', type: 'place-element', draftId: draftId(run, id), element: {
      id: element.id, assetId: element.assetId, kind: element.kind, slotId: element.kind === 'motif' ? 'main' : 'title', size: 'medium', direction: 'upright', layer: 'front',
    } }, seconds)
  }
  return act(run, { station: 'assembly', type: 'fix-assembly', draftId: draftId(run, id) }, seconds)
}

describe('shift timeline', () => {
  it('keeps every future arrival at exactly base patience across unrelated events and chunked recovery', () => {
    const definition = stage(2, 35, 100)
    const initial = fresh({ ...definition, customers: definition.customers.map((customer, i) => ({ ...customer, arrivalSeconds: i ? 100 : 0 })) })
    let stepped = initial
    for (const seconds of [1, 20, 35, 55, 99.999]) {
      stepped = advanceShift(stepped, START + seconds * 1000)
      expect(order(stepped, 'o1').patience).toEqual(order(initial, 'o1').patience)
    }
    expect(stepped).toEqual(advanceShift(initial, START + 99_999))
    expect(advanceShift(stepped, START + 120_000)).toEqual(advanceShift(initial, START + 120_000))
  })
  it('initializes authored absolute schedules, inventory, and independent empty machines', () => {
    const run = fresh(AUTHORED_STAGES.tutorial)
    expect(run.deadlineAtMs).toBe(START + 720_000)
    expect(run.orders.map((customer) => customer.arrivalAtMs)).toEqual([0, 55, 130, 210, 325].map((s) => START + s * 1000))
    expect(run.materials.stock['pearl-paper']).toEqual({ available: 2, reserved: 0, consumed: 0 })
    expect(run.printers.quick.currentTaskId).toBeNull()
    expect(run.printers.fine.reservations).toEqual([])
    expect(run.inspectionsRemaining).toBe(3)
    expect(run.freeDemoInspectionsRemaining).toBe(1)
  })

  it('does not drain before arrival and accepts at the exact boundary', () => {
    const initial = fresh(stage(1, 35, 10))
    expect(accept(initial, 'o0', 9).activeOrderIds).toEqual([])
    const run = advanceShift(initial, START + 10_000)
    expect(order(run).patience).toMatchObject({ phase: 'normal', remainingSeconds: 35 })
    const accepted = accept(run, 'o0', 10)
    expect(order(accepted).acceptedAtMs).toBe(START + 10_000)
    expect(accepted.selectedOrderId).toBe('o0')
    expect(accepted.drafts[draftId(accepted)].stage).toBe('not_started')
  })

  it('drains door patience at exactly 35% then full speed after accepting', () => {
    const waiting = advanceShift(fresh(), START + 20_000)
    expect(order(waiting).patience).toMatchObject({ phase: 'normal', remainingSeconds: 28 })
    const accepted = accept(waiting, 'o0', 20)
    expect(order(advanceShift(accepted, START + 47_999)).patience.phase).toBe('normal')
    expect(order(advanceShift(accepted, START + 48_000)).patience).toEqual({ phase: 'last_wait', startedAtMs: START + 48_000, deadlineAtMs: START + 68_000, originalDurationSeconds: 20 })
  })

  it('accepts door customers in final wait and leaves at the exact deadline', () => {
    const waiting = advanceShift(fresh(), START + 100_000)
    expect(order(waiting).position).toBe('door_waiting')
    expect(order(waiting).patience).toMatchObject({ phase: 'last_wait', startedAtMs: START + 100_000 })
    const accepted = accept(waiting, 'o0', 110)
    const left = advanceShift(accepted, START + 120_000)
    expect(order(left).outcome).toEqual({ status: 'left', leftAtMs: START + 120_000, reason: 'patience' })
    expect(order(left).patience).toEqual({ phase: 'expired', expiredAtMs: START + 120_000 })
    expect(left.drafts[draftId(accepted)]).toEqual(accepted.drafts[draftId(accepted)])
  })

  it('limits active pending orders to three and immediately releases a departed slot', () => {
    let run = fresh()
    for (const id of ['o0', 'o1', 'o2', 'o3']) run = accept(run, id)
    expect(run.activeOrderIds).toEqual(['o0', 'o1', 'o2'])
    run = accept(run, 'o3', 55)
    expect(run.activeOrderIds).toEqual(['o3'])
    expect(run.selectedOrderId).toBe('o3')
  })

  it('replays all crossings at event time then closes exactly at 720s', () => {
    const initial = accept(fresh())
    const recovered = advanceShift(initial, START + 900_000)
    expect(order(recovered).outcome).toMatchObject({ leftAtMs: START + 55_000, reason: 'patience' })
    expect(order(recovered, 'o1').outcome).toMatchObject({ leftAtMs: START + 120_000 })
    expect(recovered.status).toBe('settled')
    if (recovered.status === 'settled') expect(recovered.result.closedAtMs).toBe(START + 720_000)
    let stepped = initial
    for (const seconds of [35, 55, 100, 120, 720, 900]) stepped = advanceShift(stepped, START + seconds * 1000)
    expect(recovered).toEqual(stepped)
  })

  it('freezes controlled pauses across refresh, shifts future arrivals once, and rejects generic pause reasons', () => {
    let run = accept(fresh(stage(2, 35, 10)), 'o0', 10)
    const before = advanceShift(run, START + 20_000)
    run = act(before, { type: 'pause', reason: 'story' }, 20)
    expect(advanceShift(run, START + 999_000)).toEqual(run)
    run = act(run, { type: 'resume' }, 1020)
    expect(run.deadlineAtMs).toBe(START + 1_720_000)
    expect(order(run).patience).toMatchObject({ remainingSeconds: 25 })
    expect(act(run, { type: 'resume' }, 1020)).toEqual(run)
    const future = act(fresh(stage(1, 35, 100)), { type: 'pause', reason: 'tutorial' }, 10)
    const resumed = act(future, { type: 'resume' }, 110)
    expect(order(resumed).arrivalAtMs).toBe(START + 200_000)
    expect(accept(resumed, 'o0', 199).activeOrderIds).toEqual([])
    expect(accept(resumed, 'o0', 200).activeOrderIds).toEqual(['o0'])
    expect(act(fresh(), { type: 'pause', reason: 'panel' } as unknown as ShiftEngineAction).status).toBe('running')
  })

  it('acknowledges only the current tutorial trigger in the same transaction that resumes its clocks', () => {
    const initial = fresh()
    expect(initial.seenTutorialTriggers).toEqual([])
    const paused = act(initial, { type: 'pause', reason: 'tutorial' }, 10)
    expect(act(paused, { type: 'dismiss-tutorial', trigger: 'choose_materials' }, 20)).toEqual(paused)
    const resumed = act(JSON.parse(JSON.stringify(paused)), { type: 'dismiss-tutorial', trigger: 'read_order' }, 20)
    expect(resumed.status).toBe('running')
    expect(resumed.seenTutorialTriggers).toEqual(['read_order'])
    expect(resumed.deadlineAtMs).toBe(initial.deadlineAtMs + 10_000)
    expect(act(resumed, { type: 'dismiss-tutorial', trigger: 'read_order' }, 20)).toEqual(resumed)
    expect(paused.seenTutorialTriggers).toEqual([])
    const storyPause = act(initial, { type: 'pause', reason: 'story' }, 10)
    expect(act(storyPause, { type: 'dismiss-tutorial', trigger: 'read_order' }, 20)).toEqual(storyPause)
  })

  it('settles the longest satisfied A/S delivery streak in delivery time order, resetting on lesser quality', () => {
    const initial = fresh(stage(7))
    // Schedule order differs from actual handoff order: S, A, B, A, S, A, unsatisfied A.
    const deliveryPositions = [0, 3, 2, 4, 5, 6, 1]
    const grades = ['S', 'A', 'B', 'S', 'A', 'A', 'A'] as const
    const orders = initial.orders.map((customer, index) => ({ ...customer, position: 'closed' as const,
      outcome: { status: 'delivered' as const, taskId: `task-${index}`, deliveredAtMs: START + (deliveryPositions[index] + 1) * 1000,
        evaluation: { accuracy: 40, preferences: 20, quality: 15, printing: 15, timeliness: 10, rawScore: 90, score: 90,
          grade: grades[index], satisfied: index !== 5, missingRequiredIds: [], tabooViolated: false, advice: [] } },
    }))
    const settled = advanceShift({ ...initial, orders }, initial.deadlineAtMs)
    if (settled.status !== 'settled') throw new Error('Expected settlement')
    expect(settled.result.longestQualityStreak).toBe(3)
    const empty = advanceShift(initial, initial.deadlineAtMs)
    if (empty.status !== 'settled') throw new Error('Expected settlement')
    expect(empty.result.longestQualityStreak).toBe(0)
  })

  it('keeps inputs immutable and JSON serializable and does not settle before closing', () => {
    const initial = fresh()
    const copy = structuredClone(initial)
    const run = advanceShift(accept(initial), START + 120_000)
    expect(initial).toEqual(copy)
    expect(run.status).toBe('running')
    expect(JSON.parse(JSON.stringify(run))).toEqual(run)
    expect(act(fresh(), { type: 'close-shift' }, 1).status).toBe('running')
    const settled = act(run, { type: 'close-shift' }, 120)
    expect(settled.status).toBe('settled')
    if (settled.status === 'settled') expect(settled.result).toMatchObject({ delivered: 0, left: 5, averageScore: 0, passed: false, failureReasons: ['deliveries', 'satisfaction', 'departures'] })
  })

  it('does not accumulate patience rounding drift during fine-grained recovery', () => {
    const initial = fresh(stage(1, 35))
    let stepped = initial
    for (let i = 1; i <= 1000; i++) stepped = advanceShift(stepped, START + i / 1000)
    expect(stepped).toEqual(advanceShift(initial, START + 1))
    const short = fresh(stage(1, 1))
    const crossing = START + 1000 / 0.35
    let chunks = short
    for (const at of [START + 1, START + 1000, crossing - 0.001, crossing, crossing + 20_000]) chunks = advanceShift(chunks, at)
    expect(chunks).toEqual(advanceShift(short, crossing + 20_000))
    expect(order(chunks).outcome).toEqual({ status: 'left', reason: 'patience', leftAtMs: crossing + 20_000 })
  })
})

describe('materials and immutable artwork', () => {
  const completePreparation: PreparationSelection = {
    paperId: 'lilac', paperMaterialId: 'pearl', shapeId: 'ticket', orientation: 'landscape', layoutId: 'welcome', surfaceFinishId: 'foil',
  }
  const pearl: PlacedElement = { id: 'pearl', assetId: 'pearl', kind: 'decoration', slotId: 'left', size: 'small', direction: 'upright', layer: 'front' }
  const cut = (run: ShiftRun) => act(run, { station: 'preparation', type: 'cut-blank', draftId: draftId(run) })
  const cutCard = (definition = stage(1, 500)) => cut(prepare(accept(fresh(definition)), completePreparation))
  const placePearl = (run: ShiftRun) => act(run, { station: 'assembly', type: 'place-element', draftId: draftId(run), element: pearl })
  const selectFinish = (run: ShiftRun, operationId = 'finish') => act(run, { station: 'craft', type: 'select-craft', draftId: draftId(run), craftId: 'surface-finish', operationId, discrete: {} })
  const finishCraft = (run: ShiftRun, craftId: string) => {
    run = act(run, { station: 'craft', type: 'begin-craft', draftId: draftId(run), craftId })
    return act(run, { station: 'craft', type: 'finish-craft', draftId: draftId(run), craftId, measurements: { coverage: 1 }, discrete: {} })
  }

  it('rejects cutting before preparation has started', () => {
    const run = accept(fresh(stage(1, 500)))
    expect(cut(run)).toEqual(run)
  })

  it.each([
    ['paperId', null], ['paperMaterialId', null], ['shapeId', null], ['layoutId', null],
    ['paperId', 'unknown'], ['paperMaterialId', 'unknown'], ['shapeId', 'unknown'], ['orientation', 'unknown'],
    ['layoutId', 'unknown'], ['surfaceFinishId', 'unknown'],
  ])('rejects cutting with incomplete or invalid %s: %s', (field, value) => {
    const prepared = prepare(accept(fresh(stage(1, 500))), completePreparation)
    const id = draftId(prepared)
    const draft = prepared.drafts[id]
    const run = { ...prepared, drafts: { ...prepared.drafts, [id]: { ...draft,
      design: { ...draft.design, preparation: { ...draft.design.preparation, [field]: value } },
    } } } as ShiftRun
    expect(cut(run)).toEqual(run)
  })

  it('cuts a complete blank once and cannot reopen fixed assembly by cutting again', () => {
    let run = cutCard()
    expect(run.drafts[draftId(run)].stage).toBe('assembling')
    expect(run.materials.stock['pearl-paper']).toEqual({ available: 1, reserved: 0, consumed: 1 })
    expect(cut(run)).toEqual(run)
    run = act(run, { station: 'assembly', type: 'fix-assembly', draftId: draftId(run) })
    expect(cut(run)).toEqual(run)
  })

  it('charges unchanged premium paper again when replacing a cut blank with another shape', () => {
    let run = prepare(cutCard(), { shapeId: 'tag' })
    expect(run.drafts[draftId(run)].stage).toBe('preparing')
    expect(run.materials.stock['pearl-paper']).toEqual({ available: 0, reserved: 1, consumed: 1 })
    expect(run.materials.stock['shaped-blank']).toEqual({ available: 1, reserved: 1, consumed: 1 })
    run = cut(run)
    expect(run.materials.stock['pearl-paper'].consumed).toBe(2)
    expect(run.materials.stock['shaped-blank'].consumed).toBe(2)
    checkLedger(run)
  })

  it.each([
    { paperId: 'cream' }, { paperMaterialId: 'smooth' }, { orientation: 'portrait' },
    { orientation: 'portrait', layoutId: 'balanced', surfaceFinishId: 'wax' },
  ] satisfies Partial<PreparationSelection>[])('replaces the whole blank and downstream work for %j', (selection) => {
    let run = finishCraft(selectFinish(cutCard()), 'surface-finish')
    run = selectFinish(placePearl(run), 'pending-finish')
    run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false })
    const inspections = structuredClone(run.drafts[draftId(run)].inspections)
    run = prepare(run, selection)
    expect(run.drafts[draftId(run)]).toMatchObject({ stage: 'preparing', design: { elements: [], crafts: [] }, inspections })
    expect(run.materials.stock['premium-decoration']).toEqual({ available: 1, reserved: 0, consumed: 0 })
    expect(run.materials.stock['foil-sheet']).toEqual({ available: 1, reserved: 0, consumed: 1 })
    expect(run.materials.stock['shaped-blank']).toEqual({ available: 1, reserved: 1, consumed: 1 })
    expect(run.materials.stock['pearl-paper'].consumed).toBe(1)
    expect(Object.values(run.materials.reservations).filter((reservation) => reservation.status === 'reserved').map((reservation) => reservation.operationId))
      .not.toEqual(expect.arrayContaining(['element:pearl', 'pending-finish']))
    checkLedger(run)
  })

  it('leaves every field untouched when a replacement cannot afford the full new blank', () => {
    const definition = stage(1, 500)
    let run = cutCard({ ...definition, inventory: { ...definition.inventory, 'pearl-paper': 1 } })
    run = selectFinish(placePearl(run))
    run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false })
    expect(prepare(run, { shapeId: 'tag', layoutId: 'balanced' })).toEqual(run)
    checkLedger(run)
  })

  it('preserves the cut blank while layout changes release pending elements and craft work', () => {
    let run = finishCraft(selectFinish(cutCard()), 'surface-finish')
    run = selectFinish(placePearl(run), 'pending-finish')
    run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false })
    const inspections = structuredClone(run.drafts[draftId(run)].inspections)
    run = prepare(run, { layoutId: 'balanced' })
    expect(run.drafts[draftId(run)]).toMatchObject({ stage: 'assembling', design: { elements: [], crafts: [] }, inspections })
    expect(run.materials.stock['pearl-paper']).toEqual({ available: 1, reserved: 0, consumed: 1 })
    expect(run.materials.stock['shaped-blank']).toEqual({ available: 2, reserved: 0, consumed: 1 })
    expect(run.materials.stock['premium-decoration']).toEqual({ available: 1, reserved: 0, consumed: 0 })
    expect(run.materials.stock['foil-sheet']).toEqual({ available: 1, reserved: 0, consumed: 1 })
    expect(cut(run)).toEqual(run)
    checkLedger(run)
  })

  it('preserves assembly reservations when only the finish changes before fixing', () => {
    const run = placePearl(cutCard())
    const changed = prepare(run, { surfaceFinishId: 'wax' })
    expect(changed.drafts[draftId(changed)]).toMatchObject({ stage: 'assembling', design: { elements: [pearl] } })
    expect(changed.materials).toEqual(run.materials)
  })

  it('preserves fixed elements, unrelated completed crafts, and inspection history when changing finish', () => {
    const definition = stage(1, 500)
    const stampOrder = ORDER_TEMPLATES.find((entry) => entry.id === 'chiya-garden')!
    let run = cutCard({ ...definition, customers: [{ ...definition.customers[0], order: stampOrder }] })
    run = act(placePearl(run), { station: 'assembly', type: 'fix-assembly', draftId: draftId(run) })
    run = act(run, { station: 'craft', type: 'select-craft', draftId: draftId(run), craftId: 'stamp', operationId: 'required-stamp', discrete: {} })
    run = finishCraft(run, 'stamp')
    run = finishCraft(selectFinish(run), 'surface-finish')
    run = selectFinish(run, 'pending-finish')
    run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false })
    const draft = run.drafts[draftId(run)]
    const changed = prepare(run, { surfaceFinishId: 'wax' })
    expect(changed.drafts[draftId(changed)]).toMatchObject({ stage: 'crafting', activeCraft: null,
      design: { elements: [pearl], crafts: [draft.design.crafts[0]] }, inspections: draft.inspections })
    expect(changed.materials.stock['premium-decoration']).toEqual({ available: 0, reserved: 0, consumed: 1 })
    expect(changed.materials.stock['foil-sheet']).toEqual({ available: 1, reserved: 0, consumed: 1 })
    expect(changed.materials.stock['pearl-paper']).toEqual(run.materials.stock['pearl-paper'])
    checkLedger(changed)
  })

  it('keeps an unrelated pending required craft when changing finish', () => {
    const definition = stage(1, 500)
    const foilOrder = ORDER_TEMPLATES.find((entry) => entry.id === 'aoyama-keepsake')!
    let run = cutCard({ ...definition, customers: [{ ...definition.customers[0], order: foilOrder }] })
    run = prepare(run, { surfaceFinishId: 'wax' })
    run = act(run, { station: 'craft', type: 'select-craft', draftId: draftId(run), craftId: 'foil', operationId: 'required-foil', discrete: {} })
    const draft = run.drafts[draftId(run)]
    const changed = prepare(run, { surfaceFinishId: 'matte' })
    expect(changed.drafts[draftId(changed)]).toMatchObject({ stage: 'crafting', activeCraft: draft.stage === 'crafting' ? draft.activeCraft : null })
    expect(changed.materials).toEqual(run.materials)
  })

  it.each([{ shapeId: 'tag' }, { layoutId: 'balanced' }, { surfaceFinishId: 'wax' }] satisfies Partial<PreparationSelection>[])
    ('retains archived artwork and inspections while deriving preparation edit %j', (selection) => {
      let run = cutCard()
      run = act(run, { station: 'assembly', type: 'fix-assembly', draftId: draftId(run) })
      run = finishCraft(selectFinish(run), 'surface-finish')
      run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false })
      run = archive(run)
      const originalId = draftId(run)
      const original = structuredClone(run.drafts[originalId])
      const snapshots = structuredClone(run.snapshots)
      run = prepare(run, selection)
      expect(run.drafts[originalId]).toEqual(original)
      expect(run.snapshots).toEqual(snapshots)
      expect(run.drafts[draftId(run)]).toMatchObject({ derivedFromSnapshotId: 'snap', inspections: original.inspections,
        stage: 'shapeId' in selection ? 'preparing' : 'layoutId' in selection ? 'assembling' : 'crafting' })
      expect(run.materials.stock['pearl-paper']).toEqual({ available: 'shapeId' in selection ? 0 : 1, reserved: 'shapeId' in selection ? 1 : 0, consumed: 1 })
      checkLedger(run)
    })

  it('derives a unique latest draft when explicitly editing an older archived version', () => {
    let run = archive(prepare(accept(fresh(stage(1, 500))), { paperId: 'cream' }), 'v1')
    const firstId = draftId(run)
    run = archive(prepare(run, { paperId: 'pink' }), 'v2')
    const secondId = draftId(run)
    const second = structuredClone(run.drafts[secondId])
    const snapshots = structuredClone(run.snapshots)
    run = act(run, { station: 'preparation', type: 'select-preparation', draftId: firstId, selection: { paperId: 'mint' } })
    expect(run.drafts[secondId]).toEqual(second)
    expect(run.snapshots).toEqual(snapshots)
    expect(draftId(run)).not.toBe(secondId)
    expect(run.drafts[draftId(run)]).toMatchObject({ derivedFromSnapshotId: 'v1', revision: second.revision + 1 })
  })
  it('reserves selected premium paper and shape, and releases only uncut selections', () => {
    let run = prepare(accept(fresh(stage(1, 500))), { paperId: 'lilac', shapeId: 'ticket' })
    expect(run.materials.stock['pearl-paper']).toEqual({ available: 1, reserved: 1, consumed: 0 })
    expect(run.materials.stock['shaped-blank']).toEqual({ available: 2, reserved: 1, consumed: 0 })
    run = prepare(run, { paperId: 'cream', shapeId: 'landscape' })
    expect(run.materials.stock['pearl-paper']).toEqual({ available: 2, reserved: 0, consumed: 0 })
    expect(run.materials.stock['shaped-blank']).toEqual({ available: 3, reserved: 0, consumed: 0 })
    checkLedger(run)
  })

  it('consumes on cutting, never refunds a cut, and charges a fresh unit on rework', () => {
    let run = prepare(accept(fresh(stage(1, 500))), { paperId: 'lilac', shapeId: 'landscape', layoutId: 'welcome' })
    const cut = () => { run = act(run, { station: 'preparation', type: 'cut-blank', draftId: draftId(run) }) }
    cut()
    cut()
    expect(run.materials.stock['pearl-paper']).toEqual({ available: 1, reserved: 0, consumed: 1 })
    run = prepare(run, { paperId: 'lilac' })
    cut()
    expect(run.materials.stock['pearl-paper']).toEqual({ available: 0, reserved: 0, consumed: 2 })
    run = prepare(run, { paperId: 'cream' })
    const before = structuredClone(run)
    run = prepare(run, { paperId: 'lilac', shapeId: 'ticket' })
    expect(run).toEqual(before)
    expect(advanceShift(run, START + 900_000).materials.stock['pearl-paper'].consumed).toBe(2)
    checkLedger(run)
  })

  it('reserves placed premium elements until fixing and cannot refund fixed pieces', () => {
    let run = accept(fresh(stage(1, 500)))
    const element: PlacedElement = { id: 'e1', assetId: 'pearl', kind: 'decoration', slotId: 'left', size: 'small', direction: 'upright', layer: 'front' }
    const place = () => { run = act(run, { station: 'assembly', type: 'place-element', draftId: draftId(run), element }) }
    const remove = () => { run = act(run, { station: 'assembly', type: 'remove-element', draftId: draftId(run), elementId: 'e1' }) }
    place()
    expect(run.materials.stock['premium-decoration'].reserved).toBe(1)
    remove()
    expect(run.materials.stock['premium-decoration'].available).toBe(1)
    place()
    run = act(run, { station: 'assembly', type: 'fix-assembly', draftId: draftId(run) })
    expect(run.materials.stock['premium-decoration'].consumed).toBe(1)
    remove()
    place()
    expect(run.drafts[draftId(run)].design.elements).toEqual([])
    expect(run.materials.stock['premium-decoration'].available).toBe(0)
    checkLedger(run)
  })

  it('reserves craft and finish once, consumes at begin, and charges rework after cancellation', () => {
    const definition = stage(1, 500)
    const collector = ORDER_TEMPLATES.find((order) => order.id === 'aoyama-keepsake')!
    let run = accept(fresh({ ...definition, customers: [{ ...definition.customers[0], order: collector }] }))
    run = prepare(run, { surfaceFinishId: 'foil' })
    const select = (operationId: string) => { run = act(run, { station: 'craft', type: 'select-craft', draftId: draftId(run), craftId: 'foil', operationId, discrete: {} }) }
    const craft = (type: 'begin-craft' | 'cancel-craft') => { run = act(run, { station: 'craft', type, draftId: draftId(run), craftId: 'foil' }) }
    select('op1')
    expect(run.materials.stock['foil-sheet']).toEqual({ available: 1, reserved: 1, consumed: 0 })
    craft('cancel-craft')
    expect(run.materials.stock['foil-sheet'].available).toBe(2)
    select('op2')
    craft('begin-craft')
    craft('begin-craft')
    craft('cancel-craft')
    expect(run.materials.stock['foil-sheet']).toEqual({ available: 1, reserved: 0, consumed: 1 })
    select('op3')
    craft('begin-craft')
    run = act(run, { station: 'craft', type: 'finish-craft', draftId: draftId(run), craftId: 'foil', measurements: { coverage: 0.2 }, discrete: {} })
    expect(run.materials.stock['foil-sheet']).toEqual({ available: 0, reserved: 0, consumed: 2 })
    expect(run.drafts[draftId(run)].design.crafts[0].measurements).toEqual({ coverage: 0.2 })
    expect(JSON.parse(JSON.stringify(run))).toEqual(run)
    checkLedger(run)
  })

  it.each([
    ['place', false], ['remove', false], ['place', true], ['remove', true],
  ] as const)('abandons a pending craft on assembly %s while preserving consumed=%s', (edit, started) => {
    const definition = stage(1, 500)
    const collector = ORDER_TEMPLATES.find((entry) => entry.id === 'aoyama-keepsake')!
    let run = prepare(cutCard({ ...definition, customers: [{ ...definition.customers[0], order: collector }] }), { surfaceFinishId: 'matte' })
    const motif: PlacedElement = { id: 'book', kind: 'motif', assetId: 'book', slotId: 'main', size: 'medium', direction: 'upright', layer: 'front' }
    run = act(run, { station: 'assembly', type: 'place-element', draftId: draftId(run), element: motif })
    run = act(run, { station: 'assembly', type: 'fix-assembly', draftId: draftId(run) })
    run = act(run, { station: 'craft', type: 'select-craft', draftId: draftId(run), craftId: 'foil', operationId: 'abandoned-foil', discrete: {} })
    if (started) run = act(run, { station: 'craft', type: 'begin-craft', draftId: draftId(run), craftId: 'foil' })
    run = edit === 'place' ? placePearl(run)
      : act(run, { station: 'assembly', type: 'remove-element', draftId: draftId(run), elementId: motif.id })
    expect(run.drafts[draftId(run)]).toMatchObject({ stage: 'assembling' })
    expect(run.drafts[draftId(run)]).not.toHaveProperty('activeCraft')
    expect(run.materials.stock['foil-sheet']).toEqual({ available: started ? 1 : 2, reserved: 0, consumed: started ? 1 : 0 })
    expect(run.materials.stock['premium-decoration']).toEqual({ available: edit === 'place' ? 0 : 1, reserved: edit === 'place' ? 1 : 0, consumed: 0 })
    expect(run.materials.stock['pearl-paper'].consumed).toBe(1)
    run = act(run, { station: 'assembly', type: 'fix-assembly', draftId: draftId(run) })
    run = archive(run)
    expect(run.snapshotIds).toEqual(['snap'])
    checkLedger(run)
  })

  it.each([
    ['foil', 'foil', 'foil-sheet'], ['emboss', 'stamp', 'emboss-sheet'], ['wax', 'wax', 'wax'],
  ] as const)('archives %s only after its finished craft consumed the matching material', (surfaceFinishId, kind, materialId) => {
    let run = prepare(correctCard(accept(fresh(stage(1, 500)))), { surfaceFinishId })
    expect(archive(run).snapshotIds).toEqual([])
    const id = draftId(run)
    const draft = run.drafts[id]
    const unpaid = { ...run, drafts: { ...run.drafts, [id]: { ...draft, design: { ...draft.design,
      crafts: [{ id: 'unpaid', requirementId: 'surface-finish', kind, measurements: {}, discrete: {}, completedAtMs: START }],
    } } } }
    expect(archive(unpaid).snapshotIds).toEqual([])
    run = finishCraft(selectFinish(run), 'surface-finish')
    const ledger = structuredClone(run.materials)
    run = archive(run)
    expect(run.snapshotIds).toEqual(['snap'])
    expect(run.materials.stock[materialId]).toMatchObject({ reserved: 0, consumed: 1 })
    expect(run.materials).toEqual(ledger)
    checkLedger(run)
  })

  it.each(['matte', 'gloss'] as const)('archives %s without an extra craft or material charge', (surfaceFinishId) => {
    const run = prepare(correctCard(accept(fresh(stage(1, 500)))), { surfaceFinishId })
    const saved = archive(run)
    expect(saved.snapshotIds).toEqual(['snap'])
    expect(saved.materials).toEqual(run.materials)
  })

  it('uses one paid required craft for the matching finish and retains that payment in derived artwork', () => {
    const definition = stage(1, 500)
    const collector = ORDER_TEMPLATES.find((entry) => entry.id === 'aoyama-keepsake')!
    let run = correctCard(accept(fresh({ ...definition, customers: [{ ...definition.customers[0], order: collector }] })))
    run = act(run, { station: 'craft', type: 'select-craft', draftId: draftId(run), craftId: 'foil', operationId: 'required-foil', discrete: {} })
    expect(run.materials.stock['foil-sheet']).toEqual({ available: 1, reserved: 1, consumed: 0 })
    run = finishCraft(run, 'foil')
    run = archive(run)
    expect(run.snapshotIds).toEqual(['snap'])
    expect(run.materials.stock['foil-sheet']).toEqual({ available: 1, reserved: 0, consumed: 1 })
    const motif = run.drafts[draftId(run)].design.elements.find((element) => element.kind === 'motif')!
    run = act(run, { station: 'assembly', type: 'place-element', draftId: draftId(run), element: { ...motif, size: 'large' } })
    run = act(run, { station: 'assembly', type: 'fix-assembly', draftId: draftId(run) })
    run = archive(run, 'derived')
    expect(run.snapshotIds).toEqual(['snap', 'derived'])
    expect(run.materials.stock['foil-sheet']).toEqual({ available: 1, reserved: 0, consumed: 1 })
    checkLedger(run)
  })

  it('releases every remaining reservation on departure and closing while retaining consumed history', () => {
    let run = prepare(accept(fresh(stage(2, 35))), { paperId: 'lilac', shapeId: 'ticket', layoutId: 'welcome' })
    run = act(run, { station: 'preparation', type: 'cut-blank', draftId: draftId(run) })
    run = prepare(run, { paperId: 'midnight' })
    const departed = advanceShift(run, START + 55_000)
    expect(departed.materials.stock['linen-paper']).toEqual({ available: 2, reserved: 0, consumed: 0 })
    expect(departed.materials.stock['pearl-paper'].consumed).toBe(1)
    let closing = prepare(accept(fresh(stage(1, 1000))), { paperId: 'lilac' })
    closing = advanceShift(closing, START + 720_000)
    expect(closing.materials.stock['pearl-paper']).toEqual({ available: 2, reserved: 0, consumed: 0 })
    checkLedger(departed)
    checkLedger(closing)
  })

  it('archives a full immutable snapshot without charging or printing and derives later edits', () => {
    let run = prepare(accept(fresh(stage(1, 500))), { paperId: 'cream', shapeId: 'landscape', layoutId: 'welcome' })
    const originalDraft = draftId(run)
    const ledger = structuredClone(run.materials)
    run = archive(run)
    expect(run.snapshotIds).toEqual(['snap'])
    expect(run.snapshots.snap.design.preparation.paperId).toBe('cream')
    expect(run.materials).toEqual(ledger)
    expect(run.tasks).toEqual({})
    expect(run.authorizations).toEqual({})
    const saved = structuredClone(run.snapshots.snap)
    run = prepare(run, { paperId: 'pink' })
    expect(draftId(run)).not.toBe(originalDraft)
    expect(run.drafts[draftId(run)]).toMatchObject({ derivedFromSnapshotId: 'snap', revision: saved.draftRevision + 1 })
    expect(run.snapshots.snap).toEqual(saved)
    expect(run.drafts[originalDraft].stage).toBe('archived')
    run = archive(run, 'snap2')
    expect(run.snapshotIds).toEqual(['snap', 'snap2'])
    expect(Object.keys(run.snapshots)).toEqual(run.snapshotIds)
  })

  it('cannot archive unpaid reserved artwork or overwrite an earlier snapshot ID', () => {
    let run = prepare(accept(fresh(stage(1, 500))), { paperId: 'lilac', shapeId: 'landscape', layoutId: 'welcome' })
    expect(archive(run).snapshotIds).toEqual([])
    run = act(run, { station: 'preparation', type: 'cut-blank', draftId: draftId(run) })
    run = archive(run)
    expect(run.snapshots.snap).toBeDefined()
    const saved = structuredClone(run.snapshots.snap)
    run = prepare(run, { paperId: 'cream' })
    run = archive(run)
    expect(run.snapshots.snap).toEqual(saved)
    expect(run.drafts[draftId(run)].stage).not.toBe('archived')
  })
})

describe('calibration, capacity, and printer scheduling', () => {
  it.each([
    ['tutorial', 4, 'sudoku'],
    ['beginner', 3, 'sudoku'],
    ['beginner', 5, 'math'],
    ['story', 2, 'math'],
    ['story', 4, 'sudoku'],
  ] as const)('keeps %s customer %i on its %s lesson through retries, printer changes, and recovery', (stageId, customerNumber, kind) => {
    const definition = AUTHORED_STAGES[stageId]
    const customer = definition.customers[customerNumber - 1]
    const seconds = customer.arrivalSeconds
    const confirmed = confirm(accept(fresh(definition), customer.id, seconds), 'lesson', 'fine', customer.id, seconds)
    const assertLesson = (run: ShiftRun, attempt: number) => {
      const instance = puzzle(run, 'lesson', attempt)
      expect(instance).toBeDefined()
      if (kind === 'math') {
        expect(['math-choice', 'math-fill']).toContain(instance.definition.kind)
        expect(MATH_QUESTION_BANK).toContainEqual(instance.definition)
      } else expect(instance.definition.kind).toBe(kind)
    }
    let run = begin(confirmed, 'lesson', 'fine', seconds)
    assertLesson(run, 1)
    expect(begin(JSON.parse(JSON.stringify(confirmed)), 'lesson', 'fine', seconds)).toEqual(run)
    const recovered = advanceShift(JSON.parse(JSON.stringify(run)), START + (seconds + 1) * 1000)
    expect(recovered.puzzles).toEqual(run.puzzles)
    run = act(recovered, { station: 'print', type: 'exit-puzzle', puzzleId: puzzle(run, 'lesson').id }, seconds + 1)
    run = begin(JSON.parse(JSON.stringify(run)), 'lesson', 'fine', seconds + 31)
    assertLesson(run, 2)
    run = begin(run, 'lesson', 'quick', seconds + 32)
    expect(['number-search', 'connect', 'identify']).toContain(puzzle(run, 'lesson', 3).definition.kind)
    run = begin(JSON.parse(JSON.stringify(run)), 'lesson', 'fine', seconds + 62)
    assertLesson(run, 4)
  })

  it.each(['tutorial', 'beginner', 'story'] as const)('derives %s calibration difficulty from the saved stage content', (stageId) => {
    const definition = AUTHORED_STAGES[stageId]
    const customer = definition.customers[0]
    const run = confirm(accept(fresh(definition), customer.id), 'difficulty', 'quick', customer.id)
    const started = begin(run, 'difficulty')
    const difficulty = { tutorial: 0, beginner: 0.4, story: 0.8 }[stageId]
    expect(puzzle(started, 'difficulty')).toEqual(createPuzzle({ shiftSeed: run.seed, shiftRunId: run.id,
      orderId: customer.id, intentId: 'difficulty', machineId: 'quick', attempt: 1, startedAtMs: START, difficulty }))
  })

  it('uses a saved customer calibration plan even when the order is moved to another stage slot', () => {
    const source = AUTHORED_STAGES.story.customers[3]
    const definition = { ...stage(1, 500), puzzleDifficulty: 0.8, customers: [{ ...source, id: 'o0', arrivalSeconds: 0 }] }
    const run = confirm(accept(fresh(definition)), 'moved-lesson', 'fine')
    expect(puzzle(begin(run, 'moved-lesson', 'fine'), 'moved-lesson').definition.kind).toBe('sudoku')
  })

  it('exposes one calibration action without caller-controlled generation options', () => {
    expectTypeOf<ShiftEngineAction>().toEqualTypeOf<ShiftAction>()
    expectTypeOf<Extract<ShiftAction, { type: 'begin-calibration' }>>().toEqualTypeOf<Readonly<{ station: 'print' }> & Readonly<{
      type: 'begin-calibration'; intentId: string; machineId: MachineId
    }>>()
    expectTypeOf<Extract<ShiftAction, { type: 'start-calibration' }>>().toEqualTypeOf<never>()
  })

  it('ignores injected math contents and difficulty in player actions', () => {
    const mathBank = [{ id: 'injected', kind: 'math-fill', prompt: 'Injected answer', timeLimitSeconds: 60, acceptedAnswers: ['yes'] }]
    for (let i = 0; i < 12; i++) {
      const run = confirm(accept(fresh({ ...stage(1, 1000), seed: `trusted-bank:${i}` })), 'intent', 'fine')
      const started = act(run, { station: 'print', type: 'begin-calibration', intentId: 'intent', machineId: 'fine',
        options: { difficulty: 1, mathBank },
      } as unknown as ShiftAction)
      expect(puzzle(started, 'intent')).toEqual(puzzleFor(run, 'intent', 'fine'))
      const definition = puzzle(started, 'intent').definition
      expect(['minesweeper', 'sudoku', 'math-choice', 'math-fill']).toContain(definition.kind)
      if (definition.kind === 'math-choice' || definition.kind === 'math-fill') {
        expect(definition.id).not.toBe('injected')
        expect(MATH_QUESTION_BANK).toContainEqual(definition)
      }
    }
  })

  it('derives survival puzzle difficulty from the saved stage', () => {
    const definition = { ...generateSurvivalStage(20, 'trusted-difficulty'), customers: stage(1, 1000).customers }
    const run = confirm(accept(initializeShift(definition, 'run', START)), 'intent')
    const started = begin(run, 'intent')
    expect(puzzle(started, 'intent')).toEqual(createPuzzle({ shiftSeed: run.seed, shiftRunId: run.id,
      orderId: 'o0', intentId: 'intent', machineId: 'quick', attempt: 1, startedAtMs: START, difficulty: definition.hardPuzzleWeight }))
  })

  it('does not accept a caller claim that a wrong puzzle answer succeeded', () => {
    const run = begin(confirm(accept(fresh(stage(1, 1000))), 'intent'), 'intent')
    const forged = act(run, { station: 'print', type: 'resolve-calibration', puzzleId: puzzle(run, 'intent').id,
      resolution: { status: 'succeeded', answer: { kind: 'number-search', index: 1 } } } as unknown as ShiftEngineAction)
    expect(forged).toEqual(run)
    expect(act(run, { station: 'print', type: 'submit-puzzle', puzzleId: puzzle(run, 'intent').id, answer: { kind: 'number-search', index: -1 } }).authorizations.intent.status).toBe('failed')
  })

  it('generates the persisted puzzle from engine identity instead of caller contents', () => {
    const run = confirm(accept(fresh(stage(1, 1000))), 'intent')
    const started = act(run, { station: 'print', type: 'begin-calibration', intentId: 'intent', machineId: 'quick',
      puzzle: { ...puzzleFor(run, 'intent', 'quick'), deadlineAtMs: START + 999_999, definition: { kind: 'number-search', grid: [1, 2], columns: 2, target: 1, correctIndex: 0 } },
    } as unknown as ShiftEngineAction)
    const expected = createPuzzle({ shiftSeed: run.seed, shiftRunId: run.id, orderId: 'o0', intentId: 'intent', machineId: 'quick', attempt: 1, startedAtMs: START })
    expect(Object.values(started.puzzles)).toEqual([expected])
    const submitted = act(started, { station: 'print', type: 'submit-puzzle', puzzleId: expected.id, answer: { kind: 'number-search', index: 0 } })
    expect(submitted.puzzles[expected.id].result.status).not.toBe('pending')
  })

  it('preserves the confirmed machine and requires it for the first calibration', () => {
    const run = confirm(accept(fresh(stage(1, 1000))), 'intent', 'fine')
    expect(run.authorizations.intent).toMatchObject({ status: 'confirmed', machineId: 'fine' })
    expect(begin(run, 'intent', 'quick')).toEqual(run)
    expect(begin(run, 'intent', 'fine').authorizations.intent).toMatchObject({ status: 'calibrating', machineId: 'fine' })
  })
  it('confirms exactly one stable intent and rejects an intent reused for another snapshot', () => {
    let run = confirm(accept(fresh(stage(2, 1000))), 'intent')
    expect(run.authorizations.intent).toMatchObject({ status: 'confirmed', snapshotId: 'o0:snapshot', orderId: 'o0', nextAttempt: 1 })
    expect(confirm(run, 'intent')).toEqual(run)
    run = archive(accept(run, 'o1'), 'other', 'o1')
    const before = structuredClone(run.authorizations.intent)
    run = act(run, { station: 'print', type: 'confirm-print', snapshotId: 'other', intentId: 'intent', machineId: 'fine' })
    expect(run.authorizations.intent).toEqual(before)
    expect(run.tasks).toEqual({})
  })

  it('counts the active task, queued task, and calibration reservation against capacity three', () => {
    let run = confirm(accept(fresh(stage(1, 1000))), 'waiting')
    run = print(run, 'one')
    run = print(run, 'two')
    run = begin(confirm(run, 'three'), 'three')
    run = confirm(run, 'four')
    const blocked = begin(run, 'waiting')
    expect(blocked).toEqual(run)
    expect(blocked.printers.quick.queuedTaskIds).toEqual(['task:two'])
    expect(blocked.printers.quick.reservations).toHaveLength(1)
    expect(Object.keys(blocked.puzzles)).toHaveLength(3)
    expect(blocked.authorizations.four).toBeUndefined()
    expect(blocked.authorizations.waiting).toMatchObject({ status: 'confirmed', machineId: 'quick' })
  })

  it('times out at the original deadline, releases capacity, and expires only the affected order-machine lock', () => {
    let run = begin(confirm(accept(fresh(stage(2, 1000))), 'intent'), 'intent')
    const deadline = puzzle(run, 'intent').deadlineAtMs
    const deadlineSeconds = (deadline - START) / 1000
    run = advanceShift(run, deadline + 35_000)
    expect(puzzle(run, 'intent').result).toEqual({ status: 'failed', failedAtMs: deadline, reason: 'timeout', answer: null })
    expect(run.printers.quick.reservations).toEqual([])
    expect(run.printers.quick.orderLockUntilMs.o0).toBeUndefined()
    expect(run.authorizations.intent.status).toBe('confirmed')
    expect(begin(run, 'intent', 'quick', deadlineSeconds + 35).authorizations.intent).toMatchObject({ status: 'calibrating', attempt: 2 })
    const failed = advanceShift(begin(confirm(accept(fresh(stage(2, 1000))), 'i'), 'i'), deadline + 1)
    expect(failed.printers.quick.orderLockUntilMs.o0).toBe(deadline + 30_000)
    expect(begin(failed, 'i', 'quick', deadlineSeconds + 1).authorizations.i.status).toBe('failed')
    expect(begin(failed, 'i', 'fine', deadlineSeconds + 1).authorizations.i).toMatchObject({ status: 'calibrating', machineId: 'fine', attempt: 2 })
    let other = accept(failed, 'o1', deadlineSeconds)
    other = begin(confirm(other, 'other', 'quick', 'o1', deadlineSeconds), 'other', 'quick', deadlineSeconds)
    expect(other.authorizations.other.status).toBe('calibrating')
  })

  it('keeps an exact-deadline tick pending for submission and times out only after the boundary', () => {
    const initial = begin(confirm(accept(fresh(stage(1, 1000))), 'intent'), 'intent')
    const instance = puzzle(initial, 'intent')
    const boundary = advanceShift(initial, instance.deadlineAtMs)
    expect(puzzle(boundary, 'intent').result.status).toBe('pending')
    expect(boundary.printers.quick.reservations).toHaveLength(1)
    expect(boundary.lastProcessedAtMs).toBe(instance.deadlineAtMs)
    expect(advanceShift(boundary, instance.deadlineAtMs)).toEqual(boundary)
    const submitted = transitionShift(boundary, { station: 'print', type: 'submit-puzzle', puzzleId: instance.id, answer: answerFor(instance) }, instance.deadlineAtMs)
    expect(submitted.authorizations.intent.status).toBe('calibrated_pending_start')

    const expired = advanceShift(boundary, instance.deadlineAtMs + 1)
    expect(puzzle(expired, 'intent').result).toMatchObject({ status: 'failed', reason: 'timeout', failedAtMs: instance.deadlineAtMs })
    expect(expired.lastProcessedAtMs).toBe(instance.deadlineAtMs + 1)
    expect(expired.printers.quick.reservations).toHaveLength(0)
    expect(expired.printers.quick.orderLockUntilMs.o0).toBe(instance.deadlineAtMs + 30_000)
    expect(expired).toEqual(advanceShift(initial, instance.deadlineAtMs + 1))
    expect(advanceShift(boundary, instance.deadlineAtMs + 30_001)).toEqual(advanceShift(initial, instance.deadlineAtMs + 30_001))
  })

  it('treats wrong answers, exit, and leaving the station as failures with no task', () => {
    const initial = begin(confirm(accept(fresh(stage(1, 1000))), 'intent'), 'intent')
    for (const action of [
      { station: 'print', type: 'submit-puzzle', puzzleId: puzzle(initial, 'intent').id, answer: { kind: 'number-search', index: -1 } },
      { station: 'print', type: 'exit-puzzle', puzzleId: puzzle(initial, 'intent').id },
      { type: 'switch-station', station: 'preparation' },
    ] as const) {
      const run = act(initial, action, 2)
      expect(run.printers.quick.reservations).toEqual([])
      expect(run.printers.quick.orderLockUntilMs.o0).toBe(START + 32_000)
      expect(run.authorizations.intent.status).toBe('failed')
      expect(run.tasks).toEqual({})
    }
  })

  it('records exit failure before explicitly switching an unfinished calibration to the other machine', () => {
    let run = begin(confirm(accept(fresh(stage(1, 1000))), 'intent'), 'intent')
    run = begin(run, 'intent', 'fine', 2)
    expect(puzzle(run, 'intent').result).toEqual({ status: 'failed', failedAtMs: START + 2000, reason: 'exit', answer: null })
    expect(run.printers.quick.reservations).toEqual([])
    expect(run.printers.quick.orderLockUntilMs.o0).toBe(START + 32_000)
    expect(run.authorizations.intent).toMatchObject({ status: 'calibrating', machineId: 'fine', attempt: 2 })
    expect(run.printers.fine.reservations).toHaveLength(1)
  })

  it('pins a successful reservation beyond its puzzle deadline and binds exactly one task', () => {
    let run = succeed(begin(confirm(accept(fresh(stage(1, 1000))), 'intent'), 'intent'), 'intent')
    run = advanceShift(run, START + 20_000)
    expect(run.authorizations.intent.status).toBe('calibrated_pending_start')
    expect(run.printers.quick.reservations[0].status).toBe('calibrated_pending_start')
    expect(begin(run, 'intent', 'fine', 20)).toEqual(run)
    const receipt = receiptFor(run, 'intent', 20)
    run = act(run, { station: 'print', type: 'record-receipt', receipt }, 20)
    expect(run.printers.quick.reservations).toEqual([])
    expect(run.tasks['task:intent']).toMatchObject({ status: 'printing', startedAtMs: START + 20_000, completesAtMs: START + 65_000 })
    expect(act(run, { station: 'print', type: 'record-receipt', receipt }, 20)).toEqual(run)
    expect(begin(run, 'intent', 'fine', 20)).toEqual(run)
    expect(Object.keys(run.tasks)).toEqual(['task:intent'])
  })

  it('grades a submitted answer at its exact deadline while replaying earlier and simultaneous events', () => {
    let run = accept(accept(accept(fresh(stage(3, 1000))), 'o1'), 'o2')
    run = confirm(run, 'answer', 'fine')
    run = confirm(run, 'earlier', 'quick', 'o1')
    run = confirm(run, 'simultaneous', 'quick', 'o2')
    const events = [
      { at: 55, apply: (state: ShiftRun) => print(state, 'printing', 'quick', 'o0', 55) },
      ...([['answer', 'fine', 100], ['earlier', 'quick', 98], ['simultaneous', 'quick', 100]] as const).map(([intent, machine, deadline]) => {
        const duration = (puzzleFor(run, intent, machine).deadlineAtMs - START) / 1000
        const at = deadline - duration
        return { at, apply: (state: ShiftRun) => begin(state, intent, machine, at) }
      }),
    ].sort((left, right) => left.at - right.at)
    for (const event of events) run = event.apply(run)
    const boundary = succeed(run, 'answer', 100)
    expect(boundary.authorizations.answer.status).toBe('calibrated_pending_start')
    expect(puzzle(boundary, 'answer').result).toMatchObject({ status: 'succeeded', submittedAtMs: START + 100_000 })
    expect(puzzle(boundary, 'earlier').result).toMatchObject({ status: 'failed', failedAtMs: START + 98_000, reason: 'timeout' })
    expect(puzzle(boundary, 'simultaneous').result.status).toBe('pending')
    expect(boundary.tasks['task:printing']).toMatchObject({ status: 'ready', readyAtMs: START + 100_000 })
    expect(bind(boundary, 'answer', 100).tasks['task:answer']).toMatchObject({ status: 'printing', startedAtMs: START + 100_000 })
    const late = succeed(run, 'answer', 100.001)
    expect(puzzle(late, 'answer').result).toMatchObject({ status: 'failed', failedAtMs: START + 100_000, reason: 'timeout' })
    expect(puzzle(late, 'simultaneous').result).toMatchObject({ status: 'failed', failedAtMs: START + 100_000, reason: 'timeout' })
    expect(late.authorizations.answer.status).toBe('failed')
  })

  it('ignores caller puzzle identity and validates the complete receipt identity', () => {
    let run = confirm(accept(fresh(stage(1, 1000))), 'intent')
    const puzzle = puzzleFor(run, 'intent', 'quick')
    for (const patch of [{ shiftRunId: 'other' }, { orderId: 'other' }, { intentId: 'other' }, { machineId: 'fine' as const }, { attempt: 99 }, { deadlineAtMs: START }]) {
      const started = act(run, { station: 'print', type: 'begin-calibration', intentId: 'intent', machineId: 'quick', puzzle: { ...puzzle, ...patch } } as unknown as ShiftEngineAction)
      expect(Object.values(started.puzzles)).toEqual([puzzle])
    }
    run = begin(run, 'intent')
    expect(begin(run, 'intent')).toEqual(run)
    run = succeed(run, 'intent')
    const accepted = receiptFor(run, 'intent')
    for (const patch of [{ shiftRunId: 'other' }, { snapshotId: 'other' }, { machineId: 'fine' as const }, { intentId: 'missing' }]) {
      expect(act(run, { station: 'print', type: 'record-receipt', receipt: { ...accepted, ...patch } })).toEqual(run)
    }
    expect(act(run, { station: 'print', type: 'submit-puzzle', puzzleId: puzzle.id, answer: { kind: 'number-search', index: -1 } })).toEqual(run)
  })

  it('releases an authoritatively rejected reservation and keeps the intent terminal', () => {
    let run = succeed(begin(confirm(accept(fresh(stage(1, 1000))), 'intent'), 'intent'), 'intent')
    run = act(run, { station: 'print', type: 'record-receipt', receipt: receiptFor(run, 'intent', 0, false) })
    expect(run.authorizations.intent.status).toBe('rejected')
    expect(run.printers.quick.reservations).toEqual([])
    expect(begin(run, 'intent', 'fine')).toEqual(run)
    expect(run.tasks).toEqual({})
  })

  it('recovers an existing task with matching receipt identity without duplicating or restarting it', () => {
    const pending = succeed(begin(confirm(accept(fresh(stage(1, 1000))), 'intent'), 'intent'), 'intent')
    const receipt = receiptFor(pending, 'intent')
    const bound = bind(pending, 'intent')
    const interrupted: ShiftRun = { ...bound, authorizations: pending.authorizations,
      printers: { ...bound.printers, quick: { ...bound.printers.quick, reservations: pending.printers.quick.reservations } },
      pendingReconciliationIntentIds: ['intent'] }
    const recovered = act(interrupted, { station: 'print', type: 'record-receipt', receipt })
    expect(recovered.authorizations.intent).toEqual(bound.authorizations.intent)
    expect(recovered.tasks).toEqual(bound.tasks)
    expect(recovered.printers).toEqual(bound.printers)
    expect(recovered.pendingReconciliationIntentIds).toEqual([])
    expect(act(recovered, { station: 'print', type: 'record-receipt', receipt })).toEqual(recovered)
  })

  it.each(['running', 'settled'] as const)('terminates a conflicting accepted task identity in a %s shift without overwriting it', (status) => {
    let run = print(accept(fresh(stage(1, 1000))), 'original')
    run = succeed(begin(confirm(run, 'conflict', 'fine'), 'conflict', 'fine'), 'conflict')
    if (status === 'settled') run = advanceShift(run, START + 720_000)
    const existing = structuredClone(run.tasks['task:original'])
    const receipt: PrintReceipt = { ...receiptFor(run, 'conflict'), status: 'accepted', taskId: existing.id,
      authority: 'remote', details: { remoteEvidence: ['accepted', 7] } }
    const resolved = act(run, { station: 'print', type: 'record-receipt', receipt }, status === 'settled' ? 720 : 0)
    expect(resolved.authorizations.conflict).toMatchObject({ status: 'rejected', receipt: {
      status: 'rejected', reasonCode: 'task-id-conflict', authority: 'local', details: { originalReceipt: receipt },
    } })
    expect(resolved.printers.fine.reservations).toEqual([])
    expect(resolved.pendingReconciliationIntentIds).not.toContain('conflict')
    expect(resolved.tasks[existing.id]).toEqual(existing)
    expect(resolved).toMatchObject({ status: 'settled', result: { passed: false, failureReasons: expect.arrayContaining(['corrupt-save']) } })
    expect(act(resolved, { station: 'print', type: 'record-receipt', receipt }, status === 'settled' ? 720 : 0)).toEqual(resolved)
  })

  it.each([['quick', false, 45], ['quick', true, 60], ['fine', false, 65], ['fine', true, 85]] as const)('uses %s duration for complex=%s', (machine, complex, seconds) => {
    const definition = stage(1, 1000)
    const content = definition.customers[0].order
    const modified = { ...content, requirements: { ...content.requirements, surfaceFinishId: complex ? 'emboss' as const : 'matte' as const } }
    const run = print(accept(fresh({ ...definition, customers: [{ ...definition.customers[0], order: modified }] })), 'i', machine)
    expect(run.tasks['task:i'].durationMs).toBe(seconds * 1000)
    expect(advanceShift(run, START + seconds * 1000 - 1).tasks['task:i'].status).toBe('printing')
    expect(advanceShift(run, START + seconds * 1000).tasks['task:i']).toMatchObject({ status: 'ready', readyAtMs: START + seconds * 1000 })
  })

  it('runs both machines concurrently and catches up multiple queue completions at their exact times', () => {
    let run = accept(fresh(stage(1, 1000)))
    for (const machine of ['quick', 'fine'] as const) for (let i = 1; i <= 3; i++) run = print(run, `${machine}${i}`, machine)
    const recovered = advanceShift(run, START + 150_000)
    expect([1, 2, 3].map((i) => recovered.tasks[`task:quick${i}`])).toEqual(expect.arrayContaining([
      expect.objectContaining({ readyAtMs: START + 45_000 }), expect.objectContaining({ readyAtMs: START + 90_000 }), expect.objectContaining({ readyAtMs: START + 135_000 }),
    ]))
    expect(recovered.tasks['task:fine2']).toMatchObject({ readyAtMs: START + 130_000 })
    expect(recovered.tasks['task:fine3']).toMatchObject({ status: 'printing', startedAtMs: START + 130_000, completesAtMs: START + 195_000 })
    let stepped = run
    for (const seconds of [45, 65, 90, 130, 135, 150]) stepped = advanceShift(stepped, START + seconds * 1000)
    expect(stepped).toEqual(recovered)
  })

  it('reorders only a complete permutation of one machine queue', () => {
    let run = accept(fresh(stage(1, 1000)))
    for (const intent of ['a', 'b', 'c']) run = print(run, intent)
    run = print(run, 'fine', 'fine')
    const before = structuredClone(run)
    expect(act(run, { station: 'print', type: 'reorder-queue', machineId: 'quick', taskIds: ['task:fine', 'task:b'] })).toEqual(before)
    expect(act(run, { station: 'print', type: 'reorder-queue', machineId: 'quick', taskIds: ['task:b', 'task:b'] })).toEqual(before)
    run = act(run, { station: 'print', type: 'reorder-queue', machineId: 'quick', taskIds: ['task:c', 'task:b'] })
    expect(advanceShift(run, START + 45_000).printers.quick.currentTaskId).toBe('task:c')
    expect(run.printers.fine).toEqual(before.printers.fine)
  })
})

describe('delivery, rescue, and global deadlines', () => {
  it('delivery expires other uncalibrated intents and frees capacity while preserving successful work', () => {
    let run = print(accept(accept(fresh(stage(2, 1000))), 'o1'), 'ready')
    run = print(run, 'bound', 'fine')
    run = succeed(begin(confirm(run, 'pending'), 'pending'), 'pending')
    run = begin(confirm(run, 'calibrating', 'fine', 'o0', 44), 'calibrating', 'fine', 44)
    run = confirm(run, 'confirmed', 'fine', 'o0', 44)
    run = begin(confirm(run, 'failed', 'fine', 'o0', 44), 'failed', 'fine', 44)
    run = act(run, { station: 'print', type: 'exit-puzzle', puzzleId: puzzle(run, 'failed').id }, 44)
    const delivered = act(run, { station: 'print', type: 'deliver', taskId: 'task:ready' }, 45)
    for (const id of ['confirmed', 'calibrating', 'failed']) expect(delivered.authorizations[id]).toMatchObject({ status: 'expired_unprinted', expiredAtMs: START + 45_000 })
    const expiredPuzzle = puzzle(delivered, 'calibrating')
    expect(expiredPuzzle.result).toEqual({ status: 'failed', failedAtMs: START + 45_000, reason: 'exit', answer: null })
    expect(act(delivered, { station: 'print', type: 'submit-puzzle', puzzleId: expiredPuzzle.id, answer: answerFor(expiredPuzzle) }, 45)).toEqual(delivered)
    expect(delivered.printers.fine.reservations).toEqual([])
    expect(delivered.authorizations.pending.status).toBe('calibrated_pending_start')
    expect(delivered.printers.quick.reservations.map((reservation) => reservation.intentId)).toEqual(['pending'])
    expect(delivered.authorizations.bound.status).toBe('bound')
    expect(begin(confirm(delivered, 'other-order', 'fine', 'o1', 45), 'other-order', 'fine', 45).authorizations['other-order'].status).toBe('calibrating')
    const completed = advanceShift(bind(delivered, 'pending', 45), START + 110_000)
    expect(completed.tasks['task:pending'].status).toBe('unclaimed')
    expect(completed.tasks['task:bound'].status).toBe('unclaimed')
  })

  it('expires only uncalibrated intents when a customer leaves and releases their puzzle capacity', () => {
    let run = print(accept(fresh(stage(1, 1))), 'bound')
    run = succeed(begin(confirm(run, 'pending', 'fine'), 'pending', 'fine'), 'pending')
    run = begin(confirm(run, 'failed'), 'failed')
    run = act(run, { station: 'print', type: 'exit-puzzle', puzzleId: puzzle(run, 'failed').id })
    run = begin(confirm(run, 'calibrating', 'fine', 'o0', 20), 'calibrating', 'fine', 20)
    run = confirm(run, 'confirmed', 'fine', 'o0', 20)
    const departed = advanceShift(run, START + 21_000)
    for (const id of ['confirmed', 'calibrating', 'failed']) expect(departed.authorizations[id]).toMatchObject({ status: 'expired_unprinted', expiredAtMs: START + 21_000 })
    expect(puzzle(departed, 'calibrating').result).toMatchObject({ status: 'failed', failedAtMs: START + 21_000, reason: 'exit' })
    expect(departed.printers.fine.reservations.map((reservation) => reservation.intentId)).toEqual(['pending'])
    expect(departed.authorizations.pending.status).toBe('calibrated_pending_start')
    expect(departed.authorizations.bound.status).toBe('bound')
    const expiredPuzzle = puzzle(departed, 'calibrating')
    expect(act(departed, { station: 'print', type: 'submit-puzzle', puzzleId: expiredPuzzle.id, answer: answerFor(expiredPuzzle) }, 21)).toEqual(departed)
    expect(act(departed, { station: 'print', type: 'record-receipt', receipt: {
      receiptId: 'late-expired', intentId: 'calibrating', shiftRunId: run.id, snapshotId: 'o0:snapshot', machineId: 'fine',
      status: 'accepted', taskId: 'must-not-create', receivedAtMs: START + 21_000, authority: 'local', details: null,
    } }, 21)).toEqual(departed)
  })
  it('requires a ready matching task, evaluates the immutable artwork, and immediately releases the active slot', () => {
    let run = fresh(stage(4, 1000))
    for (const id of ['o0', 'o1', 'o2']) run = accept(run, id)
    run = print(correctCard(run), 'i')
    expect(act(run, { station: 'print', type: 'deliver', taskId: 'task:i' }).orders[0].outcome.status).toBe('pending')
    run = act(run, { station: 'print', type: 'deliver', taskId: 'task:i' }, 45)
    expect(order(run).outcome).toMatchObject({ status: 'delivered', deliveredAtMs: START + 45_000, evaluation: { satisfied: true, timeliness: 9.73 } })
    expect(run.tasks['task:i'].status).toBe('delivered')
    expect(accept(run, 'o3', 45).activeOrderIds).toEqual(['o1', 'o2', 'o3'])
    expect(act(run, { station: 'print', type: 'deliver', taskId: 'task:i' }, 45)).toEqual(run)
  })

  it('preserves drafts, snapshots and tasks after departure, and late prints become unclaimed', () => {
    let run = print(accept(fresh(stage(1, 10))), 'i')
    run = advanceShift(run, START + 45_000)
    expect(order(run).outcome).toMatchObject({ status: 'left', leftAtMs: START + 30_000 })
    expect(run.tasks['task:i']).toMatchObject({ status: 'unclaimed', readyAtMs: START + 45_000, unclaimedAtMs: START + 45_000 })
    expect(run.snapshots['o0:snapshot']).toBeDefined()
    expect(run.drafts[draftId(run)]).toBeDefined()
    expect(act(run, { station: 'print', type: 'deliver', taskId: 'task:i' }, 45)).toEqual(run)
  })

  it('expedites one queued task to the front with half work without interrupting either machine', () => {
    let run = accept(accept(accept(fresh(stage(3, 1000))), 'o1'), 'o2')
    run = print(run, 'active')
    run = print(run, 'queued', 'quick', 'o1')
    run = print(run, 'rush', 'quick', 'o2')
    run = print(run, 'fine', 'fine', 'o0')
    const other = structuredClone(run.tasks['task:fine'])
    run = act(run, { station: 'print', type: 'expedite', taskId: 'task:rush' }, 10)
    expect(run.printers.quick.queuedTaskIds).toEqual(['task:rush', 'task:queued'])
    expect(run.tasks['task:rush']).toMatchObject({ durationMs: 22_500, expedited: true })
    expect(run.tasks['task:active']).toMatchObject({ completesAtMs: START + 45_000 })
    expect(run.tasks['task:fine']).toEqual(other)
    expect(advanceShift(run, START + 67_500).tasks['task:rush']).toMatchObject({ status: 'ready', readyAtMs: START + 67_500 })
    expect(act(run, { station: 'reception', type: 'explain-progress', orderId: 'o2' }, 10).remedies.explainProgressAvailable).toBe(true)
    expect(act(run, { station: 'print', type: 'expedite', taskId: 'task:queued' }, 10)).toEqual(run)
  })

  it('halves active remaining work and cannot expedite a mere authorization or an explained customer', () => {
    const initial = print(accept(fresh(stage(1, 1000))), 'i')
    const rushed = act(initial, { station: 'print', type: 'expedite', taskId: 'task:i' }, 10)
    expect(rushed.tasks['task:i']).toMatchObject({ completesAtMs: START + 27_500, expedited: true })
    const explained = act(initial, { station: 'reception', type: 'explain-progress', orderId: 'o0' })
    expect(act(explained, { station: 'print', type: 'expedite', taskId: 'task:i' })).toEqual(explained)
    const confirmed = confirm(accept(fresh(stage(1, 1000))), 'i')
    expect(act(confirmed, { station: 'print', type: 'expedite', taskId: 'i' })).toEqual(confirmed)
  })

  it('freezes final wait, printers, puzzles, locks, arrivals, and closing for exactly one pause interval', () => {
    const definition = stage(4, 35)
    let run = fresh({ ...definition, customers: definition.customers.map((customer, i) => ({ ...customer, arrivalSeconds: i === 3 ? 100 : 0, basePatienceSeconds: i === 1 ? 500 : 35 })) })
    for (const id of ['o0', 'o1', 'o2']) run = accept(run, id)
    run = print(run, 'printing')
    run = begin(confirm(run, 'puzzle', 'fine', 'o1', 40), 'puzzle', 'fine', 40)
    run = begin(confirm(run, 'failure', 'quick', 'o2', 40), 'failure', 'quick', 40)
    run = act(run, { station: 'print', type: 'exit-puzzle', puzzleId: puzzle(run, 'failure').id }, 40)
    const puzzleDeadline = puzzle(run, 'puzzle').deadlineAtMs
    run = act(run, { type: 'pause', reason: 'tutorial' }, 40)
    expect(advanceShift(run, START + 500_000)).toEqual(run)
    run = act(run, { type: 'resume' }, 140)
    expect(run.deadlineAtMs).toBe(START + 820_000)
    expect(order(run).acceptedAtMs).toBe(START)
    expect(order(run).patience).toMatchObject({ startedAtMs: START + 135_000, deadlineAtMs: START + 155_000 })
    expect(order(run, 'o3').arrivalAtMs).toBe(START + 200_000)
    expect(run.tasks['task:printing']).toMatchObject({ completesAtMs: START + 145_000 })
    expect(puzzle(run, 'puzzle').deadlineAtMs).toBe(puzzleDeadline + 100_000)
    expect(run.printers.quick.orderLockUntilMs.o2).toBe(START + 170_000)
    expect(advanceShift(run, puzzleDeadline + 100_001).printers.fine.orderLockUntilMs.o1).toBe(puzzleDeadline + 130_000)
  })

  it('inspection advances logical time while retaining canonical printer, puzzle, and lock deadlines', () => {
    let run = accept(accept(accept(fresh(stage(3, 1000))), 'o1'), 'o2')
    run = print(run, 'printing')
    run = begin(confirm(run, 'failure', 'quick', 'o2', 20), 'failure', 'quick', 20)
    run = act(run, { station: 'print', type: 'exit-puzzle', puzzleId: puzzle(run, 'failure').id }, 20)
    run = confirm(run, 'puzzle', 'quick', 'o1', 20)
    const duration = (puzzleFor(run, 'puzzle', 'quick').deadlineAtMs - START) / 1000
    run = begin(run, 'puzzle', 'quick', 44 - duration)
    run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false }, 42)
    expect(run.tasks['task:printing']).toMatchObject({ status: 'ready', readyAtMs: START + 45_000 })
    expect(puzzle(run, 'puzzle').result).toMatchObject({ failedAtMs: START + 44_000, reason: 'timeout' })
    expect(run.printers.quick.orderLockUntilMs.o1).toBe(START + 74_000)
    expect(run.printers.quick.orderLockUntilMs.o2).toBe(START + 50_000)
    expect(run.lastProcessedAtMs).toBe(START + 47_000)
    expect(run.snapshots['o0:snapshot'].savedAtMs).toBe(START)
    expect(order(run).acceptedAtMs).toBe(START)
    expect(advanceShift(run, START + 42_000)).toEqual(run)
    const elapsed = advanceShift(run, START + 45_000)
    expect(elapsed.lastProcessedAtMs).toBe(START + 50_000)
    expect(elapsed.printers.quick.orderLockUntilMs.o2).toBeUndefined()
    expect(elapsed.printers.quick.orderLockUntilMs.o1).toBe(START + 74_000)
  })

  it('closing expires uncalibrated authorizations, preserves reconciliation, and finishes old tasks as unclaimed', () => {
    let run = accept(accept(accept(fresh(stage(3, 1000))), 'o1'), 'o2')
    run = confirm(run, 'confirmed', 'quick', 'o0', 700)
    run = begin(confirm(run, 'failed', 'fine', 'o1', 700), 'failed', 'fine', 700)
    run = act(run, { station: 'print', type: 'exit-puzzle', puzzleId: puzzle(run, 'failed').id }, 700)
    run = succeed(begin(confirm(run, 'pending', 'fine', 'o2', 700), 'pending', 'fine', 700), 'pending', 700)
    run = print(run, 'bound', 'quick', 'o2', 700)
    run = begin(confirm(run, 'calibrating', 'quick', 'o0', 715), 'calibrating', 'quick', 715)
    run = advanceShift(run, START + 900_000)
    expect(run.status).toBe('settled')
    expect(run.orders.every((customer) => customer.outcome.status === 'left' && customer.outcome.reason === 'closing')).toBe(true)
    for (const intent of ['confirmed', 'calibrating', 'failed']) expect(run.authorizations[intent]).toMatchObject({ status: 'expired_unprinted', expiredAtMs: START + 720_000 })
    expect(run.authorizations.pending.status).toBe('calibrated_pending_start')
    expect(run.pendingReconciliationIntentIds).toEqual(['pending'])
    expect(run.authorizations.bound.status).toBe('bound')
    expect(run.tasks['task:bound'].status).toBe('printing')
    run = bind(run, 'pending', 900)
    expect(run.pendingReconciliationIntentIds).toEqual([])
    expect(run.tasks['task:pending'].shiftRunId).toBe('run')
    run = finishClosedShiftPrints(run)
    expect(Object.values(run.tasks).every((task) => task.status === 'unclaimed')).toBe(true)
    expect(run.printers.quick.currentTaskId).toBeNull()
    if (run.status === 'settled') expect(run.result).toMatchObject({ delivered: 0, left: 3, closedAtMs: START + 720_000 })
  })

  it('never starts a late reconciled old-shift task before the receipt transaction creates it', () => {
    let run = print(accept(fresh(stage(1, 1000))), 'bound', 'quick', 'o0', 700)
    run = succeed(begin(confirm(run, 'pending', 'quick', 'o0', 700), 'pending', 'quick', 700), 'pending', 700)
    run = advanceShift(run, START + 720_000)
    run = bind(run, 'pending', 900)
    run = finishClosedShiftPrints(run)
    expect(run.tasks['task:pending']).toMatchObject({ status: 'unclaimed', createdAtMs: START + 900_000, readyAtMs: START + 945_000 })
  })

  it('applies authored thresholds only at settlement and preserves exact delivered counts and average', () => {
    let run = fresh(stage(5, 1000))
    for (let i = 0; i < 4; i++) {
      const seconds = i * 45
      run = accept(run, `o${i}`, seconds)
      if (i < 3) run = correctCard(run, `o${i}`, seconds)
      run = print(run, `i${i}`, 'quick', `o${i}`, seconds)
      run = act(run, { station: 'print', type: 'deliver', taskId: `task:i${i}` }, seconds + 45)
    }
    expect(run.status).toBe('running')
    const scores = run.orders.flatMap((customer) => customer.outcome.status === 'delivered' ? [customer.outcome.evaluation.score] : [])
    run = advanceShift(run, START + 720_000)
    if (run.status !== 'settled') throw new Error('Expected settlement')
    expect(run.result).toMatchObject({ delivered: 4, satisfied: 3, left: 1, passed: true, failureReasons: [], averageScore: scores.reduce((a, b) => a + b, 0) / 4 })
  })

  it('uses survival ceil(70%) and strictly more than half of delivered satisfaction', () => {
    const template = generateSurvivalStage(1, 'settlement')
    const definition = { ...template, customers: stage(7, 1000).customers }
    let run = initializeShift(definition, 'run', START)
    for (let i = 0; i < 5; i++) {
      const seconds = i * 45
      run = accept(run, `o${i}`, seconds)
      if (i < 2) run = correctCard(run, `o${i}`, seconds)
      run = print(run, `i${i}`, 'quick', `o${i}`, seconds)
      run = act(run, { station: 'print', type: 'deliver', taskId: `task:i${i}` }, seconds + 45)
    }
    run = advanceShift(run, START + 720_000)
    if (run.status !== 'settled') throw new Error('Expected settlement')
    expect(run.result).toMatchObject({ delivered: 5, satisfied: 2, left: 2, passed: false, failureReasons: ['satisfaction'] })
  })
})

describe('inspection and progress remedy', () => {
  it('keeps wall-clock time moving after each inspection and after a serialized restore', () => {
    let run = accept(fresh(stage(1, 100)))
    const inspect = { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false } as const
    run = act(run, inspect)
    run = advanceShift(run, START + 1_000)
    expect(run.lastProcessedAtMs).toBe(START + 6_000)
    expect(order(run).patience).toMatchObject({ remainingSeconds: 94, updatedAtMs: START + 6_000 })

    run = prepare(run, { paperId: 'pink' }, 'o0', 2)
    expect(run.lastProcessedAtMs).toBe(START + 7_000)
    run = act(run, inspect, 2)
    expect(run.lastProcessedAtMs).toBe(START + 12_000)
    expect(run.drafts[draftId(run)].inspections.map(report => report.checkedAtMs)).toEqual([START, START + 7_000])
    expect(advanceShift(run, START + 2_000)).toEqual(run)

    const restored = advanceShift(JSON.parse(JSON.stringify(run)), START + 3_000)
    expect(restored.lastProcessedAtMs).toBe(START + 13_000)
    expect(restored.deadlineAtMs).toBe(START + 720_000)
    expect(order(restored).patience).toMatchObject({ remainingSeconds: 87, updatedAtMs: START + 13_000 })
  })

  it('starts a later confirmed print on the inspection-adjusted clock', () => {
    let run = succeed(begin(confirm(accept(fresh(stage(1, 100))), 'i'), 'i'), 'i')
    run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false })
    run = bind(run, 'i', 1)
    expect(run.tasks['task:i']).toMatchObject({ status: 'printing', createdAtMs: START + 6_000,
      startedAtMs: START + 6_000, completesAtMs: START + 51_000 })
    expect(advanceShift(run, START + 46_000).tasks['task:i']).toMatchObject({ status: 'ready', readyAtMs: START + 51_000 })
  })

  it('charges an atomic five seconds twice at one wall timestamp, and refresh charges nothing extra', () => {
    let run = accept(fresh(stage(2, 100, 0)))
    const inspect = () => { run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false }) }
    inspect()
    inspect()
    expect(run.deadlineAtMs).toBe(START + 720_000)
    expect(run.lastProcessedAtMs).toBe(START + 10_000)
    expect(run.drafts[draftId(run)].inspections.map((inspection) => inspection.checkedAtMs)).toEqual([START, START + 5000])
    expect(order(run).patience).toMatchObject({ remainingSeconds: 90, updatedAtMs: START + 10_000 })
    expect(order(run, 'o1').patience).toMatchObject({ remainingSeconds: 96.5 })
    expect(advanceShift(run, START)).toEqual(run)
  })

  it('records all current issues once, retains old reports by revision, and separates the free demo quota', () => {
    let run = accept(fresh(stage(1, 500)))
    const inspect = (freeDemo: boolean) => { run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo }) }
    inspect(true)
    const report = structuredClone(run.drafts[draftId(run)].inspections[0])
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['paper-color-mismatch', 'shape-mismatch', 'layout-mismatch', 'required-content-missing']))
    expect(run.inspectionsRemaining).toBe(3)
    expect(run.freeDemoInspectionsRemaining).toBe(0)
    inspect(true)
    expect(run.drafts[draftId(run)].inspections).toHaveLength(1)
    run = prepare(run, { paperId: 'pink' })
    for (let i = 0; i < 3; i++) inspect(false)
    expect(run.drafts[draftId(run)].inspections[0]).toEqual(report)
    expect(run.drafts[draftId(run)].revision).toBeGreaterThan(report.draftRevision)
    const before = structuredClone(run)
    inspect(false)
    expect(run).toEqual(before)
    expect(archive(run).snapshotIds).toEqual(['snap'])
  })

  it('processes future arrivals and final wait crossings at their original forward event times', () => {
    const definition = stage(2, 2)
    let run = accept(fresh({ ...definition, customers: definition.customers.map((customer, i) => ({ ...customer, arrivalSeconds: i * 3 })) }))
    run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false })
    expect(order(run).patience).toMatchObject({ phase: 'last_wait', startedAtMs: START + 2000, deadlineAtMs: START + 22_000 })
    expect(order(run, 'o1').arrivalAtMs).toBe(START + 3000)
    expect(order(run, 'o1').patience).toMatchObject({ phase: 'normal', remainingSeconds: 1.3 })
  })

  it('does not move task starts before their creation when inspection completes the previous task', () => {
    let run = print(accept(fresh(stage(1, 1000))), 'first')
    run = print(run, 'queued', 'quick', 'o0', 44)
    run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false }, 44)
    expect(run.tasks['task:first']).toMatchObject({ status: 'ready', readyAtMs: START + 45_000 })
    expect(run.tasks['task:queued']).toMatchObject({ status: 'printing', createdAtMs: START + 44_000, startedAtMs: START + 45_000, completesAtMs: START + 90_000 })
    expect(run.lastProcessedAtMs).toBe(START + 49_000)
  })

  it('never produces negative event timestamps when inspecting at the beginning of a zero-based shift', () => {
    let run = initializeShift(stage(2, 2), 'zero-run', 0)
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: 'o0' }, 0)
    run = transitionShift(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false }, 0)
    expect(run.startedAtMs).toBe(0)
    expect(order(run).patience).toMatchObject({ phase: 'last_wait', startedAtMs: 2000, deadlineAtMs: 22_000 })
    expect(run.lastProcessedAtMs).toBe(5000)
  })

  it('settles an inspection across closing after its recorded check without moving the closing deadline', () => {
    let run = accept(fresh(stage(1, 1000)))
    run = act(run, { station: 'inspection', type: 'inspect', draftId: draftId(run), freeDemo: false }, 718)
    const report = run.drafts[draftId(run)].inspections[0]
    expect(report.checkedAtMs).toBe(START + 718_000)
    expect(run.deadlineAtMs).toBe(START + 720_000)
    expect(run).toMatchObject({ status: 'settled', lastProcessedAtMs: START + 720_000, result: { closedAtMs: START + 720_000 } })
  })

  it('adds exactly 25s to eventual or current final wait without restoring its original duration', () => {
    let run = accept(fresh(stage(2, 35)))
    run = act(run, { station: 'reception', type: 'explain-progress', orderId: 'o0' }, 5)
    const extended = advanceShift(run, START + 35_000)
    expect(order(extended).patience).toMatchObject({ phase: 'normal', depletesAtMs: START + 60_000, remainingSeconds: 25 })
    expect(order(advanceShift(extended, START + 60_000)).patience).toEqual({ phase: 'last_wait', startedAtMs: START + 60_000, deadlineAtMs: START + 80_000, originalDurationSeconds: 20 })
    expect(act(extended, { station: 'reception', type: 'explain-progress', orderId: 'o1' }, 35).orders[1].remedy).toBe('none')
    expect(order(advanceShift(extended, START + 79_999)).outcome.status).toBe('pending')
    expect(order(advanceShift(extended, START + 80_000)).outcome.status).toBe('left')
    const current = act(advanceShift(accept(fresh()), START + 40_000), { station: 'reception', type: 'explain-progress', orderId: 'o0' }, 40)
    expect(order(current).patience).toMatchObject({ startedAtMs: START + 35_000, deadlineAtMs: START + 80_000, originalDurationSeconds: 20 })
  })
})
