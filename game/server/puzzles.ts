import { MATH_QUESTION_BANK, validateMathQuestionBank } from './math-questions'
import type { MathQuestionValidationError } from './math-questions'
import { createRng, pickRandom, randomInt, shuffleRandom } from '../src/domain/shift-rng'
import type { ElementDirection, PublicPuzzleDefinition, PuzzleAnswer, PuzzleInstance, PuzzleResult } from '../src/domain/shift-types'
import type { PuzzleCreationInput } from '../src/domain/puzzle-public'
import type { MathQuestion, PrivatePuzzleDefinition as PuzzleDefinition, PrivatePuzzleInstance } from './private-puzzle-types'

export type PuzzleValidation = Readonly<{ valid: boolean; issues: readonly string[] }>
export type GeneratedPuzzleKind = Exclude<PuzzleDefinition['kind'], MathQuestion['kind']>
export type CreatePuzzleInput = PuzzleCreationInput & Readonly<{
  /** Server-side authoring/test seam; never accepted from a browser request. */
  mathBank?: readonly unknown[]
}>
export type PuzzleGenerationHooks = Readonly<{
  /** A candidate seam, never a validator bypass. Math questions do not enter it. */
  generateCandidate?: (context: Readonly<{ kind: GeneratedPuzzleKind; seed: string; difficulty: number; retry: number }>) => unknown
}>
export type GradedPuzzleResult = Exclude<PuzzleResult, Readonly<{ status: 'pending' }>>

const quickKinds: readonly GeneratedPuzzleKind[] = ['number-search', 'connect', 'identify']
const fineKinds: readonly GeneratedPuzzleKind[] = ['minesweeper', 'sudoku']
const timeRanges: Readonly<Record<GeneratedPuzzleKind, readonly [number, number]>> = {
  'number-search': [8, 14], connect: [10, 16], identify: [6, 12], minesweeper: [30, 60], sudoku: [60, 80],
}
const directions: readonly ElementDirection[] = ['upright', 'left', 'right', 'inverted']
const directionLabels: Readonly<Record<ElementDirection, string>> = { upright: '正向', left: '向左', right: '向右', inverted: '倒置' }
const clone = <T>(value: T): T => structuredClone(value)
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const indices = (count: number): number[] => Array.from({ length: count }, (_, index) => index)
function denseArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && indices(value.length).every((index) => Object.hasOwn(value, index))
}
function uniqueIndices(value: unknown, size: number): value is number[] {
  return denseArray(value) && value.every((index) => integer(index) && index >= 0 && index < size) && new Set(value).size === value.length
}
function exactSequence(actual: unknown, expected: readonly unknown[]): boolean {
  return denseArray(actual) && actual.length === expected.length && actual.every((entry, index) => entry === expected[index])
}
function exactSet(actual: unknown, expected: readonly unknown[]): boolean {
  return denseArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && actual.every((entry) => expected.includes(entry))
}
const validation = (valid: boolean, issue: string): PuzzleValidation => ({ valid, issues: valid ? [] : [issue] })
type IdentifyTarget = Extract<PuzzleDefinition, { kind: 'identify' }>['target']
function isIdentifyTarget(value: unknown): value is IdentifyTarget {
  return record(value) && nonempty(value.color) && nonempty(value.shape) && directions.includes(value.direction as ElementDirection)
}
function identifyPrompt(target: IdentifyTarget): string {
  return `找出：${target.color}、${target.shape}、${directionLabels[target.direction]}`
}

/** Prove uniqueness using only the visible adjacent counts and total mine count, with bounded search. */
function minesUniquelyDetermined(rows: number, columns: number, mineIndices: readonly number[], revealedIndices: readonly number[]): boolean {
  const adjacent = (left: number, right: number): boolean => left !== right
    && Math.abs(Math.floor(left / columns) - Math.floor(right / columns)) <= 1 && Math.abs(left % columns - right % columns) <= 1
  const hidden = indices(rows * columns).filter((index) => !revealedIndices.includes(index))
  const clues = revealedIndices.map((index) => ({
    variables: indices(hidden.length).filter((variable) => adjacent(index, hidden[variable])),
    // This is the same number rendered on each initially revealed cell.
    count: mineIndices.filter((mine) => adjacent(index, mine)).length,
  }))
  const assignments = hidden.map(() => -1)
  let solutions = 0
  let visited = 0
  let exhausted = false
  function visit(position: number, remainingMines: number): void {
    if (solutions >= 2 || exhausted) return
    if (++visited > 50_000) { exhausted = true; return }
    if (remainingMines < 0 || remainingMines > hidden.length - position) return
    for (const clue of clues) {
      let assignedMines = 0
      let unknown = 0
      for (const variable of clue.variables) {
        if (assignments[variable] === -1) unknown++
        else assignedMines += assignments[variable]
      }
      if (assignedMines > clue.count || assignedMines + unknown < clue.count) return
    }
    if (position === hidden.length) { solutions++; return }
    assignments[position] = 0
    visit(position + 1, remainingMines)
    assignments[position] = 1
    visit(position + 1, remainingMines - 1)
    assignments[position] = -1
  }
  visit(0, mineIndices.length)
  // Hitting the budget is not evidence of uniqueness: reject and use the same-kind fallback.
  return !exhausted && solutions === 1
}

