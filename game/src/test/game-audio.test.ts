import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BGM_TRACKS, SFX_TRACKS, type BgmId } from '../content/audio'
import { AUDIO_PREFERENCES_KEY, createGameAudio } from '../infrastructure/game-audio'
import { AudioProvider, useAudio, useSceneMusic } from '../app/AudioProvider'

function audioBrowser() {
  const nodes: HTMLAudioElement[] = []
  const createAudio = (src: string) => {
    const node = {
      src, currentTime: 0, volume: 1, loop: false, preload: '', paused: true,
      onended: null, onerror: null,
      play: vi.fn(function (this: { paused: boolean }) { this.paused = false; return Promise.resolve() }),
      pause: vi.fn(function (this: { paused: boolean }) { this.paused = true }),
      removeAttribute: vi.fn(), load: vi.fn(),
    } as unknown as HTMLAudioElement
    nodes.push(node)
    return node
  }
  return { nodes, createAudio }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('optional game audio', () => {
  it('loads on the first gesture, keeps the same song, and crossfades a new scene', () => {
    vi.useFakeTimers()
    const browser = audioBrowser(), audio = createGameAudio({ ...browser, storage: null })
    audio.setMusic('title')
    audio.playSfx('ui_click')
    expect(browser.nodes).toHaveLength(0)
    audio.unlock()
    expect(browser.nodes).toHaveLength(1)
    const title = browser.nodes[0]
    audio.setMusic('title')
    audio.unlock()
    expect(title.play).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(650)
    audio.setMusic('dialogue')
    const dialogue = browser.nodes[1]
    expect(title.paused).toBe(false)
    expect(dialogue.volume).toBe(0)
    vi.advanceTimersByTime(650)
    expect(title.paused).toBe(true)
    expect(dialogue.volume).toBeGreaterThan(0)
    audio.dispose()
  })

  it('migrates only legacy effects mute and persists clamped preferences', () => {
    localStorage.setItem('rabbit-house:sound-muted', 'true')
    const audio = createGameAudio()
    expect(audio.preferences).toMatchObject({ muted: false, effectsVolume: 0 })
    expect(audio.preferences.musicVolume).toBeGreaterThan(0)
    audio.setPreferences({ musicVolume: 2, effectsVolume: -1, muted: true })
    expect(JSON.parse(localStorage.getItem(AUDIO_PREFERENCES_KEY)!)).toEqual({ muted: true, musicVolume: 1, effectsVolume: 0 })
    expect(createGameAudio().preferences).toEqual(audio.preferences)
    audio.dispose()
  })

  it('pauses hidden pages and resumes music and one loop without replaying short effects', () => {
    const browser = audioBrowser(), audio = createGameAudio({ ...browser, storage: null })
    audio.setMusic('title'); audio.setLoop('printer_loop'); audio.unlock(); audio.playSfx('ui_click')
    expect(browser.nodes).toHaveLength(3)
    const [music, loop, effect] = browser.nodes
    audio.setHidden(true)
    expect(browser.nodes.every(node => node.paused)).toBe(true)
    audio.playSfx('paper_pick')
    audio.setHidden(false)
    expect(music.play).toHaveBeenCalledTimes(2)
    expect(loop.play).toHaveBeenCalledTimes(2)
    expect(effect.play).toHaveBeenCalledOnce()
    expect(browser.nodes).toHaveLength(3)
    audio.dispose()
  })

  it('bounds effects, throttles repeats, and keeps the printer loop independent of short effects', () => {
    const browser = audioBrowser(), audio = createGameAudio({ ...browser, storage: null })
    audio.unlock(); audio.setLoop('printer_loop'); audio.setLoop('printer_loop')
    expect(browser.nodes).toHaveLength(1)
    audio.playSfx('ui_click'); audio.playSfx('ui_click')
    expect(browser.nodes).toHaveLength(2)
    for (const id of ['paper_pick', 'stamp_press', 'book_page', 'delivery_good'] as const) audio.playSfx(id)
    expect(browser.nodes.filter(node => !node.loop && !node.paused)).toHaveLength(4)
    audio.stopEffects()
    expect(browser.nodes.filter(node => !node.loop).every(node => node.paused)).toBe(true)
    expect(browser.nodes[0].paused).toBe(false)
    audio.setLoop(null)
    expect(browser.nodes[0].paused).toBe(true)
    audio.dispose()
  })

  it('keeps music ducked until every independent lease is released', () => {
    vi.useFakeTimers()
    const browser = audioBrowser(), audio = createGameAudio({ ...browser, storage: null })
    audio.setMusic('title'); audio.unlock(); vi.advanceTimersByTime(650)
    const volume = browser.nodes[0].volume
    const releaseTutorial = audio.acquireDuck(), releaseChatter = audio.acquireDuck()
    expect(browser.nodes[0].volume).toBeLessThan(volume)
    releaseTutorial(); releaseTutorial()
    expect(browser.nodes[0].volume).toBeLessThan(volume)
    releaseChatter()
    expect(browser.nodes[0].volume).toBe(volume)
    audio.dispose()
  })

  it('contains rejected play promises and tries the declared music fallback once', async () => {
    const browser = audioBrowser()
    const createAudio = (src: string) => {
      const node = browser.createAudio(src)
      vi.mocked(node.play).mockRejectedValue(new Error('codec unavailable'))
      return node
    }
    const audio = createGameAudio({ createAudio, storage: null })
    audio.setMusic('title'); audio.unlock()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(browser.nodes[0].src).toBe(BGM_TRACKS.title.fallbackSrc)
    expect(browser.nodes[0].play).toHaveBeenCalledTimes(2)
    audio.playSfx('ui_click')
    await Promise.resolve(); await Promise.resolve()
    audio.dispose()
  })

  it('plays one delegated button cue, honors replacements, and excludes audio controls', () => {
    const browser = audioBrowser()
    vi.stubGlobal('Audio', vi.fn(function (src: string) { return browser.createAudio(src) }))
    const readPreference = () => { const audio = useAudio(); return createElement('span', null, String(audio.preferences.muted)) }
    const view = render(createElement(AudioProvider, null,
      createElement('button', null, '普通按钮'),
      createElement('button', { 'data-sound': 'paper_pick' }, '拿纸'),
      createElement('button', { 'data-sound': 'off' }, '安静按钮'),
      createElement('button', { disabled: true }, '禁用按钮'),
      createElement('div', { 'data-audio-controls': true }, createElement('button', null, '音量按钮')),
    ))
    fireEvent.keyDown(document.body, { key: 'Enter' })
    fireEvent.click(screen.getByText('普通按钮'), { detail: 0 })
    fireEvent.click(screen.getByText('拿纸'))
    fireEvent.click(screen.getByText('安静按钮'))
    fireEvent.click(screen.getByText('禁用按钮'))
    fireEvent.click(screen.getByText('音量按钮'))
    expect(browser.nodes.map(node => node.src)).toEqual([SFX_TRACKS.ui_click.src, SFX_TRACKS.paper_pick.src])
    view.unmount()
    render(createElement(readPreference))
    expect(screen.getByText('false')).toBeInTheDocument()
  })

  it('keeps scene music crossfading through hook updates and preserves the same song across remounts', () => {
    vi.useFakeTimers()
    const browser = audioBrowser()
    vi.stubGlobal('Audio', vi.fn(function (src: string) { return browser.createAudio(src) }))
    function Scene({ id }: { id: BgmId }) { useSceneMusic(id); return null }
    const show = (id: BgmId, key: string) => createElement(AudioProvider, null, createElement(Scene, { id, key }))
    const view = render(show('title', 'first'))
    fireEvent.pointerDown(document.body)
    vi.advanceTimersByTime(650)
    const title = browser.nodes[0]
    view.rerender(show('dialogue', 'first'))
    expect(title.paused).toBe(false)
    vi.advanceTimersByTime(650)
    expect(title.paused).toBe(true)
    view.rerender(show('dialogue', 'another-scene'))
    expect(browser.nodes).toHaveLength(2)
    expect(browser.nodes[1].play).toHaveBeenCalledOnce()
    view.unmount()
  })
})
