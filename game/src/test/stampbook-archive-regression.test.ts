import { expect, it } from 'vitest'
import { createPuzzle, gradePuzzle, toPublicPuzzle } from '../../server/puzzles'
import type { PrivatePuzzleInstance } from '../../server/private-puzzle-types'
import { AUTHORED_STAGES, LAYOUTS } from '../content/production'
import { initializeShift, transitionShift, type ShiftPuzzleServices } from '../domain/shift-engine'
import type { PuzzleAnswer, ShiftAction, ShiftSnapshot } from '../domain/shift-types'
import { BrowserShiftStore, IndexedDbShiftCoordinator } from '../infrastructure/shift-store'

const START = 1_000_000

function answerFor({ definition }: PrivatePuzzleInstance): PuzzleAnswer {
  switch (definition.kind) {
    case 'number-search': return { kind: definition.kind, index: definition.correctIndex }
    case 'connect': return { kind: definition.kind, path: definition.correctPath }
    case 'identify': return { kind: definition.kind, optionId: definition.correctOptionId }
    case 'sudoku': return { kind: definition.kind, cells: definition.solution }
    case 'minesweeper': return { kind: definition.kind, flaggedIndices: definition.mineIndices,
      revealedIndices: Array.from({ length: definition.rows * definition.columns }, (_, index) => index)
        .filter(index => !definition.mineIndices.includes(index)) }
    case 'math-choice': return { kind: definition.kind, optionIds: definition.correctOptionIds }
    case 'math-fill': return { kind: definition.kind, text: definition.acceptedAnswers[0] }
  }
}

