import { BORDERS, DECORATIONS, LAYOUTS, MOTIFS, PAPERS, SHAPES, SURFACE_FINISHES, WORD_STAMPS, isComplexOrder } from '../content/production'
import type {
  CatalogItem, CraftDimension, CraftKind, CraftRequirement, CraftResult, CriterionRule,
  ElementKind, LayoutDefinition, MachineId, OrderEvaluation, OrderTemplate, ShiftCardSnapshot,
} from './shift-types'

/** Durations are operating time, excluding controlled pauses; rescue never changes the original wait. */
export type DeliveryContext = Readonly<{
  machineId: MachineId
  patience:
    | Readonly<{ phase: 'normal'; remainingSeconds: number; initialSeconds: number }>
    | Readonly<{ phase: 'last_wait'; elapsedSeconds: number; originalDurationSeconds: number }>
}>

export type ShiftEvaluationIssue =
  | Readonly<{ code: 'paper-color-mismatch' | 'paper-material-mismatch' | 'shape-mismatch' | 'orientation-mismatch' | 'layout-mismatch' }>
  | Readonly<{ code: 'required-content-missing'; requirementId: string; kind: ElementKind; assetId: string; missingQuantity: number }>
  | Readonly<{ code: 'required-content-type-mismatch'; requirementId: string; elementId: string; expectedKind: ElementKind; actualKind: ElementKind }>
  | Readonly<{ code: 'assembly-slot-missing' | 'assembly-slot-incompatible' | 'assembly-size-not-allowed' | 'assembly-direction-not-allowed' | 'assembly-layer-not-allowed'; elementId: string }>
  | Readonly<{ code: 'preference-unmet' | 'taboo-violated'; criterionId: string }>
  | Readonly<{ code: 'required-craft-missing'; requirementId: string }>
  | Readonly<{ code: 'required-craft-kind-mismatch'; requirementId: string; expectedKind: CraftKind; actualKind: CraftKind }>
  | Readonly<{ code: 'craft-discrete-mismatch'; requirementId: string; attribute: string; expected: string; actual: string | null }>
  | Readonly<{ code: 'craft-measurement-missing'; requirementId: string; dimension: CraftDimension }>
  | Readonly<{ code: 'craft-target-missed'; requirementId: string; dimension: CraftDimension; deviation: number }>
  | Readonly<{ code: 'complex-card-quick-printer' | 'normal-patience-elapsed' | 'final-wait-delivery' | 'final-wait-original-exhausted' }>

export type RequiredCraftQuality = Readonly<{
  requirementId: string
  quality: number
  completed: boolean
  discreteCorrect: boolean
}>

export type ShiftOrderEvaluation = OrderEvaluation & Readonly<{
  issues: readonly ShiftEvaluationIssue[]
  assemblyQuality: number
  craftQualities: readonly RequiredCraftQuality[]
}>

function letterGrade(score: number): OrderEvaluation['grade'] {
  return score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D'
}

function matchesCriterion(rule: CriterionRule, tags: ReadonlySet<string>, layout: LayoutDefinition | undefined, count: number): boolean {
  switch (rule.kind) {
    case 'tags': return rule.match === 'all' ? rule.tags.every((tag) => tags.has(tag)) : rule.tags.some((tag) => tags.has(tag))
    case 'layout-tag': return layout?.tags.includes(rule.tag) ?? false
    case 'element-count': return count >= rule.minimum && count <= rule.maximum
  }
}

