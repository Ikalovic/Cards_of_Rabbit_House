import { SURVIVAL_REWARDS } from '../content/survival-rewards'
import type { ShiftProgression } from '../domain/shift-types'
import '../styles/survival-rewards.css'

export function SurvivalRewards({ progress }: Readonly<{ progress: ShiftProgression }>) {
  return <details className="survival-rewards">
    <summary>营业纪念 · {SURVIVAL_REWARDS.filter(reward => progress.unlockedCosmeticIds.includes(reward.id)).length} / 4 已获得</summary>
    <p>生存营业留下的小礼物，会自动装点自由工坊与卡册。即使这班没达标，已经获得的纪念也会保留。</p>
    <ul>{SURVIVAL_REWARDS.map(reward => <li key={reward.id}>
      <strong>{reward.label}</strong><span>{progress.unlockedCosmeticIds.includes(reward.id) ? '已获得 · ' : '待获得 · '}{reward.milestone}</span>
      <small>{reward.description}</small>
    </li>)}</ul>
    {progress.unlockedCosmeticIds.includes('note-chino') && <blockquote><strong>智乃</strong><p>每一张用心做好的卡片，我都有好好看见。明天也一起加油吧。</p></blockquote>}
  </details>
}
