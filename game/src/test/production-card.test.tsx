import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BORDERS, DECORATIONS, LAYOUTS, MOTIFS, WORD_STAMPS } from '../content/production'
import type { ElementKind, ProductionDesign } from '../domain/shift-types'

type CardProps = { design: ProductionDesign; showSlots?: boolean; selectedSlotId?: string; onSlotSelect?: (id: string) => void; onSlotDrop?: (id: string, asset: { kind: ElementKind; assetId: string }) => void }
const modules = import.meta.glob('../components/ProductionCard.tsx', { eager: true })
const components = modules['../components/ProductionCard.tsx'] as { ProductionCard: ComponentType<CardProps>; AssetArt: ComponentType<{ kind: ElementKind; assetId: string }> } | undefined
const design: ProductionDesign = {
  version: 1,
  preparation: { paperId: 'cream', paperMaterialId: 'smooth', shapeId: 'landscape', orientation: 'landscape', layoutId: 'welcome', surfaceFinishId: 'matte' },
  elements: [], crafts: [],
}

afterEach(cleanup)

describe('production card artwork', () => {
  it.each(['__proto__', 'constructor', 'missing-asset'])('safely renders an unknown asset ID %s in every catalog', (assetId) => {
    const ProductionCard = components!.ProductionCard
    const result = render(<ProductionCard design={{ ...design, elements: [
      { id: 'bad-word', kind: 'word-stamp', assetId, slotId: 'title', size: 'medium', direction: 'upright', layer: 'front' },
      { id: 'bad-motif', kind: 'motif', assetId, slotId: 'main', size: 'medium', direction: 'upright', layer: 'front' },
      { id: 'bad-border', kind: 'border', assetId, slotId: 'frame', size: 'medium', direction: 'upright', layer: 'back' },
      { id: 'bad-decoration', kind: 'decoration', assetId, slotId: 'left', size: 'medium', direction: 'upright', layer: 'front' },
    ] }} />)
    expect(screen.getAllByRole('img', { name: '未识别素材' })).toHaveLength(4)
    expect(result.container.textContent).not.toContain('[object Object]')
  })

  it('treats inherited craft choice names as plain text and uses a valid fallback color', () => {
    const ProductionCard = components!.ProductionCard
    const result = render(<ProductionCard design={{ ...design, crafts: [
      { id: 'wax', requirementId: 'wax', kind: 'wax', measurements: {}, discrete: { color: '__proto__', stamp: 'constructor' }, completedAtMs: 1 },
    ] }} />)
    expect(screen.getByLabelText('已完成工艺')).toHaveTextContent('颜色 __proto__ · 印模 constructor')
    expect(result.container.querySelector('.production-craft--wax path')).toHaveAttribute('fill', '#80a9b6')
  })

  it('gives every catalog asset distinct artwork and its readable name', () => {
    expect(components?.AssetArt, 'the reusable production artwork renderer exists').toBeTypeOf('function')
    const AssetArt = components!.AssetArt
    for (const [kind, catalog] of [['motif', MOTIFS], ['border', BORDERS], ['decoration', DECORATIONS], ['word-stamp', WORD_STAMPS]] as const) {
      const pictures = new Set<string>()
      for (const asset of catalog) {
        const result = render(<AssetArt kind={kind} assetId={asset.id} />)
        const artwork = screen.getByRole('img', { name: asset.label })
        pictures.add(artwork.innerHTML)
        result.unmount()
      }
      expect(pictures.size, `${kind} assets have different visible drawings`).toBe(catalog.length)
    }
  })

  it('positions selectable slots using the chosen layout and accepts only compatible catalog drops', () => {
    expect(components?.ProductionCard, 'the production preview exists').toBeTypeOf('function')
    const ProductionCard = components!.ProductionCard
    const onSlotSelect = vi.fn()
    const onSlotDrop = vi.fn()
    const result = render(<ProductionCard design={design} showSlots onSlotSelect={onSlotSelect} onSlotDrop={onSlotDrop} />)
    for (const layout of LAYOUTS) {
      result.rerender(<ProductionCard design={{ ...design, preparation: { ...design.preparation, layoutId: layout.id } }} showSlots onSlotSelect={onSlotSelect} onSlotDrop={onSlotDrop} />)
      const main = screen.getByRole('button', { name: '放置到主体位' })
      expect(main).toHaveStyle({ left: `${layout.slots[0].x * 100}%`, top: `${layout.slots[0].y * 100}%` })
    }
    const main = screen.getByRole('button', { name: '放置到主体位' })
    fireEvent.click(main)
    expect(onSlotSelect).toHaveBeenCalledWith('main')
    const drop = (data: string) => fireEvent.drop(main, { dataTransfer: { getData: (type: string) => type === 'application/x-rabbit-asset' ? data : '' } })
    drop(JSON.stringify({ kind: 'motif', assetId: 'rabbit' }))
    drop(JSON.stringify({ kind: 'border', assetId: 'lace' }))
    drop(JSON.stringify({ kind: 'motif', assetId: 'unknown' }))
    drop('invalid-json')
    expect(onSlotDrop).toHaveBeenCalledExactlyOnceWith('main', { kind: 'motif', assetId: 'rabbit' })
  })

  it('shows placed artwork and keeps read-only cards free of editing buttons', () => {
    expect(components?.ProductionCard, 'the production preview exists').toBeTypeOf('function')
    const ProductionCard = components!.ProductionCard
    render(<ProductionCard design={{ ...design, elements: [
      { id: 'rabbit-1', kind: 'motif', assetId: 'rabbit', slotId: 'main', size: 'large', direction: 'right', layer: 'front' },
      { id: 'welcome-1', kind: 'word-stamp', assetId: 'welcome', slotId: 'title', size: 'medium', direction: 'upright', layer: 'front' },
    ] }} />)
    expect(screen.getByRole('figure', { name: '当前卡片' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '小白兔' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '欢迎光临' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('makes each recorded craft measurement and discrete choice readable on the preview', () => {
    expect(components?.ProductionCard, 'the production preview exists').toBeTypeOf('function')
    const ProductionCard = components!.ProductionCard
    render(<ProductionCard design={{ ...design, crafts: [
      { id: 's', requirementId: 's', kind: 'stamp', measurements: { position: 0.45, pressure: 0.66 }, discrete: {}, completedAtMs: 1 },
      { id: 't', requirementId: 't', kind: 'trim', measurements: { position: 0.3, length: 0.7 }, discrete: {}, completedAtMs: 2 },
      { id: 'r', requirementId: 'r', kind: 'ribbon', measurements: { position: 0.5, length: 0.8 }, discrete: { color: 'blue', start: '0.2', end: '0.9' }, completedAtMs: 3 },
      { id: 'f', requirementId: 'f', kind: 'foil', measurements: { coverage: 0.85 }, discrete: { overflow: '0.1' }, completedAtMs: 4 },
      { id: 'w', requirementId: 'w', kind: 'wax', measurements: { time: 0.55, position: 0.6 }, discrete: { color: 'red', stamp: 'star' }, completedAtMs: 5 },
    ] }} />)
    const results = screen.getByLabelText('已完成工艺')
    expect(results).toHaveTextContent('盖章 · 位置 45% · 压力 66%')
    expect(results).toHaveTextContent('裁边 · 位置 30% · 长度 70%')
    expect(results).toHaveTextContent('缎带 · 位置 50% · 长度 80% · 颜色 蓝色 · 起点 20% · 终点 90%')
    expect(results).toHaveTextContent('烫金 · 覆盖 85% · 越界 10%')
    expect(results).toHaveTextContent('蜡封 · 按压 55% · 位置 60% · 颜色 红色 · 印模 星形')
  })

  it('replaces an earlier craft attempt with the newest result for that requirement', () => {
    expect(components?.ProductionCard, 'the production preview exists').toBeTypeOf('function')
    const ProductionCard = components!.ProductionCard
    render(<ProductionCard design={{ ...design, crafts: [
      { id: 'latest', requirementId: 'stamp', kind: 'stamp', measurements: { pressure: 0.5 }, discrete: {}, completedAtMs: 2 },
      { id: 'old', requirementId: 'stamp', kind: 'stamp', measurements: { pressure: 0.1 }, discrete: {}, completedAtMs: 1 },
    ] }} />)
    expect(screen.getByLabelText('已完成工艺')).toHaveTextContent('盖章 · 压力 50%')
    expect(screen.getByLabelText('已完成工艺')).not.toHaveTextContent('压力 10%')
  })

  it.each([
    ['foil', 'foil', '烫金'], ['emboss', 'stamp', '压纹'], ['wax', 'wax', '蜡封'],
  ] as const)('keeps the %s finish visibly pending until a matching craft is completed', (surfaceFinishId, kind, label) => {
    const ProductionCard = components!.ProductionCard
    const pending = { ...design, preparation: { ...design.preparation, surfaceFinishId } }
    const result = render(<ProductionCard design={pending} />)
    expect(result.container.querySelector('.production-card')).not.toHaveClass(`production-finish--${surfaceFinishId}`)
    expect(screen.getByLabelText('当前卡片')).toHaveTextContent(`${label}（待制作）`)
    result.rerender(<ProductionCard design={{ ...pending, crafts: [{ id: 'unrelated', requirementId: 'trim', kind: 'trim', measurements: { length: .5 }, discrete: {}, completedAtMs: 1 }] }} />)
    expect(result.container.querySelector('.production-card')).not.toHaveClass(`production-finish--${surfaceFinishId}`)
    result.rerender(<ProductionCard design={{ ...pending, crafts: [{ id: 'completed', requirementId: kind, kind, measurements: { coverage: .9, pressure: .5, time: .5 }, discrete: {}, completedAtMs: 2 }] }} />)
    expect(result.container.querySelector('.production-card')).toHaveClass(`production-finish--${surfaceFinishId}`)
    expect(screen.getByLabelText('当前卡片')).not.toHaveTextContent('待制作')
  })

  it.each(['matte', 'gloss'] as const)('shows the %s finish without requiring handwork', (surfaceFinishId) => {
    const ProductionCard = components!.ProductionCard
    const result = render(<ProductionCard design={{ ...design, preparation: { ...design.preparation, surfaceFinishId } }} />)
    expect(result.container.querySelector('.production-card')).toHaveClass(`production-finish--${surfaceFinishId}`)
    expect(screen.getByLabelText('当前卡片')).not.toHaveTextContent('待制作')
  })

  it('visibly scales border sizes while keeping the frame within the card', () => {
    const ProductionCard = components!.ProductionCard
    const result = render(<ProductionCard design={design} />)
    const scales: number[] = []
    for (const size of ['small', 'medium', 'large'] as const) {
      result.rerender(<ProductionCard design={{ ...design, elements: [{ id: 'frame', assetId: 'plain-line', kind: 'border', slotId: 'frame', size, direction: 'upright', layer: 'back' }] }} />)
      const frame = result.container.querySelector<HTMLElement>('.production-element--border')!
      const scale = Number(frame.style.getPropertyValue('--asset-scale'))
      scales.push(scale)
      expect(parseFloat(frame.style.width) * scale).toBeLessThanOrEqual(100)
      expect(frame).toHaveStyle({ left: '50%', top: '50%' })
    }
    expect(scales[0]).toBeLessThan(scales[1])
    expect(scales[1]).toBeLessThan(scales[2])
  })

  it('fits each motif size inside its slot after rotation on every card aspect ratio', () => {
    const ProductionCard = components!.ProductionCard
    const result = render(<ProductionCard design={design} />)
    const slot = LAYOUTS[0].slots[0]
    for (const [shapeId, orientation, ratio] of [
      ['landscape', 'landscape', 1.5], ['portrait', 'portrait', 2 / 3],
      ['square', 'landscape', 1], ['ticket', 'landscape', 2], ['tag', 'portrait', 2 / 3],
    ] as const) {
      for (const direction of ['upright', 'left', 'right', 'inverted'] as const) {
        const areas: number[] = []
        for (const size of ['small', 'medium', 'large'] as const) {
          result.rerender(<ProductionCard design={{ ...design, preparation: { ...design.preparation, shapeId, orientation },
            elements: [{ id: 'main', kind: 'motif', assetId: 'rabbit', slotId: 'main', direction, size, layer: 'front' }] }} showSlots />)
          const element = result.container.querySelector<HTMLElement>('.production-element--motif')!
          const scale = Number(element.style.getPropertyValue('--asset-scale'))
          const width = parseFloat(element.style.width) / 100 * ratio * scale
          const height = parseFloat(element.style.height) / 100 * scale
          const angle = parseFloat(element.style.getPropertyValue('--asset-turn')) * Math.PI / 180
          const rotatedWidth = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))
          const rotatedHeight = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle))
          expect(rotatedWidth, `${shapeId} ${direction} ${size} width`).toBeLessThanOrEqual(slot.width * ratio)
          expect(rotatedHeight, `${shapeId} ${direction} ${size} height`).toBeLessThanOrEqual(slot.height)
          areas.push(width * height)
        }
        expect(areas[0]).toBeLessThan(areas[1])
        expect(areas[1]).toBeLessThan(areas[2])
      }
    }
  })
})