function evaluateCraft(requirement: CraftRequirement, attempts: readonly CraftResult[], issues: ShiftEvaluationIssue[]): RequiredCraftQuality {
  let latest: CraftResult | undefined
  for (const attempt of attempts) {
    // Rework replaces the visible result; array position resolves simultaneous completions.
    if (attempt.requirementId === requirement.id && (!latest || attempt.completedAtMs >= latest.completedAtMs)) latest = attempt
  }
  if (!latest || latest.kind !== requirement.kind) {
    issues.push({ code: 'required-craft-missing', requirementId: requirement.id })
    if (latest) issues.push({ code: 'required-craft-kind-mismatch', requirementId: requirement.id, expectedKind: requirement.kind, actualKind: latest.kind })
    return { requirementId: requirement.id, quality: 0, completed: false, discreteCorrect: false }
  }
  let discreteCorrect = true
  for (const [attribute, expected] of Object.entries(requirement.discrete)) {
    const actual = latest.discrete[attribute] ?? null
    if (actual !== expected) {
      discreteCorrect = false
      issues.push({ code: 'craft-discrete-mismatch', requirementId: requirement.id, attribute, expected, actual })
    }
  }
  let worstDeviation = 0
  for (const [dimension, target] of Object.entries(requirement.targets) as [CraftDimension, { min: number; max: number }][]) {
    const value = latest.measurements[dimension]
    if (value === undefined || !Number.isFinite(value)) {
      worstDeviation = Infinity
      issues.push({ code: 'craft-measurement-missing', requirementId: requirement.id, dimension })
      continue
    }
    const deviation = Math.max(target.min - value, 0, value - target.max) / Math.max(target.max - target.min, 0.05)
    worstDeviation = Math.max(worstDeviation, deviation)
    if (deviation > 0) issues.push({ code: 'craft-target-missed', requirementId: requirement.id, dimension, deviation })
  }
  // Decimal interval edges (e.g. .56 against [.45, .55]) can differ by a few ULPs.
  const epsilon = 32 * Number.EPSILON
  const quality = !discreteCorrect ? 0 : worstDeviation <= 0.1 + epsilon ? 1
    : worstDeviation <= 0.25 + epsilon ? 0.75 : worstDeviation <= 0.5 + epsilon ? 0.4 : 0
  return { requirementId: requirement.id, quality, completed: true, discreteCorrect }
}

