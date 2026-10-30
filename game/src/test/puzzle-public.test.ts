import { describe, expect, it } from 'vitest'
import { createPuzzle, gradePuzzle, revealPuzzle, toPublicPuzzleInstance } from '../../server/puzzles'
import type { PrivatePuzzleDefinition, PrivatePuzzleInstance } from '../../server/private-puzzle-types'
import { validatePublicPuzzleDefinition } from '../domain/puzzle-public'

const input = { shiftSeed: 'stage', shiftRunId: 'run-one', orderId: 'order', intentId: 'intent', machineId: 'quick' as const, attempt: 1, startedAtMs: 1000 }
const mines: PrivatePuzzleDefinition = { kind: 'minesweeper', rows: 3, columns: 4, mineIndices: [0, 3], revealedIndices: [4, 5, 6, 7, 8, 9, 10, 11] }
const definitions: readonly PrivatePuzzleDefinition[] = [
  { kind: 'number-search', columns: 2, grid: [31, 13, 37, 73], target: 37, correctIndex: 2 },
  { kind: 'connect', nodes: [{ id: '1', x: .2, y: .2 }, { id: '2', x: .8, y: .8 }], correctPath: ['1', '2'] },
  { kind: 'identify', prompt: '找出：红色、圆形、正向', target: { color: '红色', shape: '圆形', direction: 'upright' }, options: [
    { id: 'a', color: '红色', shape: '圆形', direction: 'upright' }, { id: 'b', color: '蓝色', shape: '圆形', direction: 'upright' },
  ], correctOptionId: 'a' },
  mines,
  { kind: 'sudoku', size: 4, boxRows: 2, boxColumns: 2, givens: [0, 2, 3, 4, 3, 0, 1, 2, 2, 1, 0, 3, 4, 3, 2, 0], solution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] },
  { kind: 'math-choice', id: 'choice', prompt: '选出正确选项', timeLimitSeconds: 60, options: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }], correctOptionIds: ['a'], multiple: true },
  { kind: 'math-fill', id: 'fill', prompt: '填写答案', timeLimitSeconds: 60, acceptedAnswers: ['answer'] },
]
function saved(definition: PrivatePuzzleDefinition): PrivatePuzzleInstance {
  return { ...createPuzzle(input), machineId: 'fine', deadlineAtMs: 61_000, definition }
}

describe('public puzzle boundary', () => {
  it.each(definitions)('projects $kind without standard answers or its private seed', definition => {
    const puzzle = toPublicPuzzleInstance(saved(definition))
    expect(validatePublicPuzzleDefinition(puzzle.definition)).toEqual({ valid: true, issues: [] })
    expect(Object.hasOwn(puzzle, 'seed')).toBe(false)
    expect(JSON.stringify(puzzle)).not.toMatch(/correctIndex|correctPath|correctOptionId|mineIndices|revealedIndices|solution|correctOptionIds|acceptedAnswers/)
    expect(validatePublicPuzzleDefinition({ ...puzzle.definition, acceptedAnswers: ['injected'] }).valid).toBe(false)
  })

  it('preserves the authored multiple-choice mode even with a single accepted option', () => {
    expect(toPublicPuzzleInstance(saved(definitions[5])).definition).toMatchObject({ kind: 'math-choice', multiple: true })
  })

  it('keeps a run stable and incorporates a fresh run identity into generation', () => {
    expect(createPuzzle(input)).toEqual(createPuzzle({ ...input }))
    const next = createPuzzle({ ...input, shiftRunId: 'run-two' })
    expect(next.seed).not.toEqual(createPuzzle(input).seed)
    expect(JSON.parse(next.seed)).toEqual(['stage', 'run-two', 'order', 'quick', 1])
  })

  it('requires authoritative safe-cell reveals before a minesweeper answer can succeed', () => {
    const puzzle = saved(mines)
    const answer = { kind: 'minesweeper' as const, flaggedIndices: [0, 3], revealedIndices: [1, 2, 4, 5, 6, 7, 8, 9, 10, 11] }
    expect(gradePuzzle(puzzle, answer, 2000)).toMatchObject({ status: 'failed', reason: 'wrong' })
    const revealed = revealPuzzle(revealPuzzle(puzzle, 1, 1500), 2, 1600)
    expect(toPublicPuzzleInstance(revealed).definition).toMatchObject({ revealedCells: expect.arrayContaining([{ index: 1, clue: 1 }, { index: 2, clue: 1 }]) })
    expect(gradePuzzle(revealed, answer, 2000)).toMatchObject({ status: 'succeeded' })
    expect(revealPuzzle(puzzle, 0, 1500).result).toMatchObject({ status: 'failed', reason: 'wrong', answer: null })
    expect(revealPuzzle(puzzle, 1, 61_001).result).toMatchObject({ status: 'failed', reason: 'timeout' })
  })
})
