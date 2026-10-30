import { describe, expect, it, vi } from 'vitest'
import { AUTHORED_STAGES, generateSurvivalStage } from '../content/production'
import { advanceShift, initializeShift } from '../domain/shift-engine'
import type { AuthoredStageId, OrderEvaluation, ShiftProgression, ShiftResult, ShiftRun, StageDefinition } from '../domain/shift-types'
import { beginSurvivalRun, createInitialShiftProgression, nextAuthoredStage, recordShiftResult, survivalStageFor } from '../app/progression'

const evaluation = (satisfied: boolean): OrderEvaluation => ({ accuracy: satisfied ? 40 : 20, preferences: 10, quality: 10, printing: 15, timeliness: 5,
  rawScore: satisfied ? 80 : 55, score: satisfied ? 80 : 55, grade: satisfied ? 'A' : 'D', satisfied,
  missingRequiredIds: satisfied ? [] : ['required-motif'], tabooViolated: false, advice: [] })

/** Settlement fixtures use the same engine thresholds as a played shift. */
function resultFor(stage: StageDefinition, delivered: number, satisfied: number, id = stage.id): ShiftResult {
  const initial = initializeShift(stage, id, 1_000)
  const run: ShiftRun = { ...initial, orders: initial.orders.map((order, index) => index < delivered ? {
    ...order, position: 'closed', acceptedAtMs: order.arrivalAtMs,
    outcome: { status: 'delivered', taskId: `printed:${index}`, deliveredAtMs: order.arrivalAtMs + 50_000, evaluation: evaluation(index < satisfied) },
  } : order) }
  const settled = advanceShift(run, initial.deadlineAtMs)
  if (settled.status !== 'settled') throw new Error('Expected a closed shift')
  return settled.result
}

const completedStory = () => (['tutorial', 'beginner', 'story'] as const).reduce<ShiftProgression>((progress, id) => {
  const stage = AUTHORED_STAGES[id]
  return recordShiftResult(progress, resultFor(stage, stage.thresholds.minDelivered, stage.thresholds.minSatisfied))
}, createInitialShiftProgression())

