import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createInitialShiftProgression } from '../app/progression'
import { SurvivalRewards } from '../components/SurvivalRewards'
import { AUTHORED_STAGES } from '../content/production'
import { initializeShift } from '../domain/shift-engine'
import { StampBookScreen } from '../screens/StampBookScreen'
import screenStyles from '../styles/screens.css?inline'
import rewardStyles from '../styles/survival-rewards.css?inline'

function rgb(color: string): number[] {
  if (color.startsWith('#')) return [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
  return color.match(/[\d.]+/g)!.map(Number)
}

function contrast(foreground: string, background: string, opacity = 1) {
  const front = rgb(foreground), back = rgb(background), alpha = (front[3] ?? 1) * opacity
  const luminance = (channels: number[]) => channels.slice(0, 3).map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const a = luminance(front.slice(0, 3).map((channel, index) => channel * alpha + back[index] * (1 - alpha)))
  const b = luminance(back)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('survival reward presentation', () => {
  it('keeps earned rewards collapsed until the player opens them', () => {
    const progress = { ...createInitialShiftProgression(), unlockedCosmeticIds: ['paper-cotton', 'note-chino'] }
    const view = render(<SurvivalRewards progress={progress} />)
    const summary = screen.getByText('营业纪念 · 2 / 4 已获得')
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    fireEvent.click(summary)
    expect(details.open).toBe(true)
    expect(screen.getByText('每一张用心做好的卡片，我都有好好看见。明天也一起加油吧。')).toBeVisible()
    view.rerender(<SurvivalRewards progress={{ ...progress, highestDailyScore: 90 }} />)
    expect(details.open).toBe(true)
    fireEvent.click(summary)
    expect(details.open).toBe(false)
  })

  it('keeps botanical collection text readable on the index, both button states and pocket', () => {
    const run = initializeShift(AUTHORED_STAGES.tutorial, 'botanical-preview', 1_000_000)
    const card = { kind: 'production-card' as const, version: 1 as const, id: 'card', shiftRunId: run.id,
      orderId: run.orders[0].id, draftId: 'draft', draftRevision: 1, savedAtMs: 1_000_000,
      design: { version: 1 as const, preparation: { ...run.orders[0].content.requirements, paperId: 'coffee' as const }, elements: [], crafts: [] } }
    const { container } = render(<>
      <style>{`${screenStyles}\n${rewardStyles}`}</style>
      <div className="cosmetic-book-botanical"><StampBookScreen cards={[]} productionCards={[card, { ...card, id: 'card-two' }]}
        onSelect={vi.fn()} onEdit={vi.fn()} onPrint={vi.fn()} onBack={vi.fn()} /></div>
    </>)
    const index = container.querySelector('.book-index')!
    const backgrounds = getComputedStyle(index).backgroundImage.match(/#[\da-f]{6}/gi)!
    expect(backgrounds).toEqual(['#e0ead9', '#fff9eb'])
    const expectReadable = (element: Element, background: string) => {
      const style = getComputedStyle(element)
      expect(contrast(style.color, background, Number(style.opacity || 1)), element.textContent ?? '').toBeGreaterThanOrEqual(4.5)
    }
    for (const text of index.querySelectorAll('h2, .empty-note')) {
      for (const background of backgrounds) expectReadable(text, background)
    }
    for (const button of index.querySelectorAll('.card-index-list button')) {
      const background = getComputedStyle(button).backgroundColor
      expect(rgb(background)[3] ?? 1).toBe(1)
      for (const text of button.querySelectorAll('strong, small')) expectReadable(text, background)
      const thumbnail = button.querySelector('.mini-paper')!
      expectReadable(thumbnail, getComputedStyle(thumbnail).backgroundColor)
    }

  })
})
