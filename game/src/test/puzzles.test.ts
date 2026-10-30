import { describe, expect, it } from 'vitest'
import * as puzzles from '../../server/puzzles'
import type { PuzzleAnswer } from '../domain/shift-types'
import type { MathQuestion, PrivatePuzzleDefinition as PuzzleDefinition, PrivatePuzzleInstance as PuzzleInstance } from '../../server/private-puzzle-types'

const base = {
  shiftSeed: 'opening-day', shiftRunId: 'run-1', orderId: 'order-1', intentId: 'intent-1',
  machineId: 'quick' as const, attempt: 1, startedAtMs: 100_000, difficulty: 0.3,
}
const choice: MathQuestion = {
  id: 'test-choice', kind: 'math-choice', prompt: 'Select the even numbers.', timeLimitSeconds: 90,
  options: [{ id: 'a', label: '2' }, { id: 'b', label: '3' }, { id: 'c', label: '4' }], correctOptionIds: ['a', 'c'],
}
const fill: MathQuestion = {
  id: 'test-fill', kind: 'math-fill', prompt: 'Enter the supplied answer.', timeLimitSeconds: 75,
  acceptedAnswers: ['-2X', '2'],
}
const known: Record<string, PuzzleDefinition> = {
  'number-search': { kind: 'number-search', columns: 2, grid: [12, 21, 13, 31], target: 21, correctIndex: 1 },
  connect: { kind: 'connect', nodes: [{ id: '1', x: 0.1, y: 0.1 }, { id: '2', x: 0.9, y: 0.9 }], correctPath: ['1', '2'] },
  identify: { kind: 'identify', prompt: '找出：red、circle、正向', target: { color: 'red', shape: 'circle', direction: 'upright' }, options: [
    { id: 'a', color: 'red', shape: 'circle', direction: 'upright' },
    { id: 'b', color: 'blue', shape: 'circle', direction: 'upright' },
  ], correctOptionId: 'a' },
  minesweeper: { kind: 'minesweeper', rows: 2, columns: 2, mineIndices: [0], revealedIndices: [1, 2, 3] },
  sudoku: { kind: 'sudoku', size: 4, boxRows: 2, boxColumns: 2,
    givens: [0, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
    solution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] },
  'math-choice': choice, 'math-fill': fill,
}
function instance(definition: PuzzleDefinition): PuzzleInstance {
  return { id: 'saved-puzzle', shiftRunId: base.shiftRunId, orderId: base.orderId, intentId: base.intentId,
    machineId: ['number-search', 'connect', 'identify'].includes(definition.kind) ? 'quick' : 'fine',
    attempt: 1, seed: 'saved-seed', startedAtMs: 100_000, deadlineAtMs: 190_000, definition, result: { status: 'pending' } }
}
type MinesweeperDefinition = Extract<PuzzleDefinition, { kind: 'minesweeper' }>
type VisibleMinesweeper = Readonly<{
  rows: number; columns: number; mineCount: number
  clues: readonly Readonly<{ index: number; adjacentMines: number }>[]
}>
function adjacent(left: number, right: number, columns: number): boolean {
  return left !== right && Math.abs(Math.floor(left / columns) - Math.floor(right / columns)) <= 1 && Math.abs(left % columns - right % columns) <= 1
}
/** Only this rendering boundary reads saved mines; the independent solver below receives visible clues only. */
function visibleMinesweeper(definition: MinesweeperDefinition): VisibleMinesweeper {
  return { rows: definition.rows, columns: definition.columns, mineCount: definition.mineIndices.length,
    clues: definition.revealedIndices.map((index) => ({ index,
      adjacentMines: definition.mineIndices.filter((mine) => adjacent(index, mine, definition.columns)).length })) }
}
function solveVisibleMinesweeper(view: VisibleMinesweeper): number[][] {
  const hidden = Array.from({ length: view.rows * view.columns }, (_, index) => index).filter((index) => !view.clues.some((clue) => clue.index === index))
  if (hidden.length > 12) throw new Error('Test enumerator is deliberately bounded to generated mini boards')
  const solutions: number[][] = []
  for (let mask = 0; mask < 2 ** hidden.length; mask++) {
    const candidate = hidden.filter((_, bit) => (mask & (1 << bit)) !== 0)
    if (candidate.length === view.mineCount && view.clues.every((clue) => candidate.filter((mine) => adjacent(clue.index, mine, view.columns)).length === clue.adjacentMines)) {
      solutions.push(candidate)
    }
  }
  return solutions
}
function answerFor(definition: PuzzleDefinition): PuzzleAnswer {
  switch (definition.kind) {
    case 'number-search': return { kind: definition.kind, index: definition.correctIndex }
    case 'connect': return { kind: definition.kind, path: [...definition.correctPath] }
    case 'identify': {
      expect(definition).toHaveProperty('target')
      const matches = definition.options.filter((option) => option.color === definition.target.color && option.shape === definition.target.shape && option.direction === definition.target.direction)
      expect(matches).toHaveLength(1)
      return { kind: definition.kind, optionId: matches[0].id }
    }
    case 'minesweeper': {
      const solutions = solveVisibleMinesweeper(visibleMinesweeper(definition))
      expect(solutions).toHaveLength(1)
      return { kind: definition.kind, flaggedIndices: solutions[0],
        revealedIndices: Array.from({ length: definition.rows * definition.columns }, (_, index) => index).filter((index) => !solutions[0].includes(index)) }
    }
    case 'sudoku': return { kind: definition.kind, cells: [...definition.solution] }
    case 'math-choice': return { kind: definition.kind, optionIds: [...definition.correctOptionIds] }
    case 'math-fill': return { kind: definition.kind, text: definition.acceptedAnswers[0] }
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

describe('deterministic puzzle creation', () => {
  it('exposes the pure creation, validation, and grading API', () => {
    for (const name of ['createPuzzle', 'validatePuzzleDefinition', 'validateMathQuestion', 'gradePuzzle', 'normalizeMathFillAnswer', 'validateMathBank']) {
      expect(puzzles).toHaveProperty(name, expect.any(Function))
    }
  })
  it('saves stable full pending instances without mutating frozen input', () => {
    const input = freeze({ ...base, mathBank: [choice, fill] })
    const first = puzzles.createPuzzle(input)
    expect(puzzles.createPuzzle(input)).toEqual(first)
    expect(first).toMatchObject({ shiftRunId: base.shiftRunId, orderId: base.orderId, intentId: base.intentId,
      machineId: 'quick', attempt: 1, startedAtMs: base.startedAtMs, result: { status: 'pending' } })
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    expect(first.deadlineAtMs).toBeGreaterThan(first.startedAtMs)
  })
  it('uses stable distinct machine and attempt streams and collision-safe identities', () => {
    const first = puzzles.createPuzzle(base)
    for (const patch of [{ machineId: 'fine' as const }, { attempt: 2 }, { orderId: 'order-2' }]) {
      const other = puzzles.createPuzzle({ ...base, ...patch })
      expect(other.id).not.toBe(first.id)
      expect(other.seed).not.toBe(first.seed)
      expect(other.definition).not.toEqual(first.definition)
      expect(puzzles.createPuzzle({ ...base, ...patch })).toEqual(other)
    }
    expect(puzzles.createPuzzle({ ...base, shiftSeed: 'another-day' }).seed).not.toBe(first.seed)
  })
  it('keeps a draw independent of wall-clock start while preserving its supplied deadline', () => {
    const first = puzzles.createPuzzle(base)
    const later = puzzles.createPuzzle({ ...base, startedAtMs: base.startedAtMs + 1000 })
    expect(later.definition).toEqual(first.definition)
    expect(later.deadlineAtMs - first.deadlineAtMs).toBe(1000)
  })
  it('gives different intents distinct collision-safe instance IDs without rerolling the order draw', () => {
    const first = puzzles.createPuzzle(base)
    const second = puzzles.createPuzzle({ ...base, intentId: 'intent-2:["a", "b"]' })
    expect(second.id).not.toBe(first.id)
    expect(second.intentId).toBe('intent-2:["a", "b"]')
    expect(second.seed).toBe(first.seed)
    expect(second.definition).toEqual(first.definition)
    expect(second.deadlineAtMs).toBe(first.deadlineAtMs)
    expect(puzzles.createPuzzle({ ...base, intentId: second.intentId })).toEqual(second)
  })
  it.each(['quick', 'fine'] as const)('generates every enabled %s kind with valid answers and bounded times', (machineId) => {
    const ranges: Record<string, [number, number]> = { 'number-search': [8, 14], connect: [10, 16], identify: [6, 12],
      minesweeper: [30, 60], sudoku: [60, 80], 'math-choice': [60, 120], 'math-fill': [60, 120] }
    const seen = new Set<string>()
    for (let attempt = 1; attempt <= 120; attempt++) {
      const puzzle = puzzles.createPuzzle({ ...base, machineId, attempt, difficulty: (attempt % 11) / 10, mathBank: [choice, fill] })
      seen.add(puzzle.definition.kind)
      expect(puzzles.validatePuzzleDefinition(puzzle.definition)).toEqual({ valid: true, issues: [] })
      const seconds = (puzzle.deadlineAtMs - puzzle.startedAtMs) / 1000
      expect(seconds).toBeGreaterThanOrEqual(ranges[puzzle.definition.kind][0])
      expect(seconds).toBeLessThanOrEqual(ranges[puzzle.definition.kind][1])
      expect(puzzles.gradePuzzle(puzzle, answerFor(puzzle.definition), puzzle.startedAtMs).status).toBe('succeeded')
    }
    expect([...seen].sort()).toEqual((machineId === 'quick' ? ['number-search', 'connect', 'identify'] : ['minesweeper', 'sudoku', 'math-choice', 'math-fill']).sort())
  })
  it('bounds invalid generation and substitutes a valid fallback of exactly the selected kind', () => {
    const seen = new Set<string>()
    for (const machineId of ['quick', 'fine'] as const) for (let attempt = 1; attempt <= 30; attempt++) {
      const original = puzzles.createPuzzle({ ...base, machineId, attempt, mathBank: [] })
      let calls = 0
      const recovered = puzzles.createPuzzle({ ...base, machineId, attempt, mathBank: [] }, { generateCandidate: () => { calls++; return { kind: 'wrong-kind' } } })
      expect(calls).toBe(3)
      expect(recovered.definition.kind).toBe(original.definition.kind)
      expect(puzzles.validatePuzzleDefinition(recovered.definition).valid).toBe(true)
      expect(puzzles.gradePuzzle(recovered, answerFor(recovered.definition), recovered.startedAtMs).status).toBe('succeeded')
      seen.add(recovered.definition.kind)
    }
    expect(seen.size).toBe(5)
  })
  it('rejects a valid candidate of the wrong kind and clones accepted candidate data', () => {
    const original = puzzles.createPuzzle(base)
    const other = original.definition.kind === 'sudoku' ? known.identify : known.sudoku
    const guarded = puzzles.createPuzzle(base, { generateCandidate: () => other })
    expect(guarded.definition.kind).toBe(original.definition.kind)
    const candidate = structuredClone(original.definition)
    const accepted = puzzles.createPuzzle(base, { generateCandidate: () => candidate })
    expect(accepted.definition).toEqual(candidate)
    expect(accepted.definition).not.toBe(candidate)
  })
  it('excludes invalid and empty math records without adding placeholders or altering the input', () => {
    const bank = freeze([{ ...choice, id: 'bad', correctOptionIds: ['missing'] }, { ...fill, acceptedAnswers: [] }])
    const validation = puzzles.validateMathBank(bank)
    expect(validation.questions).toEqual([])
    expect(validation.issues).toHaveLength(2)
    expect(validation.issues[0]).toMatchObject({ index: 0, id: 'bad', message: expect.any(String) })
    for (const mathBank of [[], bank]) for (let attempt = 1; attempt <= 30; attempt++) {
      expect(['minesweeper', 'sudoku']).toContain(puzzles.createPuzzle({ ...base, machineId: 'fine', attempt, mathBank }).definition.kind)
    }
  })
  it('enables only the supplied valid math kind and never routes math through the generator seam', () => {
    const seen = new Set<string>()
    for (let attempt = 1; attempt <= 60; attempt++) {
      const puzzle = puzzles.createPuzzle({ ...base, machineId: 'fine', attempt, mathBank: [fill] }, { generateCandidate: () => null })
      seen.add(puzzle.definition.kind)
      if (puzzle.definition.kind === 'math-fill') expect(puzzle.definition).toEqual(fill)
    }
    expect([...seen].sort()).toEqual(['math-fill', 'minesweeper', 'sudoku'])
  })
  it.each([{ attempt: 0 }, { attempt: 1.5 }, { startedAtMs: NaN }, { difficulty: -1 }, { difficulty: 1.1 }, { orderId: '' }])('rejects invalid creation input %j', (patch) => {
    expect(() => puzzles.createPuzzle({ ...base, ...patch })).toThrow(RangeError)
  })
})

describe('definition validators', () => {
  it.each(Object.entries(known))('accepts a complete %s definition', (_, definition) => {
    expect(puzzles.validatePuzzleDefinition(freeze(definition))).toEqual({ valid: true, issues: [] })
  })
  it('rejects a legal minesweeper board whose visible clues allow multiple mine sets', () => {
    const ambiguous: MinesweeperDefinition = { kind: 'minesweeper', rows: 2, columns: 2, mineIndices: [0], revealedIndices: [3] }
    const view = visibleMinesweeper(ambiguous)
    expect(view).toEqual({ rows: 2, columns: 2, mineCount: 1, clues: [{ index: 3, adjacentMines: 1 }] })
    expect(solveVisibleMinesweeper(view)).toEqual([[0], [1], [2]])
    expect(puzzles.validatePuzzleDefinition(ambiguous).valid).toBe(false)
    expect(puzzles.gradePuzzle(instance(ambiguous), { kind: 'minesweeper', flaggedIndices: [0], revealedIndices: [1, 2, 3] }, 100_000)).toMatchObject({ status: 'failed', reason: 'wrong' })
  })
  it.each([
    { prompt: '找出：blue、circle、正向' },
    { target: { color: 'blue', shape: 'circle', direction: 'upright' } },
    { correctOptionId: 'b' },
    { prompt: '找出：green、circle、正向', target: { color: 'green', shape: 'circle', direction: 'upright' } },
    { target: null },
  ])('rejects identify criteria inconsistent with the prompt, options, or saved answer: %j', (patch) => {
    expect(puzzles.validatePuzzleDefinition({ ...known.identify, ...patch }).valid).toBe(false)
  })
  it('grades identify from the target-derived answer and rejects a corrupted saved answer', () => {
    const answer = answerFor(known.identify)
    expect(answer).toEqual({ kind: 'identify', optionId: 'a' })
    expect(puzzles.gradePuzzle(instance(known.identify), answer, 100_000).status).toBe('succeeded')
    const corrupted = { ...known.identify, correctOptionId: 'b' } as PuzzleDefinition
    expect(puzzles.gradePuzzle(instance(corrupted), { kind: 'identify', optionId: 'b' }, 100_000)).toMatchObject({ status: 'failed', reason: 'wrong' })
  })
  const invalid: unknown[] = [null, {}, { kind: 'unknown' },
    { ...known['number-search'], grid: [21, 21, 12, 13] }, { ...known['number-search'], correctIndex: 0 }, { ...known['number-search'], columns: 3 },
    { ...known.connect, correctPath: ['1', '1'] }, { ...known.connect, correctPath: ['2', '1'] },
    { ...known.connect, nodes: [{ id: '1', x: 0, y: 0 }, { id: '2', x: 0, y: 0 }] },
    { ...known.identify, correctOptionId: 'missing' },
    { ...known.identify, options: [{ id: 'a', color: 'red', shape: 'circle', direction: 'upright' }, { id: 'b', color: 'red', shape: 'circle', direction: 'upright' }] },
    { ...known.minesweeper, mineIndices: [0, 0] }, { ...known.minesweeper, mineIndices: [4] },
    { ...known.minesweeper, revealedIndices: [0] }, { ...known.minesweeper, revealedIndices: [1, 1] },
    { ...known.sudoku, givens: Array(16).fill(0) }, { ...known.sudoku, solution: Array(16).fill(1) },
    { ...known.sudoku, givens: [2, ...Array(15).fill(0)] },
  ]
  it.each(invalid.map((definition, index) => [index, definition] as const))('rejects malformed or ambiguous definition %s', (_, definition) => {
    const validation = puzzles.validatePuzzleDefinition(definition)
    expect(validation.valid).toBe(false)
    expect(validation.issues.length).toBeGreaterThan(0)
  })
  it.each([
    { ...choice, prompt: '   ' }, { ...choice, timeLimitSeconds: 59 }, { ...choice, timeLimitSeconds: 121 },
    { ...choice, options: [{ id: 'a', label: 'one' }] },
    { ...choice, options: [{ id: 'a', label: 'one' }, { id: 'a', label: 'two' }] },
    { ...choice, correctOptionIds: [] }, { ...choice, correctOptionIds: ['a', 'a'] }, { ...choice, correctOptionIds: ['unknown'] },
    { ...fill, acceptedAnswers: [] }, { ...fill, acceptedAnswers: ['　\t'] }, { ...fill, timeLimitSeconds: 120.5 },
  ])('rejects invalid authored math %j with developer-facing issues', (question) => {
    const validation = puzzles.validateMathQuestion(question)
    expect(validation.valid).toBe(false)
    expect(validation.issues.length).toBeGreaterThan(0)
  })
  it('excludes duplicate question identities instead of arbitrarily choosing one', () => {
    expect(puzzles.validateMathBank([choice, { ...fill, id: choice.id }]).questions).toEqual([])
  })
})

describe('explicit immutable grading', () => {
  it.each(Object.entries(known))('accepts the correct %s answer exactly at the deadline', (_, definition) => {
    const puzzle = freeze(instance(definition))
    const answer = freeze(answerFor(definition))
    const result = puzzles.gradePuzzle(puzzle, answer, puzzle.deadlineAtMs)
    expect(result).toEqual({ status: 'succeeded', submittedAtMs: puzzle.deadlineAtMs, answer })
    expect(result).not.toBe(puzzle.result)
    if (result.status === 'succeeded') expect(result.answer).not.toBe(answer)
    expect(puzzle.result).toEqual({ status: 'pending' })
    expect(JSON.parse(JSON.stringify({ ...puzzle, result }))).toEqual({ ...puzzle, result })
  })
  it('times out after the deadline at the original deadline, even with a correct answer', () => {
    const puzzle = instance(choice)
    expect(puzzles.gradePuzzle(puzzle, answerFor(choice), puzzle.deadlineAtMs + 1)).toEqual({ status: 'failed', failedAtMs: puzzle.deadlineAtMs, reason: 'timeout', answer: null })
  })
  it('does not regrade a previously saved terminal result', () => {
    const puzzle = instance(choice)
    const result = puzzles.gradePuzzle(puzzle, answerFor(choice), puzzle.startedAtMs)
    expect(puzzles.gradePuzzle(freeze({ ...puzzle, result }), { kind: 'math-choice', optionIds: [] }, puzzle.deadlineAtMs + 1)).toEqual(result)
  })
  it('requires matching answer kinds and a valid definition', () => {
    expect(puzzles.gradePuzzle(instance(choice), { kind: 'math-fill', text: 'a,c' }, 100_000)).toMatchObject({ status: 'failed', reason: 'wrong' })
    expect(puzzles.gradePuzzle(instance({ ...choice, correctOptionIds: [] }), { kind: 'math-choice', optionIds: [] }, 100_000)).toMatchObject({ status: 'failed', reason: 'wrong' })
  })
  it.each([NaN, Infinity, 99_999])('rejects impossible submitted timestamps %s', (time) => {
    expect(() => puzzles.gradePuzzle(instance(choice), answerFor(choice), time)).toThrow(RangeError)
  })
  it('requires numeric connect labels in forward order and rejects reverse, missing, or repeated nodes', () => {
    for (const path of [['2', '1'], ['1'], ['1', '2', '2'], ['1', 'missing']]) {
      expect(puzzles.gradePuzzle(instance(known.connect), { kind: 'connect', path }, 100_000)).toMatchObject({ status: 'failed', reason: 'wrong' })
    }
  })
  it('grades minesweeper as exact unordered flags plus every safe reveal', () => {
    const puzzle = instance(known.minesweeper)
    expect(puzzles.gradePuzzle(puzzle, { kind: 'minesweeper', flaggedIndices: [0], revealedIndices: [3, 1, 2] }, 100_000).status).toBe('succeeded')
    for (const answer of [
      { flaggedIndices: [], revealedIndices: [1, 2, 3] }, { flaggedIndices: [0], revealedIndices: [1, 3] },
      { flaggedIndices: [0, 0], revealedIndices: [1, 2, 3] }, { flaggedIndices: [0], revealedIndices: [1, 2, 3, 3] },
      { flaggedIndices: [0], revealedIndices: [0, 1, 2, 3] }, { flaggedIndices: [4], revealedIndices: [1, 2, 3] },
    ]) expect(puzzles.gradePuzzle(puzzle, { kind: 'minesweeper', ...answer }, 100_000)).toMatchObject({ status: 'failed', reason: 'wrong' })
  })
  it('requires all sudoku cells in their exact positions', () => {
    const definition = known.sudoku as Extract<PuzzleDefinition, { kind: 'sudoku' }>
    for (const cells of [definition.givens, [...definition.solution.slice(1), definition.solution[0]], [...definition.solution, 1]]) {
      expect(puzzles.gradePuzzle(instance(definition), { kind: 'sudoku', cells }, 100_000)).toMatchObject({ status: 'failed', reason: 'wrong' })
    }
  })
  it('uses exact unordered math answer sets for both single and multi selection with no partial credit', () => {
    expect(puzzles.gradePuzzle(instance(choice), { kind: 'math-choice', optionIds: ['c', 'a'] }, 100_000).status).toBe('succeeded')
    for (const optionIds of [[], ['a'], ['a', 'b', 'c'], ['a', 'c', 'c'], ['a', 'unknown']]) {
      expect(puzzles.gradePuzzle(instance(choice), { kind: 'math-choice', optionIds }, 100_000)).toMatchObject({ status: 'failed', reason: 'wrong' })
    }
    const single = { ...choice, correctOptionIds: ['b'] }
    expect(puzzles.gradePuzzle(instance(single), { kind: 'math-choice', optionIds: ['b'] }, 100_000).status).toBe('succeeded')
    expect(puzzles.gradePuzzle(instance(single), { kind: 'math-choice', optionIds: ['b', 'a'] }, 100_000).status).toBe('failed')
  })
  it('only normalizes fullwidth ASCII, common minus signs, whitespace, and ASCII case', () => {
    expect(puzzles.normalizeMathFillAnswer('　－２ Ｘ\t')).toBe('-2x')
    for (const minus of ['−', '﹣', '–', '—']) expect(puzzles.normalizeMathFillAnswer(`${minus}２Ｘ`)).toBe('-2x')
    expect(puzzles.normalizeMathFillAnswer('①²KÄ')).toBe('①²KÄ')
    expect(puzzles.gradePuzzle(instance(fill), { kind: 'math-fill', text: '  −２ ｘ ' }, 100_000).status).toBe('succeeded')
  })
  it('never evaluates arithmetic, equivalent expressions, or executable strings', () => {
    const marker = '__puzzleAnswerExecuted'
    for (const text of ['1+1', '2.0', '②', `globalThis.${marker}=true`, '(()=>{throw new Error()})()', '<script>alert(1)</script>']) {
      expect(puzzles.gradePuzzle(instance(fill), { kind: 'math-fill', text }, 100_000)).toMatchObject({ status: 'failed', reason: 'wrong' })
    }
    expect(Object.hasOwn(globalThis, marker)).toBe(false)
  })
})
