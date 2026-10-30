import { COMMISSION_ORDER } from '../content/commissions'
import { generateSurvivalStage } from '../content/production'
import { unlockSurvivalCosmetics } from '../content/survival-rewards'
import type { AuthoredStageId, ShiftProgression, ShiftResult } from '../domain/shift-types'
import type { CommissionId, ProgressState } from '../domain/types'

export const AUTHORED_STAGE_ORDER: readonly AuthoredStageId[] = ['tutorial', 'beginner', 'story']

export function createInitialShiftProgression(): ShiftProgression {
  return { version: 1, completedAuthoredStages: [], survivalUnlocked: false, survivalRun: null,
    highestSurvivalDay: 0, cumulativeSatisfied: 0, highestDailyScore: 0, longestQualityStreak: 0,
    unlockedCosmeticIds: [], results: [] }
}

export function nextAuthoredStage(progress: ShiftProgression): AuthoredStageId | null {
  return AUTHORED_STAGE_ORDER.find(id => !progress.completedAuthoredStages.includes(id)) ?? null
}

/** Only the settled engine result decides success. Collection storage is independent. */
export function recordShiftResult(progress: ShiftProgression, result: ShiftResult): ShiftProgression {
  if (progress.results.some(previous => previous.shiftRunId === result.shiftRunId)) return progress
  const completedAuthoredStages = [...progress.completedAuthoredStages]
  if (result.passed && result.stageId === nextAuthoredStage(progress)) completedAuthoredStages.push(result.stageId as AuthoredStageId)
  const survival = result.stageId.startsWith('survival:')
  const activeDay = survival && progress.survivalRun !== null && result.day === progress.survivalRun.nextDay
    && result.shiftRunId === `survival:${progress.survivalRun.seed}:day:${progress.survivalRun.nextDay}`
  return unlockSurvivalCosmetics({ ...progress, completedAuthoredStages,
    survivalUnlocked: AUTHORED_STAGE_ORDER.every(id => completedAuthoredStages.includes(id)),
    results: [...progress.results, result],
    survivalRun: activeDay ? (result.passed ? { ...progress.survivalRun!, nextDay: result.day + 1,
      satisfied: progress.survivalRun!.satisfied + result.satisfied } : null) : progress.survivalRun,
    highestSurvivalDay: survival ? Math.max(progress.highestSurvivalDay, result.day) : progress.highestSurvivalDay,
    cumulativeSatisfied: progress.cumulativeSatisfied + (survival ? result.satisfied : 0),
    highestDailyScore: survival ? Math.max(progress.highestDailyScore, result.averageScore) : progress.highestDailyScore,
    // A streak belongs to one settled day; keep the best day, never concatenate days.
    longestQualityStreak: survival ? Math.max(progress.longestQualityStreak, result.longestQualityStreak) : progress.longestQualityStreak,
  })
}

/** The caller mints randomness only here, when the player starts a fresh run. */
export function beginSurvivalRun(progress: ShiftProgression, createSeed: () => string): ShiftProgression {
  if (!progress.survivalUnlocked || progress.survivalRun !== null) return progress
  return { ...progress, survivalRun: { seed: createSeed(), nextDay: 1, satisfied: 0 } }
}

export function survivalStageFor(progress: ShiftProgression) {
  return progress.survivalRun === null ? null : generateSurvivalStage(progress.survivalRun.nextDay, progress.survivalRun.seed)
}

// Legacy workshop sessions still deserialize these exports; they do not unlock production shifts.
export function createInitialProgress(): ProgressState {
  return {
    mode: 'story',
    tutorialCompleted: false,
    currentCommissionId: 'chino',
    completedCommissionIds: [],
    unlockedAssetIds: [],
    freeModeUnlocked: false,
    dialogueNodeId: 'chino-intro',
    readNodeIds: [],
  }
}

const REWARD_ASSETS: Record<CommissionId, readonly string[]> = {
  chino: ['coffee-bean', 'sugar', 'tippy'],
  rize: ['ribbon', 'star'],
  'chiya-sharo': ['flower', 'pink-paper'],
}

export function completeCommission(
  progress: ProgressState,
  commissionId: CommissionId,
  passed: boolean,
): ProgressState {
  if (!passed) return progress

  const completed = progress.completedCommissionIds.includes(commissionId)
    ? [...progress.completedCommissionIds]
    : [...progress.completedCommissionIds, commissionId]
  const currentIndex = COMMISSION_ORDER.indexOf(commissionId)
  const nextCommissionId = COMMISSION_ORDER[currentIndex + 1]
  const allComplete = COMMISSION_ORDER.every((id) => completed.includes(id))

  return {
    ...progress,
    completedCommissionIds: completed,
    currentCommissionId: nextCommissionId ?? commissionId,
    unlockedAssetIds: [
      ...new Set([...progress.unlockedAssetIds, ...REWARD_ASSETS[commissionId]]),
    ],
    freeModeUnlocked: allComplete,
    tutorialCompleted: true,
    dialogueNodeId: allComplete ? 'ensemble-ending' : `${nextCommissionId ?? commissionId}-intro`,
  }
}

export function firstAvailableCommission(progress: ProgressState): CommissionId {
  return (
    COMMISSION_ORDER.find((id) => !progress.completedCommissionIds.includes(id)) ??
    'chiya-sharo'
  )
}
