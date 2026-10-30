import { describe, expect, it, vi } from 'vitest'
import { ORDER_TEMPLATES } from '../content/production'
import { evaluateOrder, type DeliveryContext } from '../domain/shift-evaluation'
import type { CraftRequirement, CraftResult, CriterionRule, OrderCriterion, OrderTemplate, PlacedElement, PreparationSelection, ShiftCardSnapshot } from '../domain/shift-types'

const normalDelivery: DeliveryContext = {
  machineId: 'fine',
  patience: { phase: 'normal', remainingSeconds: 300, initialSeconds: 300 },
}

function fixture(): { order: OrderTemplate; snapshot: ShiftCardSnapshot } {
  const order = ORDER_TEMPLATES.find((candidate) => candidate.id === 'chino-coffee')!
  return {
    order,
    snapshot: {
      kind: 'production-card', version: 1, id: 'card', shiftRunId: 'shift', orderId: order.id,
      draftId: 'draft', draftRevision: 1, savedAtMs: 0,
      design: {
        version: 1,
        preparation: { ...order.requirements },
        elements: [
          { id: 'coffee', assetId: 'coffee-cup', kind: 'motif', slotId: 'main', size: 'medium', direction: 'upright', layer: 'front' },
          { id: 'thanks', assetId: 'thanks', kind: 'word-stamp', slotId: 'title', size: 'small', direction: 'upright', layer: 'front' },
        ],
        crafts: [],
      },
    },
  }
}

function criterion(id: string, rule: CriterionRule): OrderCriterion {
  return { id, label: '公开条件', tags: [], rule, optionalMaterialCosts: [] }
}

function craftFixture(requirementPatch: Partial<CraftRequirement> = {}, resultPatch: Partial<CraftResult> = {}) {
  const { order, snapshot } = fixture()
  const requirement: CraftRequirement = {
    id: 'stamp-work', kind: 'stamp', label: '公开工艺',
    targets: { position: { min: 0.45, max: 0.55 }, pressure: { min: 0.4, max: 0.6 } },
    discrete: {}, materialCosts: [], ...requirementPatch,
  }
  const craft: CraftResult = {
    id: 'attempt', requirementId: requirement.id, kind: requirement.kind,
    measurements: { position: 0.5, pressure: 0.5 }, discrete: { ...requirement.discrete },
    completedAtMs: 100, ...resultPatch,
  }
  return {
    order: { ...order, requirements: { ...order.requirements, crafts: [requirement] } },
    snapshot: { ...snapshot, design: { ...snapshot.design, crafts: [craft] } },
    requirement, craft,
  }
}

