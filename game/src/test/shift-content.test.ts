import { describe, expect, it, vi } from 'vitest'
import {
  AUTHORED_STAGES,
  BORDERS,
  DECORATIONS,
  LAYOUTS,
  MOTIFS,
  ORDER_TEMPLATES,
  PAPERS,
  SHAPES,
  SURFACE_FINISHES,
  WORD_STAMPS,
  generateSurvivalStage,
  inventoryShortfalls,
  isComplexOrder,
  requiredMaterialDemand,
} from '../content/production'
import { createRng, forkRng, nextRandom, pickRandom, randomInt, shuffleRandom } from '../domain/shift-rng'
import { MATH_QUESTION_BANK, validateMathQuestionBank } from '../../server/math-questions'

describe('production catalogs', () => {
  it.each([
    ['papers', PAPERS, 8],
    ['shapes', SHAPES, 6],
    ['layouts', LAYOUTS, 12],
    ['borders', BORDERS, 10],
    ['motifs', MOTIFS, 18],
    ['decorations', DECORATIONS, 24],
    ['word stamps', WORD_STAMPS, 10],
    ['surface finishes', SURFACE_FINISHES, 5],
  ] as const)('provides exactly the agreed number of %s', (_name, catalog, count) => {
    expect(catalog).toHaveLength(count)
    expect(new Set(catalog.map((item) => item.id)).size).toBe(count)
    for (const item of catalog) expect(item.label).toMatch(/[\u3400-\u9fff]/)
  })
})

