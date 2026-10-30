import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { SFX_TRACKS, type BgmId, type SfxId } from '../content/audio'
import { createGameAudio, DEFAULT_AUDIO_PREFERENCES, type AudioPreferences } from '../infrastructure/game-audio'

export type AudioContextValue = Readonly<{
  preferences: AudioPreferences
  playSfx: (id: SfxId) => void
  setMusic: (id: BgmId | null) => void
  setLoop: (id: SfxId | null) => void
  stopEffects: () => void
  setPreferences: (patch: Partial<AudioPreferences>) => void
  acquireDuck: () => () => void
}>
const noop = () => {}
const silent: AudioContextValue = {
  preferences: DEFAULT_AUDIO_PREFERENCES,
  playSfx: noop, setMusic: noop, setLoop: noop, stopEffects: noop, setPreferences: noop,
  acquireDuck: () => noop,
}
const AudioContext = createContext<AudioContextValue>(silent)

export function AudioProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [audio] = useState(() => createGameAudio())
  const preferences = useSyncExternalStore(audio.subscribe, () => audio.preferences, () => DEFAULT_AUDIO_PREFERENCES)
  useEffect(() => {
    const unlock = () => audio.unlock()
    const visibility = () => audio.setHidden(document.visibilityState === 'hidden')
    const click = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-audio-controls]')) return
      const button = target.closest('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]')
      if (!button || button.matches(':disabled, [aria-disabled="true"]') || button.closest('[inert]')) return
      const sound = target.closest('[data-sound]')?.getAttribute('data-sound')
      if (sound === 'off' || sound === 'none') return
      if (sound && Object.hasOwn(SFX_TRACKS, sound)) audio.playSfx(sound as SfxId)
      else audio.playSfx('ui_click')
    }
    // Capture unlock happens before React action handlers, including keyboard-generated clicks.
    document.addEventListener('pointerdown', unlock, true)
    document.addEventListener('keydown', unlock, true)
    document.addEventListener('click', unlock, true)
    document.addEventListener('click', click)
    document.addEventListener('visibilitychange', visibility)
    visibility()
    return () => {
      document.removeEventListener('pointerdown', unlock, true)
      document.removeEventListener('keydown', unlock, true)
      document.removeEventListener('click', unlock, true)
      document.removeEventListener('click', click)
      document.removeEventListener('visibilitychange', visibility)
      audio.dispose()
    }
  }, [audio])
  const value = useMemo<AudioContextValue>(() => ({
    preferences, playSfx: audio.playSfx, setMusic: audio.setMusic, setLoop: audio.setLoop,
    stopEffects: audio.stopEffects, setPreferences: audio.setPreferences, acquireDuck: audio.acquireDuck,
  }), [audio, preferences])
  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>
}

/** Isolated screen previews and existing component tests remain silent without a provider. */
export function useAudio() { return useContext(AudioContext) }

export function useSceneMusic(id: BgmId | null) {
  const { setMusic } = useAudio()
  // The next scene owns selection; clearing during cleanup would interrupt its crossfade.
  useEffect(() => { setMusic(id) }, [id, setMusic])
}

export function useAudioDuck(active: boolean) {
  const { acquireDuck } = useAudio()
  useEffect(() => active ? acquireDuck() : undefined, [active, acquireDuck])
}