describe('shift order evaluation', () => {
  it('gives an exact full score to a complete, matching, timely card', () => {
    const { order, snapshot } = fixture()
    expect(evaluateOrder(order, snapshot, normalDelivery)).toMatchObject({
      accuracy: 40, preferences: 20, quality: 15, printing: 15, timeliness: 10,
      rawScore: 100, score: 100, grade: 'S', satisfied: true,
      missingRequiredIds: [], tabooViolated: false, advice: [], issues: [],
    })
  })

  it.each([
    ['paperId', 'sky', 'paper-color-mismatch', false],
    ['paperMaterialId', 'linen', 'paper-material-mismatch', false],
    ['shapeId', 'square', 'shape-mismatch', false],
    ['orientation', 'portrait', 'orientation-mismatch', true],
    ['layoutId', 'postcard', 'layout-mismatch', true],
  ] as const)('deducts exactly four accuracy points for %s', (field, value, code, satisfied) => {
    const { order, snapshot } = fixture()
    const preparation: PreparationSelection = { ...snapshot.design.preparation, [field]: value }
    const result = evaluateOrder(order, { ...snapshot, design: { ...snapshot.design, preparation } }, normalDelivery)
    expect(result.accuracy).toBe(36)
    expect(result.satisfied).toBe(satisfied)
    expect(result.issues).toContainEqual({ code })
  })

  it.each([
    ['slotId', 'title', 11.25, 'assembly-slot-incompatible'],
    ['size', 'small', 13.125, 'assembly-size-not-allowed'],
    ['direction', 'inverted', 13.125, 'assembly-direction-not-allowed'],
    ['layer', 'unknown', 13.125, 'assembly-layer-not-allowed'],
    ['slotId', 'unknown', 7.5, 'assembly-slot-missing'],
  ] as const)('scores the independent assembly check for %s=%s', (field, value, quality, code) => {
    const { order, snapshot } = fixture()
    const element = { ...snapshot.design.elements[0], [field]: value } as PlacedElement
    const result = evaluateOrder(order, {
      ...snapshot, design: { ...snapshot.design, elements: [element, snapshot.design.elements[1]] },
    }, normalDelivery)
    expect(result.accuracy).toBe(40)
    expect(result.quality).toBe(quality)
    expect(result.satisfied).toBe(true)
    expect(result.issues).toContainEqual({ code, elementId: 'coffee' })
  })

  it('counts an optional placed element in the assembly mean', () => {
    const { order, snapshot } = fixture()
    const result = evaluateOrder(order, {
      ...snapshot, design: { ...snapshot.design, elements: [
        ...snapshot.design.elements,
        { id: 'dot', assetId: 'dot', kind: 'decoration', slotId: 'left', size: 'large', direction: 'upright', layer: 'front' },
      ] },
    }, normalDelivery)
    expect(result.quality).toBe(13.75)
    expect(result.rawScore).toBe(98.75)
    expect(result.score).toBe(99)
  })

  it.each(['motif', 'word-stamp', 'decoration', 'border'] as const)('caps missing required %s at 49 despite all other bonuses', (kind) => {
    const { order, snapshot } = fixture()
    const required = { id: 'missing', kind, assetId: 'absent', label: '必需内容', quantity: 1 }
    const result = evaluateOrder({ ...order, requirements: { ...order.requirements, elements: [...order.requirements.elements, required] } }, snapshot, normalDelivery)
    expect(result.accuracy).toBeCloseTo(20 + 40 / 3)
    expect(result.quality).toBe(10)
    expect(result.rawScore).toBe(49)
    expect(result.score).toBe(49)
    expect(result.grade).toBe('D')
    expect(result.satisfied).toBe(false)
    expect(result.missingRequiredIds).toEqual(['missing'])
    expect(result.issues).toContainEqual({ code: 'required-content-missing', requirementId: 'missing', kind, assetId: 'absent', missingQuantity: 1 })
  })

  it('requires distinct placements for required quantities and duplicate demand', () => {
    const { order, snapshot } = fixture()
    for (const elements of [
      [{ ...order.requirements.elements[0], quantity: 2 }, order.requirements.elements[1]],
      [...order.requirements.elements, { ...order.requirements.elements[0], id: 'second-coffee' }],
    ]) {
      const result = evaluateOrder({ ...order, requirements: { ...order.requirements, elements } }, snapshot, normalDelivery)
      expect(result.accuracy).toBeCloseTo(20 + 40 / 3)
      expect(result.quality).toBe(10)
      expect(result.score).toBe(49)
    }
  })

  it('distinguishes an asset with the wrong content type from correctly present content', () => {
    const { order, snapshot } = fixture()
    const result = evaluateOrder(order, {
      ...snapshot, design: { ...snapshot.design, elements: [
        { ...snapshot.design.elements[0], kind: 'decoration' }, snapshot.design.elements[1],
      ] },
    }, normalDelivery)
    expect(result.accuracy).toBe(30)
    expect(result.score).toBe(49)
    expect(result.issues).toContainEqual({
      code: 'required-content-type-mismatch', requirementId: 'motif:coffee-cup', elementId: 'coffee', expectedKind: 'motif', actualKind: 'decoration',
    })
  })

  it.each<[string, CriterionRule, boolean]>([
    ['all tags across selections', { kind: 'tags', tags: ['warm', 'coffee', 'readable'], match: 'all' }, true],
    ['all tags with one absent', { kind: 'tags', tags: ['coffee', 'garden'], match: 'all' }, false],
    ['any present tag', { kind: 'tags', tags: ['coffee', 'garden'], match: 'any' }, true],
    ['no present tag', { kind: 'tags', tags: ['garden', 'star'], match: 'any' }, false],
    ['layout tag', { kind: 'layout-tag', tag: 'whitespace' }, true],
    ['tag present only on an element', { kind: 'layout-tag', tag: 'coffee' }, false],
    ['inclusive count bounds', { kind: 'element-count', minimum: 2, maximum: 2 }, true],
    ['too few elements', { kind: 'element-count', minimum: 3, maximum: 4 }, false],
    ['too many elements', { kind: 'element-count', minimum: 0, maximum: 1 }, false],
  ])('evaluates preference %s independently', (_name, rule, met) => {
    const { order, snapshot } = fixture()
    const result = evaluateOrder({ ...order, preferences: [order.preferences[0], criterion('tested', rule)] }, snapshot, normalDelivery)
    expect(result.preferences).toBe(met ? 20 : 15)
    if (!met) expect(result.issues).toContainEqual({ code: 'preference-unmet', criterionId: 'tested' })
  })

  it('gives a single public preference the whole ten-point preference share', () => {
    const { order, snapshot } = fixture()
    const preference = criterion('garden', { kind: 'tags', tags: ['garden'], match: 'all' })
    const result = evaluateOrder({ ...order, preferences: [preference] }, snapshot, normalDelivery)
    expect(result.preferences).toBe(10)
    expect(result.rawScore).toBe(90)
  })

  it('looks up element tags in the actual kind catalog when asset IDs overlap', () => {
    const { order, snapshot } = fixture()
    const preference = criterion('warm', { kind: 'tags', tags: ['warm'], match: 'all' })
    const preparation: PreparationSelection = { ...snapshot.design.preparation, paperId: 'sky', layoutId: 'balanced' }
    const evaluateKind = (kind: 'motif' | 'word-stamp') => evaluateOrder({ ...order, preferences: [preference] }, {
      ...snapshot, design: { ...snapshot.design, preparation, elements: [
        { ...snapshot.design.elements[0], assetId: 'rabbit-house', kind },
      ] },
    }, normalDelivery)
    expect(evaluateKind('word-stamp').preferences).toBe(10)
    expect(evaluateKind('motif').preferences).toBe(20)
  })

  it('keeps a taboo violation at numeric 90 while capping its letter grade at A', () => {
    const { order, snapshot } = fixture()
    const result = evaluateOrder(order, {
      ...snapshot, design: { ...snapshot.design, elements: [
        ...snapshot.design.elements,
        { id: 'sparkle', assetId: 'sparkle', kind: 'decoration', slotId: 'left', size: 'small', direction: 'upright', layer: 'front' },
      ] },
    }, normalDelivery)
    expect(result.preferences).toBe(10)
    expect(result.tabooViolated).toBe(true)
    expect(result.rawScore).toBe(90)
    expect(result.score).toBe(90)
    expect(result.grade).toBe('A')
    expect(result.satisfied).toBe(true)
    expect(result.issues).toContainEqual({ code: 'taboo-violated', criterionId: 'no-busy' })
    expect(result.advice).toContain('taboo-violated')
  })

  it.each([
    [0.45, 1], [0.55, 1],
    [0.440001, 1], [0.44, 1], [0.439999, 0.75],
    [0.559999, 1], [0.56, 1], [0.560001, 0.75],
    [0.425001, 0.75], [0.425, 0.75], [0.424999, 0.4],
    [0.574999, 0.75], [0.575, 0.75], [0.575001, 0.4],
    [0.400001, 0.4], [0.4, 0.4], [0.399999, 0],
    [0.599999, 0.4], [0.6, 0.4], [0.600001, 0],
  ])('uses the inclusive craft tolerance at position %f (quality %f)', (position, quality) => {
    const { order, snapshot } = craftFixture({}, { measurements: { position, pressure: 0.5 } })
    const result = evaluateOrder(order, snapshot, normalDelivery)
    expect(result.craftQualities).toEqual([{ requirementId: 'stamp-work', quality, completed: true, discreteCorrect: true }])
    expect(result.quality).toBe(15 * (1 + quality) / 2)
    expect(result.satisfied).toBe(true)
  })

  it.each([[0.505, 1], [0.505001, 0.75], [0.5125, 0.75], [0.512501, 0.4], [0.525, 0.4], [0.525001, 0]])(
    'uses the 0.05 scale floor for a point target at %f', (position, quality) => {
      const { order, snapshot } = craftFixture({ targets: { position: { min: 0.5, max: 0.5 } } }, { measurements: { position } })
      expect(evaluateOrder(order, snapshot, normalDelivery).quality).toBe(15 * (1 + quality) / 2)
    },
  )

  it('uses the worst normalized dimension, not an average of dimensions', () => {
    const { order, snapshot } = craftFixture({}, { measurements: { position: 0.56, pressure: 0.65 } })
    const result = evaluateOrder(order, snapshot, normalDelivery)
    expect(result.quality).toBe(13.125)
    expect(result.craftQualities[0].quality).toBe(0.75)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'craft-target-missed', requirementId: 'stamp-work', dimension: 'pressure' }))
  })

  it('caps an entirely absent required craft at 49 even when its content is perfect', () => {
    const { order, snapshot } = craftFixture()
    const result = evaluateOrder(order, { ...snapshot, design: { ...snapshot.design, crafts: [] } }, normalDelivery)
    expect(result.quality).toBe(7.5)
    expect(result.rawScore).toBe(49)
    expect(result.satisfied).toBe(false)
    expect(result.missingRequiredIds).toEqual(['stamp-work'])
    expect(result.issues).toContainEqual({ code: 'required-craft-missing', requirementId: 'stamp-work' })
  })

  it('does not accept a different craft kind under the required craft ID', () => {
    const { order, snapshot } = craftFixture({}, { kind: 'trim' })
    const result = evaluateOrder(order, snapshot, normalDelivery)
    expect(result.score).toBe(49)
    expect(result.satisfied).toBe(false)
    expect(result.issues).toContainEqual({ code: 'required-craft-kind-mismatch', requirementId: 'stamp-work', expectedKind: 'stamp', actualKind: 'trim' })
  })

  it.each<Readonly<Record<string, string>>>([{ color: 'red', stamp: 'star' }, { color: 'blue', stamp: 'rabbit' }, { stamp: 'star' }])(
    'vetoes satisfaction for any wrong or missing discrete attribute: %j', (discrete) => {
      const { order, snapshot } = craftFixture({ kind: 'wax', discrete: { color: 'blue', stamp: 'star' } }, { discrete })
      const result = evaluateOrder(order, snapshot, normalDelivery)
      expect(result.quality).toBe(7.5)
      expect(result.rawScore).toBe(92.5)
      expect(result.score).toBe(93)
      expect(result.satisfied).toBe(false)
      expect(result.missingRequiredIds).toEqual([])
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'craft-discrete-mismatch', requirementId: 'stamp-work' }))
    },
  )

  it('scores a completed craft with missing measurements as zero quality without the absence cap', () => {
    const { order, snapshot } = craftFixture({}, { measurements: {} })
    const result = evaluateOrder(order, snapshot, normalDelivery)
    expect(result.quality).toBe(7.5)
    expect(result.rawScore).toBe(92.5)
    expect(result.satisfied).toBe(true)
    expect(result.issues).toContainEqual({ code: 'craft-measurement-missing', requirementId: 'stamp-work', dimension: 'position' })
  })

  it('averages required crafts equally and excludes optional craft attempts', () => {
    const { order, snapshot, requirement, craft } = craftFixture()
    const secondRequirement: CraftRequirement = { ...requirement, id: 'trim-work', kind: 'trim' }
    const secondCraft: CraftResult = { ...craft, id: 'trim', requirementId: 'trim-work', kind: 'trim', measurements: { position: 0, pressure: 0 } }
    const optional: CraftResult = { ...secondCraft, id: 'optional', requirementId: 'optional' }
    const result = evaluateOrder({ ...order, requirements: { ...order.requirements, crafts: [requirement, secondRequirement] } }, {
      ...snapshot, design: { ...snapshot.design, crafts: [craft, secondCraft, optional] },
    }, normalDelivery)
    expect(result.quality).toBe(10)
    expect(result.craftQualities).toHaveLength(2)
    expect(result.satisfied).toBe(true)
  })

  it.each([[100, 200, 1], [300, 200, 0], [200, 200, 1]])(
    'scores the latest completed attempt, breaking equal times by array position (%i, %i)', (badAt, goodAt, quality) => {
      const { order, snapshot, craft } = craftFixture()
      const result = evaluateOrder(order, { ...snapshot, design: { ...snapshot.design, crafts: [
        { ...craft, id: 'bad', completedAtMs: badAt, measurements: { position: 0, pressure: 0 } },
        { ...craft, id: 'redo', completedAtMs: goodAt },
      ] } }, normalDelivery)
      expect(result.craftQualities[0].quality).toBe(quality)
      expect(result.quality).toBe(15 * (1 + quality) / 2)
    },
  )

  it.each(['matte', 'gloss', 'foil', 'emboss', 'wax'] as const)('scores both printers deterministically for a %s order', (surfaceFinishId) => {
    const { order, snapshot } = fixture()
    const requested = { ...order, requirements: { ...order.requirements, surfaceFinishId } }
    const fine = evaluateOrder(requested, snapshot, { ...normalDelivery, machineId: 'fine' })
    const quick = evaluateOrder(requested, snapshot, { ...normalDelivery, machineId: 'quick' })
    const complex = ['foil', 'emboss', 'wax'].includes(surfaceFinishId)
    expect(fine.printing).toBe(15)
    expect(quick.printing).toBe(complex ? 9 : 15)
    expect(fine.rawScore - quick.rawScore).toBe(complex ? 6 : 0)
    if (complex) expect(quick.issues).toContainEqual({ code: 'complex-card-quick-printer' })
  })

  it('classifies two required crafts as complex even with an ordinary finish', () => {
    const { order, snapshot, requirement, craft } = craftFixture()
    const twoCrafts = { ...order, requirements: { ...order.requirements, crafts: [requirement, { ...requirement, id: 'second' }] } }
    const complete = { ...snapshot, design: { ...snapshot.design, crafts: [craft, { ...craft, id: 'second-attempt', requirementId: 'second' }] } }
    expect(evaluateOrder(order, snapshot, { ...normalDelivery, machineId: 'quick' }).printing).toBe(15)
    const quick = evaluateOrder(twoCrafts, complete, { ...normalDelivery, machineId: 'quick' })
    const fine = evaluateOrder(twoCrafts, complete, normalDelivery)
    expect(quick.printing).toBe(9)
    expect(fine.rawScore - quick.rawScore).toBe(6)
  })

  it.each([[300, 10], [150, 7], [0, 4]])('scores normal patience with %i seconds remaining as %i', (remainingSeconds, timeliness) => {
    const { order, snapshot } = fixture()
    const result = evaluateOrder(order, snapshot, { ...normalDelivery, patience: { phase: 'normal', remainingSeconds, initialSeconds: 300 } })
    expect(result.timeliness).toBe(timeliness)
    if (remainingSeconds < 300) expect(result.issues).toContainEqual({ code: 'normal-patience-elapsed' })
  })

  it.each([[0, 3], [15, 1.5], [30, 0], [45, 0], [60, 0]])(
    'scores final wait at elapsed %i seconds against its original 30-second duration', (elapsedSeconds, timeliness) => {
      const { order, snapshot } = fixture()
      const result = evaluateOrder(order, snapshot, {
        machineId: 'fine', patience: { phase: 'last_wait', elapsedSeconds, originalDurationSeconds: 30 },
      })
      expect(result.timeliness).toBe(timeliness)
      expect(result.issues).toContainEqual({ code: elapsedSeconds >= 30 ? 'final-wait-original-exhausted' : 'final-wait-delivery' })
    },
  )

  it('does not restore points when explain-progress extends the departure deadline', () => {
    const { order, snapshot } = fixture()
    // The scheduler can keep the customer until 60s; the evaluator receives the original 30s denominator.
    const context = {
      machineId: 'fine' as const,
      patience: { phase: 'last_wait' as const, elapsedSeconds: 45, originalDurationSeconds: 30 },
      extendedDepartureAfterSeconds: 60,
    }
    const result = evaluateOrder(order, snapshot, context)
    expect(result.timeliness).toBe(0)
    expect(result.rawScore).toBe(90)
  })

  it('retains fractional components and rounds only the final sum', () => {
    const { order, snapshot } = craftFixture({}, { measurements: { position: 0.575, pressure: 0.5 } })
    const result = evaluateOrder(order, { ...snapshot, design: { ...snapshot.design, elements: [
      { ...snapshot.design.elements[0], size: 'small' }, snapshot.design.elements[1],
    ] } }, { machineId: 'fine', patience: { phase: 'normal', remainingSeconds: 220, initialSeconds: 300 } })
    expect(result.assemblyQuality).toBe(0.875)
    expect(result.quality).toBe(12.1875)
    expect(result.timeliness).toBe(8.4)
    expect(result.rawScore).toBeCloseTo(95.5875, 12)
    expect(result.score).toBe(96)
    expect(Math.round(result.accuracy) + Math.round(result.preferences) + Math.round(result.quality) + Math.round(result.printing) + Math.round(result.timeliness)).toBe(95)
  })

  it.each([[5, 59.5, 60, 'C', true], [5.1, 59.49, 59, 'D', false]] as const)(
    'uses displayed score, not raw score or qualityExpectation, for satisfaction at elapsed %f', (elapsedSeconds, rawScore, score, grade, satisfied) => {
      const { order, snapshot } = fixture()
      const result = evaluateOrder({ ...order, qualityExpectation: 70, preferences: [criterion('unmet', { kind: 'tags', tags: ['unavailable'], match: 'all' })] }, {
        ...snapshot, design: { ...snapshot.design,
          preparation: { ...snapshot.design.preparation, orientation: 'portrait', layoutId: 'postcard' },
          elements: snapshot.design.elements.map((element) => ({ ...element, slotId: 'absent' })),
        },
      }, { machineId: 'fine', patience: { phase: 'last_wait', elapsedSeconds, originalDurationSeconds: 30 } })
      expect(result.rawScore).toBeCloseTo(rawScore, 12)
      expect(result.score).toBe(score)
      expect(result.grade).toBe(grade)
      expect(result.satisfied).toBe(satisfied)
    },
  )

  it.each([
    [89, 'A', false, false, 0, { phase: 'normal', remainingSeconds: 250, initialSeconds: 300 }],
    [80, 'A', false, false, 0, { phase: 'last_wait', elapsedSeconds: 30, originalDurationSeconds: 30 }],
    [79, 'B', true, false, 0, { phase: 'last_wait', elapsedSeconds: 0, originalDurationSeconds: 30 }],
    [70, 'B', true, true, 1, { phase: 'last_wait', elapsedSeconds: 30, originalDurationSeconds: 30 }],
    [69, 'C', true, true, 2, { phase: 'last_wait', elapsedSeconds: 22.5, originalDurationSeconds: 30 }],
  ] as const)('assigns displayed %i to grade %s', (score, grade, rotate, changeLayout, invertedCount, patience) => {
    const { order, snapshot } = fixture()
    const result = evaluateOrder({ ...order, preferences: [criterion('unmet', { kind: 'tags', tags: ['unavailable'], match: 'all' })] }, {
      ...snapshot, design: { ...snapshot.design,
        preparation: { ...snapshot.design.preparation, orientation: rotate ? 'portrait' : 'landscape', layoutId: changeLayout ? 'postcard' : 'clear-note' },
        elements: snapshot.design.elements.map((element, index) => ({ ...element, direction: index < invertedCount ? 'inverted' : 'upright' })),
      },
    }, { machineId: 'fine', patience })
    expect(result.score).toBe(score)
    expect(result.grade).toBe(grade)
  })

  it('is deterministic, uses no ambient time/randomness, and leaves deeply frozen inputs untouched', () => {
    const source = craftFixture({}, { measurements: { position: 0.575, pressure: 0.5 } })
    const inputs = structuredClone({ order: source.order, snapshot: source.snapshot, delivery: normalDelivery })
    function freeze(value: unknown): void {
      if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child)
        Object.freeze(value)
      }
    }
    freeze(inputs)
    const before = JSON.stringify(inputs)
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Ambient clock used') })
    const randomness = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Ambient randomness used') })
    const results: ReturnType<typeof evaluateOrder>[] = []
    try {
      for (let repeat = 0; repeat < 3; repeat++) results.push(evaluateOrder(inputs.order, inputs.snapshot, inputs.delivery))
    } finally {
      clock.mockRestore()
      randomness.mockRestore()
    }
    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
    expect(JSON.stringify(inputs)).toBe(before)
    expect(JSON.parse(JSON.stringify(results[0]))).toEqual(results[0])
  })
})