describe('authored shifts', () => {
  it('declares a fixed fine-printer lesson for every authored calibration milestone', () => {
    const milestones = [
      ['tutorial', 4, 'sudoku'],
      ['beginner', 3, 'sudoku'],
      ['beginner', 5, 'math'],
      ['story', 2, 'math'],
      ['story', 4, 'sudoku'],
    ] as const
    for (const [id, customerNumber, kind] of milestones) {
      expect(AUTHORED_STAGES[id].customers[customerNumber - 1].calibrationPlan).toEqual({ fine: kind })
    }
  })

  it('increases authored puzzle difficulty from tutorial through beginner to story', () => {
    expect(['tutorial', 'beginner', 'story'].map((id) => AUTHORED_STAGES[id as keyof typeof AUTHORED_STAGES].puzzleDifficulty))
      .toEqual([0, 0.4, 0.8])
  })

  it.each([
    ['tutorial', [0, 55, 130, 210, 325], [285, 345, 325, 375, 270], [30, 30, 25, 35, 35], 4, 3],
    ['beginner', [0, 45, 105, 175, 265, 355], [270, 310, 285, 330, 240, 265], [25, 30, 25, 30, 20, 25], 5, 4],
    ['story', [0, 40, 90, 150, 220, 295, 375], [255, 295, 235, 325, 265, 235, 225], [25, 30, 20, 35, 25, 20, 20], 6, 5],
  ] as const)('preserves the complete %s schedule and pass thresholds', (id, arrivals, patience, lastWait, delivered, satisfied) => {
    const stage = AUTHORED_STAGES[id]
    expect(stage.durationSeconds).toBe(720)
    expect(stage.customers).toHaveLength(arrivals.length)
    expect(stage.customers.map((customer) => customer.arrivalSeconds)).toEqual(arrivals)
    expect(stage.customers.map((customer) => customer.basePatienceSeconds)).toEqual(patience)
    expect(stage.customers.map((customer) => customer.lastWaitSeconds)).toEqual(lastWait)
    expect(stage.thresholds).toEqual({ kind: 'authored', minDelivered: delivered, minSatisfied: satisfied, maxLeft: 1 })
    expect(stage.inspections).toBe(3)
    expect(stage.freeDemoInspections).toBe(id === 'tutorial' ? 1 : 0)
    expect(stage.seed).toBeTruthy()
  })

  it('has enough inventory for every required premium material in each authored shift', () => {
    for (const stage of Object.values(AUTHORED_STAGES)) {
      const demand = requiredMaterialDemand(stage.customers.map((customer) => customer.order))
      expect(Object.values(demand).some((quantity) => quantity > 0)).toBe(true)
      expect(inventoryShortfalls(stage.customers.map((customer) => customer.order), stage.inventory)).toEqual([])
      for (const [materialId, quantity] of Object.entries(demand)) {
        expect(quantity).toBeLessThanOrEqual(stage.inventory[materialId as keyof typeof stage.inventory])
      }
    }
  })

  it('derives required demand from actual selections and detects shortages', () => {
    const order = ORDER_TEMPLATES.find((template) => template.id === 'chiya-garden')!
    const demand = requiredMaterialDemand([order])
    expect(demand.lace).toBe(1)
    expect(demand['emboss-sheet']).toBe(1)
    expect(inventoryShortfalls([order], { ...demand, lace: 0 })).toEqual([
      { materialId: 'lace', required: 1, available: 0 },
    ])
  })

  it('expresses each official character’s preferences on the order ticket', () => {
    const expected = {
      chino: ['clear', 'coffee', 'whitespace'],
      cocoa: ['warm', 'rabbit', 'busy'],
      rize: ['layered', 'stable', 'star', 'ribbon'],
      chiya: ['garden', 'decorative-echo'],
      syaro: ['refined', 'restrained', 'readable'],
    }
    for (const [characterId, tags] of Object.entries(expected)) {
      const orders = ORDER_TEMPLATES.filter((order) => order.customer.kind === 'official' && order.customer.characterId === characterId)
      expect(orders.length).toBeGreaterThan(0)
      for (const order of orders) {
        expect(order.preferences.length).toBeGreaterThanOrEqual(1)
        expect(order.preferences.length).toBeLessThanOrEqual(2)
        expect(order.preferences.every((preference) => /[\u3400-\u9fff]/.test(preference.label))).toBe(true)
        expect(order.preferences.flatMap((preference) => preference.tags)).toEqual(expect.arrayContaining(tags))
        expect(order.taboo.label).toMatch(/[\u3400-\u9fff]/)
        expect(order.customer.situation).toMatch(/[\u3400-\u9fff]/)
      }
    }
  })

  it('uses valid catalog references and at most two handwork requirements', () => {
    const assets = { motif: MOTIFS, decoration: DECORATIONS, border: BORDERS, 'word-stamp': WORD_STAMPS }
    for (const order of ORDER_TEMPLATES) {
      expect(PAPERS.some((paper) => paper.id === order.requirements.paperId && paper.materialId === order.requirements.paperMaterialId)).toBe(true)
      expect(SHAPES.some((shape) => shape.id === order.requirements.shapeId)).toBe(true)
      expect(LAYOUTS.some((layout) => layout.id === order.requirements.layoutId)).toBe(true)
      expect(SURFACE_FINISHES.some((finish) => finish.id === order.requirements.surfaceFinishId)).toBe(true)
      expect(order.requirements.elements.length).toBeGreaterThan(0)
      expect(order.requirements.crafts.length).toBeLessThanOrEqual(2)
      for (const element of order.requirements.elements) {
        expect(assets[element.kind].some((asset) => asset.id === element.assetId)).toBe(true)
      }
    }
  })

  it('ends the story with an explicit commemorative order combining earlier themes', () => {
    const finale = AUTHORED_STAGES.story.customers.at(-1)!.order
    expect(finale.id).toBe('chino-keepsake')
    expect(finale.title).toContain('纪念')
    expect(finale.requirements.elements.map((element) => element.assetId)).toEqual(expect.arrayContaining([
      'coffee-cup', 'rabbit-paw', 'tiny-star', 'leaf-vine', 'anniversary',
    ]))
  })

  it('allows optional premium preferences to compete without inflating required demand', () => {
    const stage = AUTHORED_STAGES.tutorial
    const optionalDecorations = stage.customers.flatMap((customer) => customer.order.preferences)
      .flatMap((preference) => preference.optionalMaterialCosts)
      .filter((cost) => cost.materialId === 'premium-decoration')
      .reduce((total, cost) => total + cost.quantity, 0)
    expect(requiredMaterialDemand(stage.customers.map((customer) => customer.order))['premium-decoration']).toBe(0)
    expect(optionalDecorations).toBeGreaterThan(stage.inventory['premium-decoration'])
  })
})

