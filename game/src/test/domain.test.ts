import { describe, expect, it } from 'vitest'
import {
  addLayer,
  createEditorHistory,
  duplicateLayer,
  redo,
  removeLayer,
  reorderLayer,
  undo,
  updateLayer,
} from '../domain/editor-history'
import {
  evaluateChino,
  evaluateChiyaSharo,
  evaluateCommission,
  evaluateRize,
} from '../domain/evaluation'
import { InMemoryCardLibrary, InMemoryPrintShop } from '../domain/gateways'
import type { CardDesign, StickerLayer } from '../domain/types'

const baseDesign = (): CardDesign => ({
  version: 1,
  paperId: 'cream',
  layers: [
    {
      kind: 'sticker',
      id: 'cup',
      assetId: 'coffee-cup',
      x: 0.24,
      y: 0.5,
      scale: 0.26,
      rotation: 0,
    },
  ],
})

describe('in-memory card library', () => {
  it('saves a deeply isolated snapshot without starting a print job', async () => {
    const library = new InMemoryCardLibrary(() => '2026-10-13T12:00:00.000Z')
    const printShop = new InMemoryPrintShop()
    const draft = baseDesign()

    const saved = await library.save(draft, 'chino')
    ;(draft.layers[0] as { x: number }).x = 0.95

    expect(saved.cardId).toBe('card-1')
    expect(saved.design.layers[0]).toMatchObject({ x: 0.24 })
    expect(saved.commissionId).toBe('chino')
    expect(await printShop.list()).toEqual([])
  })

  it('does not allow callers to mutate stored cards through save, get, or list results', async () => {
    const library = new InMemoryCardLibrary()
    const saved = await library.save(baseDesign())

    ;(saved.design.layers[0] as { x: number }).x = 0.8
    const fetched = await library.get(saved.cardId)
    ;(fetched!.design.layers[0] as { x: number }).x = 0.7
    const listed = await library.list()
    ;(listed[0].design.layers[0] as { x: number }).x = 0.6

    expect((await library.get(saved.cardId))?.design.layers[0]).toMatchObject({ x: 0.24 })
  })
})

describe('in-memory print shop', () => {
  it('uses the request token as an idempotency key', async () => {
    const shop = new InMemoryPrintShop()

    const first = await shop.start('card-1', 'confirm-click-1')
    const retry = await shop.start('card-1', 'confirm-click-1')
    const anotherCopy = await shop.start('card-1', 'confirm-click-2')

    expect(retry).toEqual(first)
    expect(anotherCopy.printJobId).not.toBe(first.printJobId)
    expect(await shop.list()).toHaveLength(2)
  })

  it('keeps get and list as pure queries', async () => {
    const shop = new InMemoryPrintShop()
    const job = await shop.start('card-1', 'confirm-click-1')

    expect(await shop.get(job.printJobId)).toEqual(job)
    expect(await shop.get(job.printJobId)).toEqual(job)
    expect(await shop.list()).toEqual([job])
    expect(await shop.list()).toEqual([job])
    expect(await shop.list()).toHaveLength(1)
  })
})

describe('pure editor history', () => {
  const rabbit: StickerLayer = {
    kind: 'sticker',
    id: 'rabbit',
    assetId: 'small-rabbit',
    x: 0.5,
    y: 0.5,
    scale: 0.12,
    rotation: 0,
  }

  it('adds, updates, duplicates, reorders, and removes layers without mutating earlier states', () => {
    const initial = createEditorHistory({ ...baseDesign(), layers: [] })
    const withRabbit = addLayer(initial, rabbit)
    const moved = updateLayer(withRabbit, 'rabbit', { x: 0.7, rotation: 15 })
    const duplicated = duplicateLayer(moved, 'rabbit', 'rabbit-copy')
    const reordered = reorderLayer(duplicated, 'rabbit-copy', 0)
    const removed = removeLayer(reordered, 'rabbit')

    expect(initial.present.layers).toEqual([])
    expect(withRabbit.present.layers[0]).toMatchObject({ x: 0.5, rotation: 0 })
    expect(moved.present.layers[0]).toMatchObject({ x: 0.7, rotation: 15 })
    expect(duplicated.present.layers.map((layer) => layer.id)).toEqual(['rabbit', 'rabbit-copy'])
    expect(reordered.present.layers.map((layer) => layer.id)).toEqual(['rabbit-copy', 'rabbit'])
    expect(removed.present.layers.map((layer) => layer.id)).toEqual(['rabbit-copy'])
  })

  it('undoes and redoes edits, then clears redo history after a new edit', () => {
    const initial = createEditorHistory({ ...baseDesign(), layers: [] })
    const oneLayer = addLayer(initial, rabbit)
    const twoLayers = duplicateLayer(oneLayer, 'rabbit', 'rabbit-copy')

    const undone = undo(twoLayers)
    const redone = redo(undone)
    const branched = addLayer(undone, { ...rabbit, id: 'new-rabbit' })

    expect(undone.present.layers.map((layer) => layer.id)).toEqual(['rabbit'])
    expect(redone.present.layers.map((layer) => layer.id)).toEqual(['rabbit', 'rabbit-copy'])
    expect(redo(branched)).toBe(branched)
  })
})