/** The single scoring authority for a completed production card; never reads live clocks or puzzle state. */
export function evaluateOrder(
  order: OrderTemplate, snapshot: ShiftCardSnapshot, delivery: DeliveryContext,
): ShiftOrderEvaluation {
  const { requirements } = order
  const { preparation, elements } = snapshot.design
  const issues: ShiftEvaluationIssue[] = []
  const preparationChecks = [
    ['paperId', 'paper-color-mismatch'], ['paperMaterialId', 'paper-material-mismatch'],
    ['shapeId', 'shape-mismatch'], ['orientation', 'orientation-mismatch'], ['layoutId', 'layout-mismatch'],
  ] as const
  let accuracy = 0
  for (const [field, code] of preparationChecks) {
    if (preparation[field] === requirements[field]) accuracy += 4
    else issues.push({ code })
  }

  const used = new Set<number>()
  const missingRequiredIds: string[] = []
  let requiredCount = 0
  let missingCount = 0
  for (const required of requirements.elements) {
    requiredCount += required.quantity
    let missingQuantity = 0
    for (let unit = 0; unit < required.quantity; unit++) {
      const index = elements.findIndex((element, index) =>
        !used.has(index) && element.kind === required.kind && element.assetId === required.assetId)
      if (index >= 0) used.add(index)
      else missingQuantity++
    }
    if (missingQuantity > 0) {
      missingCount += missingQuantity
      missingRequiredIds.push(required.id)
      issues.push({ code: 'required-content-missing', requirementId: required.id, kind: required.kind, assetId: required.assetId, missingQuantity })
      const wrongType = elements.find((element) => element.assetId === required.assetId && element.kind !== required.kind)
      if (wrongType) issues.push({ code: 'required-content-type-mismatch', requirementId: required.id,
        elementId: wrongType.id, expectedKind: required.kind, actualKind: wrongType.kind })
    }
  }
  accuracy += 20 * used.size / requiredCount

  const layout = LAYOUTS.find((candidate) => candidate.id === preparation.layoutId)
  let assemblyTotal = 0
  for (const element of elements) {
    const slot = layout?.slots.find((candidate) => candidate.id === element.slotId)
    if (!slot) {
      issues.push({ code: 'assembly-slot-missing', elementId: element.id })
      continue
    }
    const compatible = slot.accepts.includes(element.kind)
    const sizeAllowed = slot.sizes.includes(element.size)
    const directionAllowed = slot.directions.includes(element.direction)
    const layerAllowed = slot.layers.includes(element.layer)
    assemblyTotal += (compatible ? 0.5 : 0) + (sizeAllowed ? 0.25 : 0) + (directionAllowed && layerAllowed ? 0.25 : 0)
    if (!compatible) issues.push({ code: 'assembly-slot-incompatible', elementId: element.id })
    if (!sizeAllowed) issues.push({ code: 'assembly-size-not-allowed', elementId: element.id })
    if (!directionAllowed) issues.push({ code: 'assembly-direction-not-allowed', elementId: element.id })
    if (!layerAllowed) issues.push({ code: 'assembly-layer-not-allowed', elementId: element.id })
  }
  const assemblyQuality = assemblyTotal / (elements.length + missingCount)
  const craftQualities = requirements.crafts.map((requirement) => evaluateCraft(requirement, snapshot.design.crafts, issues))
  for (const craft of craftQualities) if (!craft.completed) missingRequiredIds.push(craft.requirementId)
  const quality = 15 * (assemblyQuality + craftQualities.reduce((sum, craft) => sum + craft.quality, 0)) / (1 + craftQualities.length)
  const catalogs: Record<ElementKind, readonly CatalogItem[]> = { motif: MOTIFS, 'word-stamp': WORD_STAMPS, decoration: DECORATIONS, border: BORDERS }
  const selectedItems = [
    PAPERS.find((paper) => paper.id === preparation.paperId),
    SHAPES.find((shape) => shape.id === preparation.shapeId),
    SURFACE_FINISHES.find((finish) => finish.id === preparation.surfaceFinishId),
    layout,
    ...elements.map((element) => catalogs[element.kind].find((asset) => asset.id === element.assetId)),
  ]
  const tags = new Set(selectedItems.flatMap((item) => item?.tags ?? []))
  const tabooViolated = matchesCriterion(order.taboo.rule, tags, layout, elements.length)
  let preferences = tabooViolated ? 0 : 10
  for (const preference of order.preferences) {
    if (matchesCriterion(preference.rule, tags, layout, elements.length)) preferences += 10 / order.preferences.length
    else issues.push({ code: 'preference-unmet', criterionId: preference.id })
  }
  if (tabooViolated) issues.push({ code: 'taboo-violated', criterionId: order.taboo.id })
  const printing = isComplexOrder(order) && delivery.machineId === 'quick' ? 9 : 15
  if (printing === 9) issues.push({ code: 'complex-card-quick-printer' })
  const { patience } = delivery
  let timeliness: number
  if (patience.phase === 'normal') {
    timeliness = Math.min(10, 4 + 6 * patience.remainingSeconds / patience.initialSeconds)
    if (patience.remainingSeconds < patience.initialSeconds) issues.push({ code: 'normal-patience-elapsed' })
  } else {
    timeliness = Math.max(0, 3 * (1 - patience.elapsedSeconds / patience.originalDurationSeconds))
    issues.push({ code: patience.elapsedSeconds >= patience.originalDurationSeconds ? 'final-wait-original-exhausted' : 'final-wait-delivery' })
  }
  const rawScore = Math.min(missingRequiredIds.length ? 49 : 100, Math.max(0, accuracy + preferences + quality + printing + timeliness))
  const score = Math.round(rawScore)
  const numericGrade = letterGrade(score)
  const grade = tabooViolated && numericGrade === 'S' ? 'A' : numericGrade
  const satisfied = score >= 60 && missingCount === 0 && preparation.paperId === requirements.paperId
    && preparation.paperMaterialId === requirements.paperMaterialId && preparation.shapeId === requirements.shapeId
    && craftQualities.every((craft) => craft.completed && craft.discreteCorrect)
  return {
    accuracy, preferences, quality, printing, timeliness, rawScore, score, grade, satisfied,
    missingRequiredIds, tabooViolated, advice: [...new Set(issues.map((issue) => issue.code))], issues, assemblyQuality, craftQualities,
  }
}