describe('explicit deterministic randomness', () => {
  it('restores the exact cursor and never mutates the input state', () => {
    const initial = createRng('saved-shift')
    const first = nextRandom(initial)
    const restored = JSON.parse(JSON.stringify(first.rng))
    expect(nextRandom(initial)).toEqual(first)
    expect(initial.cursor).toBe(0)
    expect(first.rng.cursor).toBe(1)
    expect(nextRandom(restored)).toEqual(nextRandom(first.rng))
    expect(first.value).toBeGreaterThanOrEqual(0)
    expect(first.value).toBeLessThan(1)
  })

  it('provides stable integer, pick, shuffle, and namespaced fork helpers', () => {
    const seed = createRng('helper-contract')
    let rng = seed
    for (let draw = 0; draw < 100; draw++) {
      const result = randomInt(rng, -12, 12)
      expect(Number.isInteger(result.value)).toBe(true)
      expect(result.value).toBeGreaterThanOrEqual(-12)
      expect(result.value).toBeLessThanOrEqual(12)
      rng = result.rng
    }
    const source = ['one', 'two', 'three', 'four'] as const
    expect(source).toContain(pickRandom(seed, source).value)
    expect([...shuffleRandom(seed, source).value].sort()).toEqual([...source].sort())
    expect(shuffleRandom(seed, source)).toEqual(shuffleRandom(createRng('helper-contract'), source))
    expect(source).toEqual(['one', 'two', 'three', 'four'])
    expect(forkRng(seed, 'order:quick:1')).toEqual(forkRng(rng, 'order:quick:1'))
    expect(forkRng(seed, 'order:quick:1')).not.toEqual(forkRng(seed, 'order:fine:1'))
    expect(() => randomInt(seed, 2, 1)).toThrow()
    expect(() => pickRandom(seed, [])).toThrow()
  })
})

describe('survival schedule generation', () => {
  it.each([1, 2, 3, 20, 47, 101, 1000])('applies the exact count, arrival, patience, and difficulty formulas on day %i', (day) => {
    const stage = generateSurvivalStage(day, 'survival-contract')
    const count = 7 + Math.floor((day - 1) / 2)
    const horizon = Math.max(270, 450 - 6 * (day - 1))
    const reduction = Math.min(70, Math.floor(2.25 * (day - 1)))
    expect(stage.durationSeconds).toBe(720)
    expect(stage.customers).toHaveLength(count)
    expect(stage.arrivalHorizonSeconds).toBe(horizon)
    expect(stage.complexProbability).toBe(Math.min(0.8, 0.3 + 0.02 * (day - 1)))
    expect(stage.hardPuzzleWeight).toBe(Math.min(0.75, 0.2 + 0.025 * (day - 1)))
    expect(stage.patienceReductionSeconds).toBe(reduction)
    expect(stage.customers[0].arrivalSeconds).toBe(0)
    let previousArrival = 0
    stage.customers.forEach((customer, index) => {
      const base = Math.round(index * horizon / (count - 1))
      expect(customer.arrivalBaseSeconds).toBe(base)
      expect(Number.isInteger(customer.arrivalJitterSeconds)).toBe(true)
      expect(customer.arrivalJitterSeconds).toBeGreaterThanOrEqual(-12)
      expect(customer.arrivalJitterSeconds).toBeLessThanOrEqual(12)
      const arrival = index === 0 ? 0 : Math.max(previousArrival, Math.min(horizon, Math.max(0, base + customer.arrivalJitterSeconds)))
      expect(customer.arrivalSeconds).toBe(arrival)
      previousArrival = arrival
      expect(customer.unadjustedPatienceSeconds).toBeGreaterThanOrEqual(260)
      expect(customer.unadjustedPatienceSeconds).toBeLessThanOrEqual(420)
      expect(customer.basePatienceSeconds).toBe(customer.unadjustedPatienceSeconds - reduction)
      expect(customer.basePatienceSeconds).toBeGreaterThanOrEqual(190)
      expect(customer.lastWaitSeconds).toBeGreaterThanOrEqual(15)
      expect(customer.lastWaitSeconds).toBeLessThanOrEqual(35)
      expect(customer.order.requirements.crafts.length).toBeLessThanOrEqual(2)
    })
    expect(stage.customers.every((customer) => customer.order.customer.kind === 'official')).toBe(true)
    expect(stage.customers.filter((customer) => ['chino', 'cocoa', 'rize', 'chiya', 'syaro'].includes(customer.order.customer.characterId))).toHaveLength(2)
    expect(inventoryShortfalls(stage.customers.map((customer) => customer.order), stage.inventory)).toEqual([])
  })

  it('replays identical schedules and orders from the same seed without ambient randomness', () => {
    const ambient = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Ambient randomness is forbidden') })
    try {
      const first = generateSurvivalStage(7, 'replay-me')
      expect(generateSurvivalStage(7, 'replay-me')).toEqual(first)
      expect(JSON.parse(JSON.stringify(first))).toEqual(first)
      expect(generateSurvivalStage(7, 'another-seed')).not.toEqual(first)
      expect(() => generateSurvivalStage(0, 'bad-day')).toThrow()
      expect(() => generateSurvivalStage(1.5, 'bad-day')).toThrow()
    } finally {
      ambient.mockRestore()
    }
  })

  it('makes day 47 require at least 28 deliveries under the two-left cap', () => {
    const stage = generateSurvivalStage(47, 'upper-bound')
    expect(stage.customers).toHaveLength(30)
    expect(stage.thresholds).toEqual({ kind: 'survival', minDeliveredRatio: 0.7, satisfiedRatioExclusive: 0.5, maxLeft: 2 })
    expect(Math.max(Math.ceil(stage.customers.length * stage.thresholds.minDeliveredRatio), stage.customers.length - stage.thresholds.maxLeft)).toBe(28)
  })

  it('classifies complexity from required handwork and advanced finishes', () => {
    const ordinary = ORDER_TEMPLATES.find((order) => order.id === 'chino-coffee')!
    expect(isComplexOrder(ordinary)).toBe(false)
    expect(isComplexOrder(ORDER_TEMPLATES.find((order) => order.id === 'chiya-garden')!)).toBe(true)
    expect(isComplexOrder({ ...ordinary, requirements: { ...ordinary.requirements, crafts: [
      { id: 'one', kind: 'stamp', label: '盖章', targets: {}, discrete: {}, materialCosts: [] },
      { id: 'two', kind: 'trim', label: '裁边', targets: {}, discrete: {}, materialCosts: [] },
    ] } })).toBe(true)
  })
})

