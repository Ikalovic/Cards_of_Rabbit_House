import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import * as math from '../../server/math-questions'
import { createPuzzle, gradePuzzle, normalizeMathFillAnswer } from '../../server/puzzles'
import type { PuzzleAnswer } from '../domain/shift-types'
import type { MathQuestion, PrivatePuzzleInstance as PuzzleInstance } from '../../server/private-puzzle-types'

const sourceChoice = { number: 1, stem: '计算 $1+1$。', options: { D: '$4$', B: '$2$', C: '$3$', A: '$1$' }, answer: 'B' }
const classified = (single: unknown[] = [], multiple: unknown[] = [], fill: unknown[] = []) => ({ 单选题: single, 多选题: multiple, 填空题: fill })
const input = { shiftSeed: 'production', shiftRunId: 'run', orderId: 'order', intentId: 'intent', machineId: 'fine' as const, attempt: 1, startedAtMs: 1000 }

function adapt(source: unknown) {
  expect(math).toHaveProperty('adaptClassifiedMathQuestionBank', expect.any(Function))
  return math.adaptClassifiedMathQuestionBank(source)
}
function saved(definition: MathQuestion): PuzzleInstance {
  return { id: 'saved', shiftRunId: 'run', orderId: 'order', intentId: 'intent', machineId: 'fine', attempt: 1, seed: 'seed', startedAtMs: 1000,
    deadlineAtMs: 1000 + definition.timeLimitSeconds * 1000, definition, result: { status: 'pending' } }
}
function find(id: string): MathQuestion {
  const question = math.MATH_QUESTION_BANK.find(candidate => candidate.id === id)
  expect(question).toBeDefined()
  return question!
}

describe('auditable production math source', () => {
  it('preserves all 42 source entries in their original 24/9/9 categories', () => {
    expect(math).toHaveProperty('MATH_QUESTION_SOURCE')
    expect(Object.keys(math.MATH_QUESTION_SOURCE)).toEqual(['单选题', '多选题', '填空题'])
    expect(math.MATH_QUESTION_SOURCE.单选题).toHaveLength(24)
    expect(math.MATH_QUESTION_SOURCE.多选题).toHaveLength(9)
    expect(math.MATH_QUESTION_SOURCE.填空题).toHaveLength(9)
    expect(math.MATH_QUESTION_SOURCE.单选题[13]).toHaveProperty('table')
    expect(math.MATH_QUESTION_SOURCE.单选题[22].answer).toBe('无解（题设条件矛盾）')
  })

  it('enables 41 intact questions with supplied local images and rejects only the contradictory answer', () => {
    expect(math.MATH_QUESTION_BANK).toHaveLength(41)
    const checked = adapt(math.MATH_QUESTION_SOURCE)
    expect(checked.questions).toEqual(math.MATH_QUESTION_BANK)
    expect(checked.errors).toHaveLength(1)
    expect(checked.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'single-23', message: expect.stringContaining('A–D') }),
    ]))
    expect(math.MATH_QUESTION_IMPORT_ERRORS).toEqual(checked.errors)
    expect(checked.questions.filter(question => question.id.startsWith('single-'))).toHaveLength(23)
    expect(checked.questions.filter(question => question.id.startsWith('multiple-'))).toHaveLength(9)
    expect(checked.questions.filter(question => question.kind === 'math-fill')).toHaveLength(9)
  })

  it('keeps stable unique IDs, ordered A–D options and valid answers without leaking source numbers into prompts', () => {
    expect(math.MATH_QUESTION_BANK).toHaveLength(41)
    expect(new Set(math.MATH_QUESTION_BANK.map(question => question.id)).size).toBe(41)
    expect(math.validateMathQuestionBank(math.MATH_QUESTION_BANK).errors).toEqual([])
    for (const question of math.MATH_QUESTION_BANK) {
      expect(question.prompt).not.toContain(question.id)
      expect(question.prompt).not.toMatch(/^\d+[.、]/u)
      expect(question.timeLimitSeconds).toBeGreaterThanOrEqual(60)
      expect(question.timeLimitSeconds).toBeLessThanOrEqual(120)
      if (question.kind === 'math-choice') {
        expect(question.options.map(option => option.id)).toEqual(['A', 'B', 'C', 'D'])
        expect(question.correctOptionIds.every(id => ['A', 'B', 'C', 'D'].includes(id))).toBe(true)
      }
    }
  })

  it('preserves image alt text and a rectangular table, with both image binaries inside the build context', () => {
    const wind = find('single-14')
    const curve = find('multiple-03')
    expect(wind.images).toEqual([{ src: '/assets/math/questions/single_14.png', alt: '风速向量示意图' }])
    expect(curve.images).toEqual([{ src: '/assets/math/questions/multiple_03.png', alt: '曲线示意图' }])
    expect(wind.table).toEqual(math.MATH_QUESTION_SOURCE.单选题[13].table)
    for (const question of [wind, curve]) for (const image of question.images ?? []) {
      expect(image.src).toMatch(/^\/assets\/math\/questions\/(single_14|multiple_03)\.png$/u)
      expect(existsSync(`${process.cwd()}/public${image.src}`)).toBe(true)
    }
  })

  it('fixes transparent category/derivation time tiers, independent of order and attempt', () => {
    // Direct substitution / two-step derivation / longer reasoning: single 60/75/90,
    // multiple 90/105/120, fill 75/90/105. Unlisted future numbers take the longest tier.
    const expected = { 'single-01': 60, 'single-04': 75, 'single-06': 90,
      'multiple-07': 90, 'multiple-01': 105, 'multiple-09': 120,
      'fill-04': 75, 'fill-02': 90, 'fill-09': 105 }
    for (const [id, seconds] of Object.entries(expected)) expect(find(id).timeLimitSeconds).toBe(seconds)
    const reversed = Object.fromEntries(Object.entries(math.MATH_QUESTION_SOURCE).map(([kind, entries]) => [kind, [...entries].reverse()]))
    expect(adapt(reversed).questions.map(question => [question.id, question.timeLimitSeconds]).sort())
      .toEqual(math.MATH_QUESTION_BANK.map(question => [question.id, question.timeLimitSeconds]).sort())
    for (const question of math.MATH_QUESTION_BANK) {
      const puzzle = createPuzzle({ ...input, calibrationKind: 'math', mathBank: [question], attempt: 7 })
      expect(puzzle.deadlineAtMs - puzzle.startedAtMs).toBe(question.timeLimitSeconds * 1000)
    }
  })
})

