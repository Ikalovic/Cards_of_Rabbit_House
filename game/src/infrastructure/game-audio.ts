import { BGM_TRACKS, SFX_TRACKS, type AudioTrackDefinition, type BgmId, type SfxId } from '../content/audio'

export type AudioPreferences = Readonly<{ muted: boolean; musicVolume: number; effectsVolume: number }>
export const AUDIO_PREFERENCES_KEY = 'rabbit-house:audio-preferences'
export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = { muted: false, musicVolume: 0.32, effectsVolume: 0.75 }
const FADE_MS = 600
const MAX_EFFECTS = 4
type AudioStorage = Pick<Storage, 'getItem' | 'setItem'>
type Options = {
  createAudio?: (src: string) => HTMLAudioElement
  storage?: AudioStorage | null
  now?: () => number
}
type Slot = {
  node: HTMLAudioElement
  definition: AudioTrackDefinition
  kind: 'music' | 'loop' | 'effect'
  gain: number
  playing: boolean
  active: boolean
  usedFallback: boolean
  fade?: { from: number; to: number; at: number }
}

function browserStorage(): AudioStorage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}
function level(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
}
function readPreferences(storage: AudioStorage | null): AudioPreferences {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(AUDIO_PREFERENCES_KEY) ?? 'null')
    if (saved && typeof saved === 'object') {
      const value = saved as Partial<AudioPreferences>
      return {
        muted: typeof value.muted === 'boolean' ? value.muted : false,
        musicVolume: level(value.musicVolume, DEFAULT_AUDIO_PREFERENCES.musicVolume),
        effectsVolume: level(value.effectsVolume, DEFAULT_AUDIO_PREFERENCES.effectsVolume),
      }
    }
  } catch { /* Damaged or unavailable preferences use the defaults. */ }
  try {
    if (storage?.getItem('rabbit-house:sound-muted') === 'true') {
      return { ...DEFAULT_AUDIO_PREFERENCES, effectsVolume: 0 }
    }
  } catch { /* Storage is optional. */ }
  return { ...DEFAULT_AUDIO_PREFERENCES }
}