it('persists Cocoa calibration and delivery before archiving Megu and Natsume in the tutorial', async () => {
  const store = new BrowserShiftStore(window.localStorage, { locks: null, transactions: new IndexedDbShiftCoordinator() })
  const privatePuzzles = new Map<string, PrivatePuzzleInstance>()
  const services: ShiftPuzzleServices = {
    createPuzzle(input) {
      const instance = createPuzzle(input)
      privatePuzzles.set(instance.id, instance)
      return toPublicPuzzle(instance)
    },
    // The server grades before its response reaches the engine's next clock tick.
    gradePuzzle: (instance, answer, at) => gradePuzzle(privatePuzzles.get(instance.id)!, answer,
      instance.machineId === 'fine' ? at - 2 : at),
  }
  let saved: ShiftSnapshot = { version: 1, revision: 0, savedAtMs: START,
    run: initializeShift(AUTHORED_STAGES.tutorial, 'stampbook-archive-regression', START) }
  let at = START
  await store.saveCurrent(saved)
  const dispatch = async (action: ShiftAction) => {
    const candidate: ShiftSnapshot = { ...saved, revision: saved.revision + 1, savedAtMs: at,
      run: transitionShift(saved.run, action, at, services) }
    const checkpoint = `${action.type} / ${candidate.run.selectedOrderId ?? 'no selection'} / revision ${candidate.revision}`
    try {
      saved = await (action.type === 'archive' ? store.saveArchive(candidate, saved.revision) : store.saveCurrent(candidate, saved.revision))
    } catch (cause) {
      throw new Error(`Persistence failed at ${checkpoint}`, { cause })
    }
  }
  const craftAndArchive = async (index: number) => {
    const customer = saved.run.stage.customers[index]
    await dispatch({ type: 'switch-station', station: 'reception' })
    await dispatch({ station: 'reception', type: 'accept-order', orderId: customer.id })
    const draft = Object.values(saved.run.drafts).find(draft => draft.orderId === customer.id)!
    expect(draft, `accepted ${customer.order.customer.name}`).toBeDefined()
    const { requirements } = customer.order
    const { paperId, paperMaterialId, shapeId, orientation, layoutId, surfaceFinishId } = requirements
    await dispatch({ type: 'switch-station', station: 'preparation' })
    await dispatch({ station: 'preparation', type: 'select-preparation', draftId: draft.id,
      selection: { paperId, paperMaterialId, shapeId, orientation, layoutId, surfaceFinishId } })
    await dispatch({ station: 'preparation', type: 'cut-blank', draftId: draft.id })
    await dispatch({ type: 'switch-station', station: 'assembly' })
    const occupied = new Set<string>()
    for (const requirement of requirements.elements) {
      const slot = LAYOUTS.find(layout => layout.id === layoutId)!.slots
        .find(slot => slot.accepts.includes(requirement.kind) && !occupied.has(slot.id))!
      occupied.add(slot.id)
      await dispatch({ station: 'assembly', type: 'place-element', draftId: draft.id, element: {
        id: `${customer.id}:${requirement.id}`, assetId: requirement.assetId, kind: requirement.kind,
        slotId: slot.id, size: slot.sizes[0], direction: 'upright', layer: 'front',
      } })
    }
    await dispatch({ station: 'assembly', type: 'fix-assembly', draftId: draft.id })
    expect(requirements.crafts).toEqual([])
    await dispatch({ type: 'switch-station', station: 'print' })
    const snapshotId = `card:${customer.id}`
    await dispatch({ station: 'print', type: 'archive', draftId: draft.id, snapshotId })
    expect(saved.run.drafts[draft.id]).toMatchObject({ stage: 'archived', snapshotId })
    return snapshotId
  }

  const snapshotId = await craftAndArchive(0)
  const intentId = 'cocoa:quick'
  await dispatch({ station: 'print', type: 'confirm-print', snapshotId, intentId, machineId: 'quick' })
  await dispatch({ station: 'print', type: 'begin-calibration', intentId, machineId: 'quick' })
  const authorization = saved.run.authorizations[intentId]
  expect(authorization.status).toBe('calibrating')
  if (authorization.status !== 'calibrating') throw new Error('Expected Cocoa calibration')
  const puzzle = privatePuzzles.get(authorization.puzzleId)!
  at += 1000
  await dispatch({ station: 'print', type: 'submit-puzzle', puzzleId: puzzle.id, answer: answerFor(puzzle) })
  expect(saved.run.authorizations[intentId].status).toBe('calibrated_pending_start')
  await dispatch({ station: 'print', type: 'record-receipt', receipt: {
    status: 'accepted', receiptId: 'receipt:cocoa', taskId: 'task:cocoa', intentId, snapshotId,
    machineId: 'quick', shiftRunId: saved.run.id, receivedAtMs: at, authority: 'local', details: null,
  } })
  const task = saved.run.tasks['task:cocoa']
  expect(task.status).toBe('printing')
  if (task.status !== 'printing') throw new Error('Expected Cocoa print task')
  at = task.completesAtMs
  await dispatch({ type: 'advance-time', nowMs: at })
  await dispatch({ station: 'print', type: 'deliver', taskId: task.id })
  expect(saved.run.orders[0].outcome).toMatchObject({ status: 'delivered', evaluation: { satisfied: true } })

  at = Math.max(at, START + 75_000)
  const meguSnapshotId = await craftAndArchive(1)
  const meguIntentId = 'megu:fine'
  await dispatch({ station: 'print', type: 'confirm-print', snapshotId: meguSnapshotId, intentId: meguIntentId, machineId: 'fine' })
  await dispatch({ station: 'print', type: 'begin-calibration', intentId: meguIntentId, machineId: 'fine' })
  const meguAuthorization = saved.run.authorizations[meguIntentId]
  if (meguAuthorization.status !== 'calibrating') throw new Error('Expected Megu calibration')
  at += 1000
  await dispatch({ station: 'print', type: 'submit-puzzle', puzzleId: meguAuthorization.puzzleId,
    answer: answerFor(privatePuzzles.get(meguAuthorization.puzzleId)!) })
  expect(saved.run.authorizations[meguIntentId].status).toBe('calibrated_pending_start')
  at = START + 140_000
  await craftAndArchive(2)
  expect((await store.loadCurrent())?.run.snapshotIds).toEqual(saved.run.snapshotIds)
  expect((await store.listCollectedCards()).map(card => card.id)).toEqual(saved.run.snapshotIds)
  expect(saved.run.printers.fine.reservations).toMatchObject([{ intentId: meguIntentId, status: 'calibrated_pending_start' }])
})