/** Deliberately narrower than NFKC: superscripts, circled digits and other symbols keep their meaning. */
export function normalizeMathFillAnswer(answer: string): string {
  const normalized = answer.replace(/[！-～]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/[−﹣–—]/gu, '-').replace(/\s/gu, '').replace(/[A-Z]/gu, (character) => character.toLowerCase())
  // Exactly one outer inline-math wrapper is presentation only; never evaluate expressions.
  return /^\$[^$]+\$$/u.test(normalized) ? normalized.slice(1, -1) : normalized
}

/** Authoring diagnostics remain available to callers; invalid records are never rewritten or substituted. */
export function validateMathBank(input: readonly unknown[]): Readonly<{ questions: readonly MathQuestion[]; issues: readonly MathQuestionValidationError[] }> {
  const checked = validateMathQuestionBank(input)
  return { questions: checked.questions, issues: checked.errors }
}

export function validateMathQuestion(question: unknown): PuzzleValidation {
  const checked = validateMathBank([question])
  return { valid: checked.questions.length === 1, issues: checked.issues.map((issue) => issue.message) }
}

function sudokuGroupsValid(cells: readonly number[], complete: boolean): boolean {
  const groups: number[][] = []
  for (let row = 0; row < 4; row++) groups.push(indices(4).map((column) => cells[row * 4 + column]))
  for (let column = 0; column < 4; column++) groups.push(indices(4).map((row) => cells[row * 4 + column]))
  for (const row of [0, 2]) for (const column of [0, 2]) {
    groups.push([cells[row * 4 + column], cells[row * 4 + column + 1], cells[(row + 1) * 4 + column], cells[(row + 1) * 4 + column + 1]])
  }
  return groups.every((group) => {
    const numbers = group.filter((value) => value !== 0)
    return (!complete || numbers.length === 4) && new Set(numbers).size === numbers.length
  })
}

/** Mini sudoku is a bounded 4×4, 2×2-box format. Search stops as soon as a second solution exists. */
function sudokuSolutionCount(givens: readonly number[]): number {
  const cells = [...givens]
  let solutions = 0
  function visit(): void {
    if (solutions >= 2) return
    const index = cells.indexOf(0)
    if (index === -1) { solutions++; return }
    for (let value = 1; value <= 4; value++) {
      cells[index] = value
      if (sudokuGroupsValid(cells, false)) visit()
      if (solutions >= 2) break
    }
    cells[index] = 0
  }
  visit()
  return solutions
}

