import type { ShiftProgression } from '../domain/shift-types'

/** Appearance only: these rewards never change orders, inventory, timing or scores. */
export const SURVIVAL_REWARDS = [
  { id: 'paper-cotton', label: '棉絮纸纹', milestone: '完成第 1 日营业结算', metric: 'highestSurvivalDay', target: 1,
    description: '工坊卡纸铺上细细的棉絮纹理。' },
  { id: 'ribbon-rose', label: '玫瑰缎带', milestone: '单日平均品质达到 85 分', metric: 'highestDailyScore', target: 85,
    description: '工坊里的缎带换上玫瑰色，用法与原来相同。' },
  { id: 'book-botanical', label: '花叶卡册', milestone: '营业到第 3 日并结算', metric: 'highestSurvivalDay', target: 3,
    description: '收藏页添上花叶色的衬纸。' },
  { id: 'note-chino', label: '智乃的小纸条', milestone: '营业到第 5 日并结算', metric: 'highestSurvivalDay', target: 5,
    description: '智乃把一段鼓励悄悄夹进了卡册。' },
] as const

/** Also adopts milestones reached by saves created before cosmetic rewards existed. */
export function unlockSurvivalCosmetics(progress: ShiftProgression): ShiftProgression {
  const earned = SURVIVAL_REWARDS.filter(reward => progress[reward.metric] >= reward.target).map(reward => reward.id)
  const unlockedCosmeticIds = [...new Set([...progress.unlockedCosmeticIds, ...earned])]
  return unlockedCosmeticIds.length === progress.unlockedCosmeticIds.length ? progress : { ...progress, unlockedCosmeticIds }
}

export function cosmeticClasses(progress: ShiftProgression): string {
  return SURVIVAL_REWARDS.filter(reward => progress.unlockedCosmeticIds.includes(reward.id)).map(reward => `cosmetic-${reward.id}`).join(' ')
}