describe('strict source adapter', () => {
  it('parses unordered source options into A–D and preserves a multi question with one correct option', () => {
    const result = adapt(classified([sourceChoice], [{ ...sourceChoice, answer: 'A、C' }, { ...sourceChoice, number: 2, answer: 'C' }], [{ number: 1, stem: '填入 $x$。', answer: '$\\dfrac32$' }]))
    expect(result.errors).toEqual([])
    expect(result.questions).toHaveLength(4)
    expect(result.questions[0]).toMatchObject({ id: 'single-01', options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }], correctOptionIds: ['B'] })
    expect(result.questions[1]).toMatchObject({ id: 'multiple-01', correctOptionIds: ['A', 'C'] })
    expect(result.questions[2]).toMatchObject({ correctOptionIds: ['C'] })
    expect(result.questions[3]).toMatchObject({ kind: 'math-fill', acceptedAnswers: ['$\\dfrac32$'] })
  })

  it.each(['', 'E', 'a', 'A、A', 'A/B', 'AB', 'A、', 'A, C', '答案A', '无解（题设条件矛盾）'])('disables malformed choice answer %s without repair', answer => {
    const result = adapt(classified([{ ...sourceChoice, answer }], [{ ...sourceChoice, answer }]))
    expect(result.questions).toEqual([])
    expect(result.errors).toHaveLength(2)
  })

  it('rejects multiple selections in single choice, missing options and undeclared extra options', () => {
    const result = adapt(classified([{ ...sourceChoice, answer: 'A、B' }, { ...sourceChoice, number: 2, options: { A: '甲', B: '乙' } }, { ...sourceChoice, number: 3, options: { ...sourceChoice.options, E: '戊' } }]))
    expect(result.questions).toEqual([])
    expect(result.errors).toHaveLength(3)
  })

  it('disables every duplicate source identity and every unbundled required image', () => {
    const result = adapt(classified([sourceChoice, { ...sourceChoice }, { ...sourceChoice, number: 2, images: [{ path: 'assets/missing.png' }] }]))
    expect(result.questions).toEqual([])
    expect(result.errors).toHaveLength(3)
    expect(result.errors.filter(error => error.message.includes('重复'))).toHaveLength(2)
    expect(result.errors[2].message).toContain('assets/missing.png')
  })

  it('rejects external and traversal image paths, malformed alt text and incomplete tables', () => {
    for (const path of ['https://example.com/image.png', '//example.com/image.png', 'assets/../single_14.png', '/assets/math/questions/single_14.png']) {
      expect(adapt(classified([{ ...sourceChoice, images: [{ path, alt: '图' }] }])).questions).toEqual([])
    }
    expect(adapt(classified([{ ...sourceChoice, images: [{ path: 'assets/single_14.png', alt: '' }] }])).questions).toEqual([])
    expect(adapt(classified([{ ...sourceChoice, table: { headers: ['甲', '乙'], rows: [['甲']] } }])).questions).toEqual([])
  })

  it('rejects malformed root categories, sparse records, invalid numbering and empty fields', () => {
    for (const source of [null, {}, { ...classified(), 单选题: {} }]) expect(adapt(source).errors.length).toBeGreaterThan(0)
    const result = adapt(classified([null, { ...sourceChoice, number: 0 }, { ...sourceChoice, number: 1.5 }, { ...sourceChoice, stem: ' ' }], [], [{ number: 1, stem: '填空', answer: ' ' }]))
    expect(result.questions).toEqual([])
    expect(result.errors).toHaveLength(5)
  })
})