/** Validates unknown data before it can become a generated or recovered definition. */
export function validatePuzzleDefinition(definition: unknown): PuzzleValidation {
  if (!record(definition)) return validation(false, 'Puzzle definition must be an object')
  switch (definition.kind) {
    case 'number-search': {
      const { columns, grid, target, correctIndex } = definition
      return validation(integer(columns) && columns > 0 && columns <= 12 && denseArray(grid) && grid.length > 1 && grid.length <= 144
        && grid.length % columns === 0 && grid.every(integer) && integer(target) && integer(correctIndex)
        && correctIndex >= 0 && correctIndex < grid.length && grid[correctIndex] === target
        && grid.filter((value) => value === target).length === 1, 'Number search needs a rectangular grid with exactly one target')
    }
    case 'connect': {
      const { nodes, correctPath } = definition
      if (!denseArray(nodes) || nodes.length < 2 || nodes.length > 20 || !nodes.every((node): node is Record<string, unknown> => record(node)
        && nonempty(node.id) && typeof node.x === 'number' && Number.isFinite(node.x) && node.x >= 0 && node.x <= 1
        && typeof node.y === 'number' && Number.isFinite(node.y) && node.y >= 0 && node.y <= 1)) {
        return validation(false, 'Connect needs distinct labelled nodes with normalized finite positions')
      }
      const positions = nodes.map((node) => JSON.stringify([node.x, node.y]))
      const labels = nodes.map((node) => node.id)
      const orderedLabels = indices(nodes.length).map((index) => String(index + 1))
      // IDs are the visible ordinal labels: 1 → 2 → … only. Reverse traversal is not accepted.
      return validation(new Set(positions).size === nodes.length && exactSet(labels, orderedLabels) && exactSequence(correctPath, orderedLabels),
        'Connect must contain each ordinal label once and one forward path through every node')
    }
    case 'identify': {
      const { options, prompt, target, correctOptionId } = definition
      if (!isIdentifyTarget(target) || prompt !== identifyPrompt(target) || !denseArray(options) || options.length < 2 || options.length > 20
        || !options.every((option): option is Record<string, unknown> => record(option) && nonempty(option.id) && nonempty(option.color) && nonempty(option.shape)
          && directions.includes(option.direction as ElementDirection))) return validation(false, 'Identify needs structured target criteria, their canonical prompt, and complete visual options')
      const ids = options.map((option) => option.id)
      const appearances = options.map((option) => JSON.stringify([option.color, option.shape, option.direction]))
      const matches = options.filter((option) => option.color === target.color && option.shape === target.shape && option.direction === target.direction)
      return validation(matches.length === 1 && matches[0].id === correctOptionId && new Set(ids).size === ids.length
        && new Set(appearances).size === appearances.length, 'Identify needs one unambiguous matching option')
    }
    case 'minesweeper': {
      const { rows, columns, mineIndices, revealedIndices } = definition
      if (!integer(rows) || !integer(columns) || rows < 2 || columns < 2 || rows > 8 || columns > 8) {
        return validation(false, 'Minesweeper needs a bounded rectangular board')
      }
      const size = rows * columns
      if (!uniqueIndices(mineIndices, size) || mineIndices.length === 0 || mineIndices.length >= size
        || !uniqueIndices(revealedIndices, size) || revealedIndices.length === 0 || revealedIndices.some((index) => mineIndices.includes(index))) {
        return validation(false, 'Mines and initial reveals must be distinct in-range indices, with only safe cells revealed')
      }
      return validation(minesUniquelyDetermined(rows, columns, mineIndices, revealedIndices),
        'Visible adjacent counts and total mine count must uniquely determine the hidden mine set within the search bound')
    }
    case 'sudoku': {
      const { size, boxRows, boxColumns, givens, solution } = definition
      if (size !== 4 || boxRows !== 2 || boxColumns !== 2 || !denseArray(givens) || givens.length !== 16
        || !givens.every((value): value is number => integer(value) && value >= 0 && value <= 4) || !denseArray(solution) || solution.length !== 16
        || !solution.every((value): value is number => integer(value) && value >= 1 && value <= 4)) return validation(false, 'Mini sudoku requires 16 valid cells and 2×2 boxes')
      return validation(sudokuGroupsValid(solution, true) && givens.every((value, index) => value === 0 || value === solution[index])
        && sudokuSolutionCount(givens) === 1, 'Sudoku givens must agree with the valid solution and determine it uniquely')
    }
    case 'math-choice':
    case 'math-fill': return validateMathQuestion(definition)
    default: return validation(false, 'Unknown puzzle kind')
  }
}

const sudokuBase = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] as const
const fallbackDefinitions: Readonly<Record<GeneratedPuzzleKind, PuzzleDefinition>> = {
  'number-search': { kind: 'number-search', columns: 3, grid: [31, 13, 37, 73, 17, 71, 33, 11, 77], target: 37, correctIndex: 2 },
  connect: { kind: 'connect', nodes: [{ id: '1', x: 0.2, y: 0.2 }, { id: '2', x: 0.8, y: 0.8 }, { id: '3', x: 0.8, y: 0.2 }], correctPath: ['1', '2', '3'] },
  identify: { kind: 'identify', prompt: '找出：红色、圆形、正向', target: { color: '红色', shape: '圆形', direction: 'upright' }, options: [
    { id: 'a', color: '红色', shape: '圆形', direction: 'upright' },
    { id: 'b', color: '蓝色', shape: '圆形', direction: 'upright' },
    { id: 'c', color: '红色', shape: '圆形', direction: 'inverted' },
  ], correctOptionId: 'a' },
  minesweeper: { kind: 'minesweeper', rows: 3, columns: 4, mineIndices: [0, 3], revealedIndices: [4, 5, 6, 7, 8, 9, 10, 11] },
  sudoku: { kind: 'sudoku', size: 4, boxRows: 2, boxColumns: 2, givens: [0, 2, 3, 4, 3, 0, 1, 2, 2, 1, 0, 3, 4, 3, 2, 0], solution: sudokuBase },
}