describe('production shift progression', () => {
  it('unlocks tutorial, beginner, story, then survival in that order', () => {
    let progress = createInitialShiftProgression()
    expect(nextAuthoredStage(progress)).toBe('tutorial')
    for (const [id, next] of [['tutorial', 'beginner'], ['beginner', 'story'], ['story', null]] as const) {
      const stage = AUTHORED_STAGES[id]
      progress = recordShiftResult(progress, resultFor(stage, stage.thresholds.minDelivered, stage.thresholds.minSatisfied))
      expect(nextAuthoredStage(progress)).toBe(next)
      expect(progress.survivalUnlocked).toBe(id === 'story')
    }
    expect(progress.completedAuthoredStages).toEqual(['tutorial', 'beginner', 'story'])
  })

  it.each(['tutorial', 'beginner', 'story'] as const)('%s keeps the stage locked when any authoritative threshold fails', (id: AuthoredStageId) => {
    const stage = AUTHORED_STAGES[id]
    const stageIndex = ['tutorial', 'beginner', 'story'].indexOf(id)
    const base = { ...completedStory(), completedAuthoredStages: (['tutorial', 'beginner', 'story'] as const).slice(0, stageIndex), survivalUnlocked: false, results: [] }
    const lowDelivery = resultFor(stage, stage.thresholds.minDelivered - 1, stage.thresholds.minSatisfied)
    const lowSatisfaction = resultFor(stage, stage.thresholds.minDelivered, stage.thresholds.minSatisfied - 1)
    const tooManyLeft = resultFor(stage, stage.customers.length - stage.thresholds.maxLeft - 1, stage.thresholds.minSatisfied)
    expect(lowDelivery.failureReasons).toContain('deliveries')
    expect(lowSatisfaction.failureReasons).toContain('satisfaction')
    expect(tooManyLeft.failureReasons).toContain('departures')
    for (const result of [lowDelivery, lowSatisfaction, tooManyLeft]) {
      expect(result.passed).toBe(false)
      const failed = recordShiftResult(base, result)
      expect(nextAuthoredStage(failed)).toBe(id)
      expect(failed.survivalUnlocked).toBe(false)
      expect(AUTHORED_STAGES[nextAuthoredStage(failed)!].seed).toBe(stage.seed)
    }
  })

  it('does not skip locked stages or count a settlement twice', () => {
    const initial = createInitialShiftProgression()
    const outOfOrder = recordShiftResult(initial, resultFor(AUTHORED_STAGES.story, 7, 7))
    expect(nextAuthoredStage(outOfOrder)).toBe('tutorial')
    expect(outOfOrder.survivalUnlocked).toBe(false)
    const result = resultFor(AUTHORED_STAGES.tutorial, 4, 3)
    const first = recordShiftResult(initial, result)
    expect(recordShiftResult(first, result)).toBe(first)
  })

  it('mints a survival seed only when a new unlocked run starts', () => {
    const seed = vi.fn().mockReturnValueOnce('first-run').mockReturnValueOnce('second-run')
    expect(beginSurvivalRun(createInitialShiftProgression(), seed).survivalRun).toBeNull()
    expect(seed).not.toHaveBeenCalled()
    const first = beginSurvivalRun(completedStory(), seed)
    expect(first.survivalRun).toEqual({ seed: 'first-run', nextDay: 1, satisfied: 0 })
    expect(beginSurvivalRun(first, seed)).toBe(first)
    expect(seed).toHaveBeenCalledTimes(1)
    expect(survivalStageFor(first)).toEqual(generateSurvivalStage(1, 'first-run'))
    const ended = recordShiftResult(first, resultFor(survivalStageFor(first)!, 0, 0, 'survival:first-run:day:1'))
    const second = beginSurvivalRun(ended, seed)
    expect(second.survivalRun?.seed).toBe('second-run')
  })

  it('advances passed survival days and ends a failed run while keeping records and collections', () => {
    let progress = beginSurvivalRun(completedStory(), () => 'stable-root')
    progress = { ...progress, unlockedCosmeticIds: ['paper-flower'] }
    for (let day = 1; day <= 2; day += 1) {
      const stage = survivalStageFor(progress)!
      const result = resultFor(stage, stage.customers.length - 1, 4, `survival:stable-root:day:${day}`)
      expect(result.passed).toBe(true)
      progress = recordShiftResult(progress, result)
      expect(progress.survivalRun?.nextDay).toBe(day + 1)
      expect(progress.survivalRun?.seed).toBe('stable-root')
    }
    const failed = resultFor(survivalStageFor(progress)!, 3, 1, 'survival:stable-root:day:3')
    const ended = recordShiftResult(progress, failed)
    expect(ended.survivalRun).toBeNull()
    expect(ended.highestSurvivalDay).toBe(3)
    expect(ended.cumulativeSatisfied).toBe(9)
    expect(ended.unlockedCosmeticIds).toEqual(expect.arrayContaining(['paper-flower']))
    expect(ended.results.at(-1)).toEqual(failed)
    expect(recordShiftResult(ended, failed)).toBe(ended)
  })

  it('does not let a delayed old survival settlement close a new run at the same day', () => {
    const progress = beginSurvivalRun(completedStory(), () => 'new-root')
    const old = resultFor(generateSurvivalStage(1, 'old-root'), 0, 0, 'survival:old-root:day:1')
    expect(recordShiftResult(progress, old).survivalRun).toEqual(progress.survivalRun)
  })

  it('unlocks four cosmetic milestones from survival records, keeps them after failure, and deduplicates rewards', () => {
    const day = (number: number, score: number) => ({ ...resultFor(generateSurvivalStage(number, 'rewards'), 0, 0, `reward-day-${number}`), averageScore: score })
    const first = recordShiftResult(completedStory(), day(1, 70))
    expect(first.unlockedCosmeticIds).toEqual(['paper-cotton'])
    const quality = recordShiftResult(first, day(2, 85))
    expect(quality.unlockedCosmeticIds).toEqual(['paper-cotton', 'ribbon-rose'])
    const third = recordShiftResult(quality, day(3, 50))
    expect(third.unlockedCosmeticIds).toEqual(['paper-cotton', 'ribbon-rose', 'book-botanical'])
    const fifth = recordShiftResult(third, day(5, 0))
    expect(fifth.unlockedCosmeticIds).toEqual(['paper-cotton', 'ribbon-rose', 'book-botanical', 'note-chino'])
    expect(recordShiftResult(fifth, day(5, 0))).toBe(fifth)
    expect(recordShiftResult(fifth, resultFor(AUTHORED_STAGES.tutorial, 0, 0, 'failed-again')).unlockedCosmeticIds).toEqual(fifth.unlockedCosmeticIds)
  })

  it('keeps the longest within-day quality streak across survival settlements without adding or double-counting it', () => {
    const initial = completedStory()
    expect(initial.longestQualityStreak).toBe(0)
    const first = { ...resultFor(generateSurvivalStage(1, 'streak'), 6, 5, 'streak-day-1'), longestQualityStreak: 4 }
    const next = recordShiftResult(initial, first)
    expect(next.longestQualityStreak).toBe(4)
    expect(recordShiftResult(next, first)).toBe(next)
    const second = { ...resultFor(generateSurvivalStage(2, 'streak'), 6, 5, 'streak-day-2'), longestQualityStreak: 3 }
    expect(recordShiftResult(next, second).longestQualityStreak).toBe(4)
    const third = { ...resultFor(generateSurvivalStage(3, 'streak'), 7, 6, 'streak-day-3'), longestQualityStreak: 6 }
    expect(recordShiftResult(next, third).longestQualityStreak).toBe(6)
  })
})