describe('production grading and authored calibration', () => {
  it('grades real single/multiple/fill answers exactly and preserves the deadline', () => {
    const cases: [string, PuzzleAnswer, PuzzleAnswer][] = [
      ['single-01', { kind: 'math-choice', optionIds: ['A'] }, { kind: 'math-choice', optionIds: ['A', 'B'] }],
      ['multiple-01', { kind: 'math-choice', optionIds: ['C', 'B'] }, { kind: 'math-choice', optionIds: ['B'] }],
      ['multiple-04', { kind: 'math-choice', optionIds: ['C'] }, { kind: 'math-choice', optionIds: ['A', 'C'] }],
      ['fill-01', { kind: 'math-fill', text: '\\dfrac32' }, { kind: 'math-fill', text: '1.5' }],
    ]
    for (const [id, correct, wrong] of cases) {
      const puzzle = saved(find(id))
      expect(gradePuzzle(puzzle, correct, puzzle.deadlineAtMs).status).toBe('succeeded')
      expect(gradePuzzle(puzzle, wrong, puzzle.deadlineAtMs).status).toBe('failed')
      expect(gradePuzzle(puzzle, correct, puzzle.deadlineAtMs + 1)).toMatchObject({ status: 'failed', reason: 'timeout' })
    }
  })

  it('only strips one complete outer dollar wrapper without broadening mathematical equality', () => {
    expect(normalizeMathFillAnswer(' $\\dfrac32$ ')).toBe('\\dfrac32')
    expect(normalizeMathFillAnswer('$x$+$y$')).toBe('$x$+$y$')
    expect(normalizeMathFillAnswer('$$x$$')).toBe('$$x$$')
    expect(normalizeMathFillAnswer('\\frac{3}{2}')).not.toBe(normalizeMathFillAnswer('\\dfrac32'))
  })

  it('honors fixed fine kind with or without the bank and keeps math outside the generation seam', () => {
    expect(math.MATH_QUESTION_BANK).toHaveLength(41)
    let generatedMath = false
    for (let attempt = 1; attempt <= 12; attempt++) {
      for (const bank of [[], math.MATH_QUESTION_BANK]) {
        const sudoku = createPuzzle({ ...input, attempt, calibrationKind: 'sudoku', mathBank: bank })
        expect(sudoku.definition.kind).toBe('sudoku')
        const mathPuzzle = createPuzzle({ ...input, attempt, calibrationKind: 'math', mathBank: bank }, {
          generateCandidate: context => { generatedMath ||= context.kind.startsWith('math'); return null },
        })
        expect(bank.length ? ['math-choice', 'math-fill'] : ['minesweeper', 'sudoku']).toContain(mathPuzzle.definition.kind)
      }
      const quick = createPuzzle({ ...input, attempt, machineId: 'quick', calibrationKind: 'math' })
      expect(['number-search', 'connect', 'identify']).toContain(quick.definition.kind)
    }
    expect(generatedMath).toBe(false)
  })

  it('uses reproducible math redraws for consecutive attempts across machines and restored state', () => {
    const first = createPuzzle({ ...input, calibrationKind: 'math' })
    const retry = createPuzzle({ ...input, calibrationKind: 'math', attempt: 2 })
    expect(first.definition.kind).toMatch(/^math-/)
    expect(retry.definition).not.toEqual(first.definition)
    expect(createPuzzle({ ...input, calibrationKind: 'math', shiftRunId: 'other-device', startedAtMs: 9000 }).definition).toEqual(first.definition)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
  })
})