function generateDefinition(kind: GeneratedPuzzleKind, seed: string, difficulty: number): PuzzleDefinition {
  let rng = createRng(seed)
  const integerDraw = (minimum: number, maximum: number): number => {
    const draw = randomInt(rng, minimum, maximum); rng = draw.rng; return draw.value
  }
  const shuffled = <T>(values: readonly T[]): T[] => {
    const draw = shuffleRandom(rng, values); rng = draw.rng; return [...draw.value]
  }
  switch (kind) {
    case 'number-search': {
      const columns = 3 + Math.floor(difficulty * 2)
      const target = integerDraw(10, 99)
      const grid = shuffled(indices(90).map((index) => index + 10).filter((value) => value !== target)).slice(0, columns * columns)
      const correctIndex = integerDraw(0, grid.length - 1)
      grid[correctIndex] = target
      return { kind, columns, grid, target, correctIndex }
    }
    case 'connect': {
      const count = 4 + Math.floor(difficulty * 6)
      const width = Math.ceil(Math.sqrt(count))
      const positions = shuffled(indices(width * width)).slice(0, count)
      const nodes = positions.map((position, index) => ({ id: String(index + 1), x: (position % width + 0.5) / width, y: (Math.floor(position / width) + 0.5) / width }))
      return { kind, nodes, correctPath: nodes.map((node) => node.id) }
    }
    case 'identify': {
      const appearances = ['红色', '蓝色', '绿色', '紫色'].flatMap((color) => ['圆形', '方形', '三角形'].flatMap((shape) => directions.map((direction) => ({ color, shape, direction }))))
      const options = shuffled(appearances).slice(0, 3 + Math.floor(difficulty * 3)).map((appearance, index) => ({ id: String(index + 1), ...appearance }))
      const selected = options[integerDraw(0, options.length - 1)]
      const target = { color: selected.color, shape: selected.shape, direction: selected.direction }
      return { kind, prompt: identifyPrompt(target), target, options, correctOptionId: selected.id }
    }
    case 'minesweeper': {
      const rows = difficulty < 0.5 ? 3 : 5
      const columns = 4
      const boundary = rows === 3 ? indices(columns) : [...indices(columns), ...indices(columns).map((column) => (rows - 1) * columns + column)]
      const mineIndices = shuffled(boundary).slice(0, 1 + Math.floor(difficulty * 3)).sort((left, right) => left - right)
      // Revealed interior rows constrain the four hidden boundary cells uniquely through their adjacent counts.
      // On the five-row board, a revealed middle row separates the two independent boundaries.
      const revealedIndices = indices(rows * columns).filter((index) => !boundary.includes(index))
      return { kind, rows, columns, mineIndices, revealedIndices }
    }
    case 'sudoku': {
      const symbols = shuffled([1, 2, 3, 4])
      const solution = sudokuBase.map((value) => symbols[value - 1])
      const givens = [...solution]
      const blanksWanted = 5 + Math.floor(difficulty * 6)
      let blanks = 0
      for (const index of shuffled(indices(16))) {
        if (blanks === blanksWanted) break
        givens[index] = 0
        if (sudokuSolutionCount(givens) === 1) blanks++
        else givens[index] = solution[index]
      }
      return { kind, size: 4, boxRows: 2, boxColumns: 2, givens, solution }
    }
  }
}