describe('commission evaluation', () => {
  const textStamp = (id: string, text: string, x: number, y: number, scale = 0.24) => ({
    kind: 'text-stamp' as const,
    id,
    styleId: 'menu-label',
    text,
    x,
    y,
    scale,
    rotation: 0,
  })

  const sticker = (id: string, assetId: string, x: number, y: number, scale: number) => ({
    kind: 'sticker' as const,
    id,
    assetId,
    x,
    y,
    scale,
    rotation: 0,
  })

  const expectReadableEvaluation = (evaluation: ReturnType<typeof evaluateChino>) => {
    expect(evaluation.parts.map((part) => part.label)).toEqual([
      '卡纸搭配',
      '订单元素',
      '版面布局',
      '信息清晰',
      '制作工整',
    ])
    expect(evaluation.advice.length).toBeLessThanOrEqual(2)
    expect(evaluation.totalScore).toBe(
      evaluation.parts.reduce((total, part) => total + part.score, 0),
    )
  }

  it('has deterministic pass and fail designs for Chino commission', () => {
    const passing: CardDesign = {
      version: 1,
      paperId: 'cream',
      layers: [
        sticker('cup', 'coffee-cup', 0.22, 0.52, 0.26),
        textStamp('thanks', '谢谢光临', 0.74, 0.5),
        sticker('rabbit', 'small-rabbit', 0.5, 0.78, 0.12),
      ],
    }
    const failing: CardDesign = { version: 1, paperId: 'pink', layers: [] }

    expect(evaluateChino(passing).passed).toBe(true)
    expect(evaluateChino(failing).passed).toBe(false)
    expectReadableEvaluation(evaluateCommission('chino', passing))
  })

  it('has deterministic pass and fail designs for Rize commission', () => {
    const passing: CardDesign = {
      version: 1,
      paperId: 'coffee',
      layers: [
        sticker('ribbon', 'ribbon', 0.5, 0.82, 0.5),
        sticker('cup', 'coffee-cup', 0.5, 0.52, 0.3),
        sticker('star-left', 'star', 0.23, 0.48, 0.1),
        sticker('star-right', 'star', 0.77, 0.49, 0.1),
        textStamp('recommendation', '今日推荐', 0.5, 0.16),
      ],
    }
    const failing: CardDesign = { version: 1, paperId: 'cream', layers: [] }

    expect(evaluateRize(passing).passed).toBe(true)
    expect(evaluateRize(failing).passed).toBe(false)
    expectReadableEvaluation(evaluateCommission('rize', passing))
  })

  it('has deterministic pass and fail designs for Chiya and Sharo commission', () => {
    const passing: CardDesign = {
      version: 1,
      paperId: 'mint',
      layers: [
        sticker('tea-left', 'tea-cup', 0.3, 0.68, 0.2),
        sticker('tea-right', 'tea-cup', 0.7, 0.68, 0.2),
        sticker('flower-left', 'flower', 0.16, 0.25, 0.1),
        sticker('flower-right', 'flower', 0.84, 0.25, 0.1),
        sticker('flower-bottom', 'flower', 0.5, 0.73, 0.1),
        textStamp('tea-party', '午后茶会', 0.5, 0.14),
        {
          kind: 'stroke',
          id: 'table-line',
          points: [
            { x: 0.15, y: 0.9 },
            { x: 0.85, y: 0.9 },
          ],
          colorId: 'cream-pencil',
          width: 0.01,
        },
      ],
    }
    const failing: CardDesign = { version: 1, paperId: 'coffee', layers: [] }

    expect(evaluateChiyaSharo(passing).passed).toBe(true)
    expect(evaluateChiyaSharo(failing).passed).toBe(false)
    expectReadableEvaluation(evaluateCommission('chiya-sharo', passing))
  })
})