describe('owner-supplied mathematics content', () => {
  // These fixtures stay in the test suite and are never imported by production content.
  const choice = { id: 'test-choice', kind: 'math-choice', prompt: '测试题：选择列出的偶数', timeLimitSeconds: 60,
    options: [{ id: 'a', label: '2' }, { id: 'b', label: '3' }, { id: 'c', label: '4' }], correctOptionIds: ['a', 'c'] }
  const fill = { id: 'test-fill', kind: 'math-fill', prompt: '测试题：填写约定答案', timeLimitSeconds: 120, acceptedAnswers: ['-1', '−１'] }

  it('ships the 41 validated owner-supplied questions with no runtime placeholders', () => {
    expect(MATH_QUESTION_BANK).toHaveLength(41)
    expect(validateMathQuestionBank(MATH_QUESTION_BANK)).toEqual({ questions: MATH_QUESTION_BANK, errors: [] })
    expect(MATH_QUESTION_BANK.every((question) => !/测试题|占位|placeholder|injected/iu.test(question.prompt))).toBe(true)
  })

  it('accepts explicitly supplied choice answer sets and fill answer lists', () => {
    expect(validateMathQuestionBank([choice, fill])).toEqual({ questions: [choice, fill], errors: [] })
    const singleChoice = { ...choice, id: 'test-single', correctOptionIds: ['a'] }
    expect(validateMathQuestionBank([singleChoice]).questions).toEqual([singleChoice])
  })

  it.each([
    ['acceptedAnswers', { ...fill, acceptedAnswers: Array(1) }],
    ['correctOptionIds', { ...choice, correctOptionIds: Array(1) }],
    ['options', { ...choice, options: Object.assign(Array(2), { 0: choice.options[0] }), correctOptionIds: ['a'] }],
  ])('rejects sparse %s arrays instead of serializing holes as null', (_field, question) => {
    const result = validateMathQuestionBank([question])
    expect(result.questions).toEqual([])
    expect(result.errors).toHaveLength(1)
  })

  it('excludes invalid answers, limits, repeated options, and every duplicate question id', () => {
    const invalid = [
      { ...choice, id: 'unknown-answer', correctOptionIds: ['missing'] },
      { ...choice, id: 'bad-limit', timeLimitSeconds: 121 },
      { ...fill, id: 'blank-answer', acceptedAnswers: ['　 '] },
      { ...choice, id: 'duplicate-option', options: [{ id: 'a', label: '2' }, { id: 'a', label: '4' }] },
      { ...choice, id: 'duplicate-answer', correctOptionIds: ['a', 'a'] },
      { ...fill, id: 'duplicate-id' }, { ...fill, id: 'duplicate-id' },
    ]
    const result = validateMathQuestionBank(invalid)
    expect(result.questions).toEqual([])
    expect(result.errors).toHaveLength(invalid.length)
    expect(result.errors.every((error) => error.message.length > 0)).toBe(true)
  })
})