/** Create once at explicit begin-calibration, then persist this entire object; recovery reads it unchanged. */
export function createPuzzle(input: CreatePuzzleInput, hooks: PuzzleGenerationHooks = {}): PrivatePuzzleInstance {
  const difficulty = input.difficulty ?? 0
  if (![input.shiftSeed, input.shiftRunId, input.orderId, input.intentId].every(nonempty)
    || !['quick', 'fine'].includes(input.machineId) || !integer(input.attempt) || input.attempt < 1
    || !Number.isFinite(input.startedAtMs) || !Number.isFinite(difficulty) || difficulty < 0 || difficulty > 1) {
    throw new RangeError('Invalid puzzle identity, attempt, start time, or difficulty')
  }
  // A clock or intent re-creation cannot reroll a question for this order/machine/attempt.
  const seed = JSON.stringify([input.shiftSeed, input.shiftRunId, input.orderId, input.machineId, input.attempt])
  const mathQuestions = validateMathBank(input.mathBank ?? MATH_QUESTION_BANK).questions
  const availableMathKinds = (['math-choice', 'math-fill'] as const).filter((kind) => mathQuestions.some((question) => question.kind === kind))
  const authoredFinePool: readonly PuzzleDefinition['kind'][] | undefined = input.calibrationKind === 'math'
    ? availableMathKinds.length > 0 ? availableMathKinds : fineKinds
    : input.calibrationKind === 'sudoku' || input.calibrationKind === 'minesweeper' ? [input.calibrationKind] : undefined
  const pool: readonly PuzzleDefinition['kind'][] = input.machineId === 'quick' ? quickKinds : authoredFinePool ?? [...fineKinds, ...availableMathKinds]
  const kind = pickRandom(createRng(JSON.stringify([seed, 'kind'])), pool).value
  let definition: PuzzleDefinition | undefined
  let seconds: number
  if (kind === 'math-choice' || kind === 'math-fill') {
    definition = clone(pickRandom(createRng(JSON.stringify([seed, 'math'])), mathQuestions.filter((question) => question.kind === kind)).value)
    seconds = definition.timeLimitSeconds
  } else {
    for (let retry = 0; retry < 3; retry++) {
      const context: Parameters<NonNullable<PuzzleGenerationHooks['generateCandidate']>>[0] = { kind, seed: JSON.stringify([seed, 'candidate', retry]), difficulty, retry }
      const candidate: unknown = hooks.generateCandidate ? hooks.generateCandidate(context) : generateDefinition(kind, context.seed, difficulty)
      if (record(candidate) && candidate.kind === kind && validatePuzzleDefinition(candidate).valid) {
        definition = clone(candidate as PuzzleDefinition)
        break
      }
    }
    definition ??= clone(fallbackDefinitions[kind])
    const [minimum, maximum] = timeRanges[kind]
    seconds = randomInt(createRng(JSON.stringify([seed, 'time'])), minimum, maximum).value
  }
  const deadlineAtMs = input.startedAtMs + seconds * 1000
  if (!Number.isFinite(deadlineAtMs) || deadlineAtMs <= input.startedAtMs) throw new RangeError('Puzzle deadline cannot be represented')
  return {
    id: `puzzle:${JSON.stringify([input.shiftRunId, input.orderId, input.intentId, input.machineId, input.attempt])}`,
    shiftRunId: input.shiftRunId, orderId: input.orderId, intentId: input.intentId, machineId: input.machineId,
    attempt: input.attempt, seed, startedAtMs: input.startedAtMs, deadlineAtMs, definition, result: { status: 'pending' },
  }
}

function isCorrect(definition: PuzzleDefinition, answer: PuzzleAnswer): boolean {
  switch (definition.kind) {
    case 'number-search': return answer.kind === definition.kind && answer.index === definition.correctIndex
    case 'connect': return answer.kind === definition.kind && exactSequence(answer.path, definition.correctPath)
    case 'identify': return answer.kind === definition.kind && answer.optionId === definition.correctOptionId
    case 'minesweeper': return answer.kind === definition.kind && exactSet(answer.flaggedIndices, definition.mineIndices)
      && exactSet(answer.revealedIndices, definition.revealedIndices)
      && exactSet(answer.revealedIndices, indices(definition.rows * definition.columns).filter((index) => !definition.mineIndices.includes(index)))
    case 'sudoku': return answer.kind === definition.kind && exactSequence(answer.cells, definition.solution)
    case 'math-choice': return answer.kind === definition.kind && exactSet(answer.optionIds, definition.correctOptionIds)
    case 'math-fill': return answer.kind === definition.kind && typeof answer.text === 'string'
      && definition.acceptedAnswers.some((accepted) => normalizeMathFillAnswer(accepted) === normalizeMathFillAnswer(answer.text))
  }
}

