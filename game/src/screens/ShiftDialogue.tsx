import { useState } from 'react'
import { PRODUCTION_ASSETS } from '../content/production-assets'
import { STORY_STAGES } from '../content/story'
import { AUTHORED_STAGES } from '../content/production'
import { portraitFor } from '../content/portraits'
import type { AuthoredStageId } from '../domain/shift-types'
import { useAudioDuck } from '../app/AudioProvider'


export function ShiftDialogue({ stageId, seen, busy, error, onComplete, onBack }: Readonly<{
  stageId: AuthoredStageId; seen: boolean; busy?: boolean; error?: string | null; onComplete: () => void; onBack: () => void
}>) {
  const [index, setIndex] = useState(0)
  useAudioDuck(true)
  const story = STORY_STAGES[stageId]
  const line = story.opening[index]
  const background = PRODUCTION_ASSETS.find(asset => asset.id === story.backgroundAssetId)
  const stage = AUTHORED_STAGES[stageId]
  return <main className="shift-story" style={{ backgroundImage: `linear-gradient(90deg, #392e26bb, #392e2633), url('${background?.src}')` }}>
    <header className="shift-route-bar"><button className="ghost-button" disabled={busy} onClick={onBack}>回到店门</button><span>开店之前 · 营业尚未开始</span>
      {seen && <button className="secondary-button" disabled={busy} onClick={onComplete}>跳过已读对白</button>}</header>
    {error && <p className="shift-notice shift-error" role="alert">{error}</p>}
    <section className="shift-story-intro">
      <span className="eyebrow">{story.eyebrow}</span><h1>{story.title}</h1><p>{story.sceneDescription}</p>
      <p>营业十二分钟 · {stage.customers.length} 位客人</p>
      <p>至少交付 {stage.thresholds.minDelivered} 张、{stage.thresholds.minSatisfied} 位满意、离店不超过 {stage.thresholds.maxLeft} 位。</p>
    </section>
    <img className="shift-story-character" key={`${line.speaker}:${line.mood ?? ''}`} src={portraitFor(line.speaker, line.mood)} alt={`${line.speaker}与大家在店里交谈`} />
    <section className="shift-story-dialogue" aria-live="polite">
      <strong>{line.speaker}</strong>{line.mood && <small>{line.mood}</small>}<p>{line.text}</p>
      <div><span>{index + 1} / {story.opening.length}</span>{index < story.opening.length - 1
        ? <button className="primary-button" data-sound="dialogue_next" onClick={() => setIndex(index + 1)}>下一句</button>
        : <button className="primary-button" disabled={busy} onClick={onComplete}>开门营业</button>}</div>
    </section>
  </main>
}
