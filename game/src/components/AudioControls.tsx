import { useId } from 'react'
import { useAudio } from '../app/AudioProvider'
import '../styles/audio.css'

export function AudioControls() {
  const { preferences, setPreferences } = useAudio()
  const musicId = useId(), effectsId = useId()
  return <details className="audio-controls" data-audio-controls>
    <summary aria-label="声音设置"><span aria-hidden="true">♫</span> 声音</summary>
    <div className="audio-controls__panel" role="group" aria-label="声音设置">
      <div className="audio-controls__heading"><strong>声音设置</strong><button type="button"
        aria-pressed={preferences.muted} onClick={() => setPreferences({ muted: !preferences.muted })}>
        {preferences.muted ? '恢复声音' : '全部静音'}
      </button></div>
      <label htmlFor={musicId}>音乐 <output>{Math.round(preferences.musicVolume * 100)}%</output></label>
      <input id={musicId} type="range" min="0" max="100" step="1" value={Math.round(preferences.musicVolume * 100)}
        onChange={event => setPreferences({ musicVolume: Number(event.target.value) / 100 })} />
      <label htmlFor={effectsId}>音效 <output>{Math.round(preferences.effectsVolume * 100)}%</output></label>
      <input id={effectsId} type="range" min="0" max="100" step="1" value={Math.round(preferences.effectsVolume * 100)}
        onChange={event => setPreferences({ effectsVolume: Number(event.target.value) / 100 })} />
      <small>音效：On-Jin ～音人～ · 効果音ラボ</small>
    </div>
  </details>
}