/** Explicit submit only. Exactly-at-deadline submissions count; later submissions fail at the saved deadline. */
export function gradePuzzle(instance: PrivatePuzzleInstance, answer: PuzzleAnswer, submittedAtMs: number): GradedPuzzleResult {
  if (!Number.isFinite(submittedAtMs) || submittedAtMs < instance.startedAtMs) throw new RangeError('Invalid puzzle submission time')
  if (instance.result.status !== 'pending') return clone(instance.result)
  if (submittedAtMs > instance.deadlineAtMs) return { status: 'failed', failedAtMs: instance.deadlineAtMs, reason: 'timeout', answer: null }
  return validatePuzzleDefinition(instance.definition).valid && isCorrect(instance.definition, answer)
    ? { status: 'succeeded', submittedAtMs, answer: clone(answer) }
    : { status: 'failed', failedAtMs: submittedAtMs, reason: 'wrong', answer: clone(answer) }
}

/** Explicit projection: adding a private field cannot accidentally expand the API response. */
export function toPublicPuzzleInstance(instance: PrivatePuzzleInstance): PuzzleInstance {
  const source = instance.definition
  let definition: PublicPuzzleDefinition
  switch (source.kind) {
    case 'number-search': definition = { kind: source.kind, columns: source.columns, grid: [...source.grid], target: source.target }; break
    case 'connect': definition = { kind: source.kind, nodes: source.nodes.map(node => ({ id: node.id, x: node.x, y: node.y })) }; break
    case 'identify': definition = { kind: source.kind, prompt: source.prompt, target: { color: source.target.color, shape: source.target.shape, direction: source.target.direction },
      options: source.options.map(option => ({ id: option.id, color: option.color, shape: option.shape, direction: option.direction })) }; break
    case 'minesweeper': definition = { kind: source.kind, rows: source.rows, columns: source.columns, mineCount: source.mineIndices.length,
      revealedCells: source.revealedIndices.map(index => ({ index, clue: source.mineIndices.filter(mine => mine !== index
        && Math.abs(Math.floor(mine / source.columns) - Math.floor(index / source.columns)) <= 1
        && Math.abs(mine % source.columns - index % source.columns) <= 1).length })) }; break
    case 'sudoku': definition = { kind: source.kind, size: source.size, boxRows: source.boxRows, boxColumns: source.boxColumns, givens: [...source.givens] }; break
    case 'math-choice':
    case 'math-fill': {
      const common = { id: source.id, prompt: source.prompt, timeLimitSeconds: source.timeLimitSeconds,
        ...(source.images ? { images: source.images.map(image => ({ src: image.src, alt: image.alt })) } : {}),
        ...(source.table ? { table: { headers: [...source.table.headers], rows: source.table.rows.map(row => [...row]) } } : {}),
      }
      definition = source.kind === 'math-choice'
        ? { ...common, kind: source.kind, options: source.options.map(option => ({ id: option.id, label: option.label })), multiple: source.multiple ?? source.correctOptionIds.length > 1 }
        : { ...common, kind: source.kind }
      break
    }
  }
  return { id: instance.id, shiftRunId: instance.shiftRunId, orderId: instance.orderId, intentId: instance.intentId, machineId: instance.machineId,
    attempt: instance.attempt, startedAtMs: instance.startedAtMs, deadlineAtMs: instance.deadlineAtMs, definition, result: clone(instance.result) }
}

export const toPublicPuzzle = toPublicPuzzleInstance

/** Safe-cell clues are disclosed only after an authoritative reveal request. */
export function revealPuzzle(instance: PrivatePuzzleInstance, index: number, revealedAtMs: number): PrivatePuzzleInstance {
  if (instance.definition.kind !== 'minesweeper') throw new RangeError('Only minesweeper supports revealing cells')
  const definition = instance.definition
  if (!integer(index) || index < 0 || index >= definition.rows * definition.columns
    || !Number.isFinite(revealedAtMs) || revealedAtMs < instance.startedAtMs) throw new RangeError('Invalid minesweeper reveal')
  if (instance.result.status !== 'pending') return clone(instance)
  if (revealedAtMs > instance.deadlineAtMs) return { ...clone(instance), result: { status: 'failed', failedAtMs: instance.deadlineAtMs, reason: 'timeout', answer: null } }
  if (definition.mineIndices.includes(index)) return { ...clone(instance), result: { status: 'failed', failedAtMs: revealedAtMs, reason: 'wrong', answer: null } }
  if (definition.revealedIndices.includes(index)) return clone(instance)
  return { ...clone(instance), definition: { ...clone(definition), revealedIndices: [...definition.revealedIndices, index].sort((left, right) => left - right) } }
}
