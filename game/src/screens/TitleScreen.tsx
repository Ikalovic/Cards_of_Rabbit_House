import { STORY_STAGES } from '../content/story'
import type { ShiftProgression } from '../domain/shift-types'
import { nextAuthoredStage } from '../app/progression'

type TitleScreenProps = Readonly<{
  progress: ShiftProgression
  hasSave: boolean
  hydrated: boolean
  busy?: boolean
  error?: string | null
  onStartStory: () => void
  onContinue: () => void
  onSurvival: () => void
  onFreeCreate: () => void
}>

export function TitleScreen({ progress, hasSave, hydrated, busy, error, onStartStory, onContinue, onSurvival, onFreeCreate }: TitleScreenProps) {
  const next = nextAuthoredStage(progress)
  return <main className="title-screen">
    <div className="title-screen__shade" />
    <section className="title-card" aria-label="Rabbit House 今日值班">
      <div className="eyebrow">请问您今天要来点兔子吗？ · Fan Game</div>
      <div className="title-mark" aria-hidden="true"><span className="title-mark__ear" /><span className="title-mark__cup">☕</span><span className="title-mark__ear title-mark__ear--right" /></div>
      <h1>Rabbit House 手作值班</h1>
      <p className="title-card__lead">读一张订单，做一张卡片，把心意亲手交给客人。</p>
      <div className="title-menu">
        <button className="menu-button menu-button--primary" aria-label="剧情经营" onClick={onStartStory} disabled={!hydrated || busy}>
          <span>剧情经营</span><small>{next ? STORY_STAGES[next].title : '重温给智乃的秘密纪念册'}</small>
        </button>
        <button className="menu-button" aria-label="继续值班" onClick={onContinue} disabled={!hydrated || !hasSave || busy}>
          <span>继续值班</span><small>{hasSave ? '接着上次的营业，或翻看本班结算' : '还没有留下的营业记录'}</small>
        </button>
        <button className="menu-button" aria-label="生存天梯" onClick={onSurvival} disabled={!hydrated || !progress.survivalUnlocked || busy}>
          <span>生存天梯</span><small>{!progress.survivalUnlocked ? '完成秘密纪念册后开放' : progress.survivalRun ? `接着挑战第 ${progress.survivalRun.nextDay} 日` : '开启新一轮营业，从第 1 日出发'}</small>
        </button>
        <button className="menu-button" aria-label="自由工坊" disabled={busy} onClick={onFreeCreate}>
          <span>自由工坊</span><small>随时做卡、翻阅卡册与冲印，慢慢享受手作</small>
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="title-progress" aria-label="剧情进度">
        <span>{progress.completedAuthoredStages.length} / 3 班达标 · 天梯最高第 {progress.highestSurvivalDay} 日</span>
        <span>单日最高分：{Math.round(progress.highestDailyScore)} 分</span>
        <div className="title-progress__track"><i style={{ width: `${progress.completedAuthoredStages.length / 3 * 100}%` }} /></div>
      </div>
    </section>
    <p className="title-screen__footer">A quiet weekend at Rabbit House</p>
  </main>
}
