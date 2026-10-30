import { useState } from 'react'
import { SurvivalRewards } from '../components/SurvivalRewards'
import { OPERATIONAL_COPY, selectStoryEnding, STORY_STAGES } from '../content/story'
import type { ShiftProgression, ShiftResult as SettledResult, StageDefinition } from '../domain/shift-types'
import { useAudioDuck } from '../app/AudioProvider'

const failureCopy: Record<SettledResult['failureReasons'][number], string> = {
  deliveries: '送到客人手里的卡片还不够，下次给冲印和交付多留一点时间。',
  satisfaction: '满意的客人还不够，先核对必需图案、卡纸与工艺。',
  departures: '离店的客人太多，留意门口等待和最后等待的沙漏。',
  'corrupt-save': '这班营业记录没能完整保留，已收入卡册的作品仍在。',
}

export function ShiftResult({ result, stage, progress, ready, finalizing = false, error, actionError, onRetrySave, onRetry, onNext, onTitle }: Readonly<{
  result: SettledResult; stage: StageDefinition; progress: ShiftProgression; ready: boolean; error: string | null
  finalizing?: boolean; actionError?: string | null
  onRetrySave: () => void; onRetry: () => void; onNext: () => void; onTitle: () => void
}>) {
  const [lineIndex, setLineIndex] = useState(0)
  const ending = stage.kind === 'authored' ? STORY_STAGES[stage.id].endings[selectStoryEnding(result)] : null
  const line = ending?.[Math.min(lineIndex, ending.length - 1)]
  useAudioDuck(Boolean(line) && !finalizing)
  const thresholds = stage.thresholds
  const deliveryTarget = thresholds.kind === 'authored' ? thresholds.minDelivered : Math.ceil(stage.customers.length * thresholds.minDeliveredRatio)
  const satisfactionTarget = thresholds.kind === 'authored' ? thresholds.minSatisfied : Math.floor(result.delivered * thresholds.satisfiedRatioExclusive) + 1
  return <main className="shift-result-screen">
    <section className="shift-result-card">
      <span className="eyebrow">{stage.kind === 'survival' ? `生存营业 · 第 ${result.day} 日` : stage.label}</span>
      <h1>{finalizing ? '正在核对今天的营业' : result.passed ? '今天也辛苦了' : '今天先歇一歇'}</h1>
      <p>{!finalizing && (result.passed ? '本班达到营业目标。' : '这一班还没有达到营业目标。')}已收入卡册的作品会一直保留。</p>
      <dl className="shift-result-numbers"><div><dt>亲手交付</dt><dd>{result.delivered} / {stage.customers.length}</dd><small>至少 {deliveryTarget} 张</small></div>
        <div><dt>满意客人</dt><dd>{result.satisfied} 位</dd><small>至少 {satisfactionTarget} 位</small></div>
        <div><dt>离店客人</dt><dd>{result.left} 位</dd><small>不超过 {thresholds.maxLeft} 位</small></div>
        <div><dt>平均品质</dt><dd>{Math.round(result.averageScore)} 分</dd></div></dl>
      {result.failureReasons.length > 0 && <ul className="shift-result-advice">{result.failureReasons.map(reason => <li key={reason}>{failureCopy[reason]}</li>)}</ul>}
      {!finalizing && (line ? <section className="shift-ending-dialogue" aria-label="打烊后的话" aria-live="polite"><strong>{line.speaker}</strong><p>{line.text}</p>
        {lineIndex < ending!.length - 1 && <button className="ghost-button" data-sound="dialogue_next" onClick={() => setLineIndex(lineIndex + 1)}>下一句</button>}</section>
        : <p>{OPERATIONAL_COPY.survival[result.passed ? 'dayCleared' : 'runEnded'][0]}</p>)}
      {stage.kind === 'survival' && <p>最高营业日：第 {Math.max(progress.highestSurvivalDay, result.day)} 日 · 累计满意客人：{progress.cumulativeSatisfied} 位</p>}
      {stage.kind === 'survival' && <p>单日最高分：{Math.round(progress.highestDailyScore)} 分</p>}
      {stage.kind === 'survival' && ready && <SurvivalRewards progress={progress} />}
      {stage.kind === 'survival' && <p>本日最长连续优质交付：{result.longestQualityStreak} 张 · 历史最佳：{progress.longestQualityStreak} 张（同日连续满意且达到 A 或 S）</p>}
      {stage.id === 'story' && ready && result.passed && <p>生存天梯已经开放。明天还会有新的客人推开店门。</p>}
      {error && <div role="alert"><p>{error}</p><button className="secondary-button" onClick={onRetrySave}>再记一次成绩</button></div>}
      {actionError && <p role="alert">{actionError}</p>}
      {finalizing ? <p role="status">正在核对最后一张冲印单，确认后再记入营业簿……</p>
        : !ready && !error && <p role="status">正在把今天的成绩记进营业簿……</p>}
      <div className="shift-result-actions">
        {!result.passed && <button className="primary-button" disabled={!ready} onClick={onRetry}>{stage.kind === 'survival' ? '开始新一轮营业' : '再试这一班'}</button>}
        {result.passed && <button className="primary-button" disabled={!ready} onClick={onNext}>{stage.kind === 'survival' ? '迎接下一营业日' : stage.id === 'story' ? '挑战生存天梯' : '准备下一班'}</button>}
        <button className="secondary-button" disabled={!ready} onClick={onTitle}>回到店门</button>
      </div>
    </section>
  </main>
}