/** Media is created only after a gesture. Short cues are dropped, never queued. */
export function createGameAudio(options: Options = {}) {
  const storage = options.storage === undefined ? browserStorage() : options.storage
  const createAudio = options.createAudio ?? (src => new Audio(src))
  const now = options.now ?? Date.now
  let preferences = readPreferences(storage)
  let unlocked = false, hidden = false
  let desiredMusic: BgmId | null = null, desiredLoop: SfxId | null = null
  let music: Slot | undefined, loop: Slot | undefined
  let fadeTimer: ReturnType<typeof setInterval> | undefined
  const musicSlots = new Set<Slot>(), effects = new Set<Slot>()
  const lastPlayed = new Map<SfxId, number>(), ducks = new Set<symbol>()
  const listeners = new Set<() => void>()
  const canPlay = () => unlocked && !hidden && !preferences.muted

  function volume(slot: Slot) {
    const bus = slot.kind === 'music' ? preferences.musicVolume : preferences.effectsVolume
    const duck = slot.kind === 'music' && ducks.size > 0 ? 0.35 : 1
    try { slot.node.volume = level(bus * slot.definition.volume * slot.gain * duck, 0) } catch { /* Unavailable device. */ }
  }
  function pause(slot: Slot) {
    slot.playing = false
    try { slot.node.pause() } catch { /* Optional media must not interrupt an action. */ }
  }
  function stop(slot: Slot) {
    slot.active = false
    pause(slot)
    slot.node.onended = null
    slot.node.onerror = null
    effects.delete(slot)
    musicSlots.delete(slot)
    try { slot.node.removeAttribute('src'); slot.node.load() } catch { /* Release media when supported. */ }
  }
  function failure(slot: Slot, error?: unknown) {
    if (!slot.active) return
    slot.playing = false
    // Autoplay denial is retried on the next gesture, rather than requesting another format.
    const denied = error && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError'
    if (canPlay() && !denied && !slot.usedFallback && slot.definition.fallbackSrc) {
      slot.usedFallback = true
      try { slot.node.src = slot.definition.fallbackSrc; play(slot) } catch { /* No usable format. */ }
    } else if (slot.kind === 'effect') stop(slot)
  }
  function play(slot: Slot) {
    if (!slot.active || slot.playing || !canPlay()) return
    volume(slot)
    slot.playing = true
    try {
      const pending = slot.node.play()
      void Promise.resolve(pending).catch(error => { failure(slot, error) })
    } catch (error) { failure(slot, error) }
  }
  function make(definition: AudioTrackDefinition, kind: Slot['kind'], gain: number): Slot | undefined {
    try {
      const node = createAudio(definition.src)
      node.preload = 'none'
      node.loop = kind !== 'effect'
      const slot: Slot = { node, definition, kind, gain, playing: false, active: true, usedFallback: false }
      node.onerror = () => failure(slot)
      node.onended = kind === 'effect' ? () => stop(slot) : null
      volume(slot)
      return slot
    } catch { return undefined }
  }
  function stopEffects() {
    for (const slot of [...effects]) stop(slot)
  }
  function clearFadeTimer() {
    if (fadeTimer !== undefined) clearInterval(fadeTimer)
    fadeTimer = undefined
  }
  function tickFades() {
    let fading = false
    for (const slot of [...musicSlots]) {
      if (!slot.fade) continue
      const progress = Math.min(1, Math.max(0, (now() - slot.fade.at) / FADE_MS))
      slot.gain = slot.fade.from + (slot.fade.to - slot.fade.from) * progress
      volume(slot)
      if (progress < 1) fading = true
      else {
        const target = slot.fade.to
        slot.fade = undefined
        if (target === 0) stop(slot)
      }
    }
    if (!fading) clearFadeTimer()
  }
  function fade(slot: Slot, to: number) {
    slot.fade = { from: slot.gain, to, at: now() }
    if (fadeTimer === undefined) fadeTimer = setInterval(tickFades, 40)
  }
  function sync() {
    if (!canPlay()) {
      for (const slot of musicSlots) pause(slot)
      if (loop) pause(loop)
      stopEffects()
      return
    }
    if (preferences.musicVolume > 0) {
      if (desiredMusic && !music) {
        music = make(BGM_TRACKS[desiredMusic], 'music', 0)
        if (music) { musicSlots.add(music); fade(music, 1) }
      }
      for (const slot of musicSlots) play(slot)
    } else for (const slot of musicSlots) pause(slot)
    if (preferences.effectsVolume > 0) {
      if (desiredLoop && !loop) loop = make(SFX_TRACKS[desiredLoop], 'loop', 1)
      if (loop) play(loop)
    } else {
      if (loop) pause(loop)
      stopEffects()
    }
  }

  return {
    get preferences(): AudioPreferences { return preferences },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    unlock() { unlocked = true; sync() },
    setMusic(id: BgmId | null) {
      if (desiredMusic === id) { sync(); return }
      desiredMusic = id
      // Rapid route changes retain at most an outgoing and an incoming song.
      for (const slot of [...musicSlots]) if (slot !== music) stop(slot)
      if (music) {
        if (canPlay() && preferences.musicVolume > 0) fade(music, 0)
        else stop(music)
      }
      music = undefined
      sync()
    },
    setLoop(id: SfxId | null) {
      if (desiredLoop === id) { sync(); return }
      desiredLoop = id
      if (loop) stop(loop)
      loop = undefined
      sync()
    },
    playSfx(id: SfxId) {
      if (!canPlay() || preferences.effectsVolume === 0 || !SFX_TRACKS[id]) return
      // A loop ID passed as a cue still uses the one shared loop channel.
      if (id === 'printer_loop') {
        if (desiredLoop !== id) { desiredLoop = id; if (loop) stop(loop); loop = undefined }
        sync()
        return
      }
      const definition: AudioTrackDefinition = SFX_TRACKS[id]
      const previous = lastPlayed.get(id)
      if (previous !== undefined && now() - previous < (definition.cooldownMs ?? 80)) return
      lastPlayed.set(id, now())
      if (effects.size >= MAX_EFFECTS) {
        const oldest = effects.values().next().value
        if (oldest) stop(oldest)
      }
      const slot = make(definition, 'effect', 1)
      if (slot) { effects.add(slot); play(slot) }
    },
    stopEffects,
    setHidden(value: boolean) {
      if (hidden === value) return
      hidden = value
      if (hidden) {
        clearFadeTimer()
        for (const slot of [...musicSlots]) {
          if (slot !== music) stop(slot)
          else { slot.fade = undefined; slot.gain = 1; volume(slot) }
        }
      }
      sync()
    },
    setPreferences(patch: Partial<AudioPreferences>) {
      preferences = {
        muted: typeof patch.muted === 'boolean' ? patch.muted : preferences.muted,
        musicVolume: level(patch.musicVolume, preferences.musicVolume),
        effectsVolume: level(patch.effectsVolume, preferences.effectsVolume),
      }
      try { storage?.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(preferences)) } catch { /* Session controls still work. */ }
      for (const slot of musicSlots) volume(slot)
      if (loop) volume(loop)
      for (const slot of effects) volume(slot)
      sync()
      for (const listener of listeners) listener()
    },
    acquireDuck() {
      const lease = Symbol('audio-duck')
      ducks.add(lease)
      for (const slot of musicSlots) volume(slot)
      return () => {
        ducks.delete(lease)
        for (const slot of musicSlots) volume(slot)
      }
    },
    dispose() {
      clearFadeTimer()
      for (const slot of [...musicSlots]) stop(slot)
      if (loop) stop(loop)
      stopEffects()
      music = undefined; loop = undefined; unlocked = false
      ducks.clear(); lastPlayed.clear()
    },
  }
}

export type GameAudio = ReturnType<typeof createGameAudio>
