/// <reference types="node" />

import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUTHORED_STAGES, ORDER_TEMPLATES } from '../content/production'
import { PRODUCTION_ASSETS } from '../content/production-assets'
import { CUSTOMER_COPY, OPERATIONAL_COPY, selectStoryEnding, STORY_STAGES, SUPPORTING_CUSTOMER_COPY, TUTORIAL_INTERVENTIONS } from '../content/story'
import type { AuthoredStageId } from '../domain/shift-types'

const stageIds = ['tutorial', 'beginner', 'story'] as const
const supportingIds = ['maya', 'megu', 'aoyama', 'rin', 'moka', 'yura', 'fuyu', 'natsume', 'elulu'] as const
const expectedTemplates: Record<AuthoredStageId, readonly string[]> = {
  tutorial: ['cocoa-welcome', 'megu-ballet', 'natsume-friendship', 'chiya-garden', 'elulu-tea'],
  beginner: ['maya-friendship', 'rin-thanks', 'chiya-garden', 'fuyu-visit', 'aoyama-keepsake', 'moka-tea'],
  story: ['cocoa-welcome', 'aoyama-keepsake', 'rize-event', 'chiya-garden', 'yura-gift', 'syaro-shift', 'chino-keepsake'],
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

describe('authored story content', () => {
  it.each(stageIds)('matches every scheduled %s customer in order', (stageId) => {
    expect(Object.keys(STORY_STAGES)).toEqual(stageIds)
    const stage = STORY_STAGES[stageId]
    expect(stage.id).toBe(stageId)
    expect(stage.customers.map((customer) => customer.id)).toEqual(expectedTemplates[stageId])
    expect(stage.customers.map((customer) => customer.id)).toEqual(AUTHORED_STAGES[stageId].customers.map((customer) => customer.order.id))
    expect(stage.customers.map((customer) => customer.name)).toEqual(AUTHORED_STAGES[stageId].customers.map((customer) => customer.order.customer.name))
    expect(new Set(stage.customers.map((customer) => customer.id)).size).toBe(stage.customers.length)
    for (const customer of stage.customers) {
      for (const key of ['name', 'role', 'requestSummary', 'greeting', 'patienceWarning', 'greatDelivery', 'okayDelivery', 'departure'] as const) {
        expect(customer[key].trim(), `${stageId}/${customer.id}/${key}`).not.toBe('')
      }
    }
  })

  it('provides three complete story branches and short tutorial interventions', () => {
    for (const stage of Object.values(STORY_STAGES)) {
      expect(stage.title.trim()).not.toBe('')
      expect(stage.eyebrow.trim()).not.toBe('')
      expect(stage.sceneDescription.trim()).not.toBe('')
      expect(stage.opening.length).toBeGreaterThan(0)
      expect(stage.midShift.length).toBeGreaterThan(0)
      expect(new Set(stage.midShift.map((line) => line.trigger)).size).toBe(stage.midShift.length)
      expect(Object.keys(stage.endings)).toEqual(['great', 'pass', 'fail'])
      for (const branch of Object.values(stage.endings)) expect(branch.length).toBeGreaterThan(0)
      for (const line of [...stage.opening, ...stage.midShift, ...Object.values(stage.endings).flat()]) {
        expect(line.speaker.trim()).not.toBe('')
        expect(line.text.trim()).not.toBe('')
      }
    }
    expect(TUTORIAL_INTERVENTIONS.map((line) => line.trigger)).toEqual([
      'read_order', 'choose_materials', 'place_elements', 'complete_craft',
      'inspect_card', 'archive_card', 'choose_printer', 'handover',
    ])
    expect(TUTORIAL_INTERVENTIONS.every((line) => line.text.length <= 70)).toBe(true)
    expect(STORY_STAGES.story.customers.at(-1)).toMatchObject({ id: 'chino-keepsake', name: '智乃' })
    expect(STORY_STAGES.story.customers.at(-1)!.requestSummary).toContain('纪念')
  })

  it.each(stageIds)('only selects the %s great ending when every customer was delivered and satisfied', (stageId) => {
    const count = AUTHORED_STAGES[stageId].customers.length
    const result = { stageId, passed: true, delivered: count, satisfied: count, averageScore: 90 }
    expect(selectStoryEnding(result)).toBe('great')
    expect(selectStoryEnding({ ...result, delivered: count - 1, satisfied: count - 1 })).toBe('pass')
    expect(selectStoryEnding({ ...result, satisfied: count - 1 })).toBe('pass')
    expect(selectStoryEnding({ ...result, delivered: count - 1 })).toBe('pass')
    expect(selectStoryEnding({ ...result, delivered: count + 1, satisfied: count + 1 })).toBe('pass')
    expect(selectStoryEnding({ ...result, passed: false })).toBe('fail')
    expect(selectStoryEnding({ ...result, passed: false, delivered: 0, satisfied: 0 })).toBe('fail')
  })

  it('uses unrounded average quality to distinguish story endings without changing pass or failure', () => {
    const result = { stageId: 'story', passed: true, delivered: 7, satisfied: 7, averageScore: 90 }
    expect(selectStoryEnding({ ...result, averageScore: 89.9 })).toBe('pass')
    expect(selectStoryEnding(result)).toBe('great')
    expect(selectStoryEnding({ ...result, averageScore: 100, satisfied: 6 })).toBe('pass')
    expect(selectStoryEnding({ ...result, averageScore: 100, passed: false })).toBe('fail')
  })

  it('does not treat a beginner result with five satisfied deliveries as tutorial completion', () => {
    const beginnerResult = { stageId: 'beginner', passed: true, delivered: 5, satisfied: 5, averageScore: 80 }
    expect(selectStoryEnding(beginnerResult)).toBe('pass')
    expect(selectStoryEnding({ ...beginnerResult, stageId: 'tutorial' })).toBe('great')
  })

  it.each(['survival:1', 'unknown'])('rejects %s results before selecting an authored ending', (stageId) => {
    for (const passed of [false, true]) {
      const result = { stageId, passed, delivered: 5, satisfied: 5, averageScore: 90 }
      expect(() => selectStoryEnding(result)).toThrow('Story endings require an authored stage')
    }
  })

  it('covers operational feedback with failure messages keyed by their actual cause', () => {
    for (const category of ['patienceWarnings', 'machineReady', 'puzzleSuccess', 'inspection', 'delivery'] as const) {
      expect(OPERATIONAL_COPY[category].length).toBeGreaterThan(0)
    }
    expect(Object.keys(OPERATIONAL_COPY.puzzleFailure)).toEqual(['incorrect', 'timeout', 'interrupted', 'stationChanged', 'locked'])
    expect(Object.keys(OPERATIONAL_COPY.worldErrors)).toEqual(['queueFull', 'machineLocked', 'materialsShort', 'notArchived', 'notReady', 'customerLeft'])
    expect(Object.keys(OPERATIONAL_COPY.survival)).toEqual(['openings', 'dayCleared', 'runEnded'])
    expect(Object.values(OPERATIONAL_COPY.survival).every((lines) => lines.length > 0)).toBe(true)
    expect(strings(OPERATIONAL_COPY).every((line) => line.trim().length > 0)).toBe(true)
  })

  it('keeps all display text in shop vocabulary and all content serializable', () => {
    const manifest = PRODUCTION_ASSETS
    const content = { STORY_STAGES, CUSTOMER_COPY, SUPPORTING_CUSTOMER_COPY, TUTORIAL_INTERVENTIONS, OPERATIONAL_COPY, manifest }
    expect(JSON.parse(JSON.stringify(content))).toEqual(content)
    const displayText = Object.values(STORY_STAGES).flatMap((stage) => [
      stage.title, stage.eyebrow, stage.sceneDescription,
      ...[...stage.opening, ...stage.midShift, ...Object.values(stage.endings).flat()].flatMap((line) => [line.speaker, line.text, ...('mood' in line && line.mood ? [line.mood] : [])]),
      ...stage.customers.flatMap(({ id: _id, portrait: _portrait, ...copy }) => strings(copy)),
    ])
    displayText.push(...Object.values(CUSTOMER_COPY).flatMap(({ id: _id, portrait: _portrait, ...copy }) => strings(copy)))
    displayText.push(...TUTORIAL_INTERVENTIONS.flatMap((line) => [line.speaker, line.text]))
    displayText.push(...strings(OPERATIONAL_COPY), ...manifest.flatMap((asset) => [asset.label, asset.alt]))
    // Whole ASCII words: the shop name "Fleur de Lapin" is valid copy.
    for (const line of displayText) expect(line).not.toMatch(/\b(?:JSON|API|token|field|log|payload|schema)\b/i)
  })
})

describe('approved cosmetic assets', () => {
  it.each(stageIds)('resolves the %s scene and every scheduled customer to the correct asset and crop', (stageId) => {
    const stage = STORY_STAGES[stageId]
    const background = PRODUCTION_ASSETS.find((asset) => asset.id === stage.backgroundAssetId)
    expect(background, `${stageId} background`).toBeDefined()
    expect(background?.kind).toBe('background')

    const expectedPortraits: Record<string, { assetId: string; cropId: string }> = {
      'cocoa-welcome': { assetId: 'cocoa-chino-tippy', cropId: 'cocoa' },
      'chino-coffee': { assetId: 'cocoa-chino-tippy', cropId: 'chino' },
      'rize-event': { assetId: 'rize', cropId: 'rize' },
      'chiya-garden': { assetId: 'chiya-syaro', cropId: 'chiya' },
      'syaro-shift': { assetId: 'chiya-syaro', cropId: 'syaro' },
      'maya-friendship': { assetId: 'maya', cropId: 'maya' },
      'megu-ballet': { assetId: 'megu', cropId: 'megu' },
      'aoyama-keepsake': { assetId: 'aoyama', cropId: 'aoyama' },
      'rin-thanks': { assetId: 'rin', cropId: 'rin' },
      'moka-tea': { assetId: 'moka', cropId: 'moka' },
      'yura-gift': { assetId: 'yura', cropId: 'yura' },
      'fuyu-visit': { assetId: 'fuyu', cropId: 'fuyu' },
      'natsume-friendship': { assetId: 'natsume', cropId: 'natsume' },
      'elulu-tea': { assetId: 'elulu', cropId: 'elulu' },
      'chino-keepsake': { assetId: 'cocoa-chino-tippy', cropId: 'chino' },
    }
    expect(stage.customers).toHaveLength({ tutorial: 5, beginner: 6, story: 7 }[stageId])
    for (const customer of stage.customers) {
      expect(customer.portrait, `${stageId}/${customer.id} portrait`).toEqual(expectedPortraits[customer.id])
      const asset = PRODUCTION_ASSETS.find((entry) => entry.id === customer.portrait.assetId)
      expect(asset, `${stageId}/${customer.id} asset`).toBeDefined()
      expect(asset?.kind).toBe('character-sheet')
      const crop = asset?.kind === 'character-sheet'
        ? asset.crops.find((entry) => entry.id === customer.portrait.cropId)
        : undefined
      expect(crop, `${stageId}/${customer.id} crop`).toBeDefined()
    }
  })

  it('provides all nine supporting characters with dedicated portraits and honest customer reactions', () => {
    expect(Object.keys(SUPPORTING_CUSTOMER_COPY)).toEqual(supportingIds)
    const scheduled = Object.values(STORY_STAGES).flatMap(stage => stage.customers)
    for (const id of supportingIds) {
      const customer = SUPPORTING_CUSTOMER_COPY[id]
      expect(customer.portrait).toEqual({ assetId: id, cropId: id })
      expect(scheduled.some(copy => copy.id === customer.id)).toBe(true)
      for (const key of ['greeting', 'patienceWarning', 'greatDelivery', 'okayDelivery', 'departure', 'leftWithoutCard'] as const) {
        expect(customer[key]?.trim(), `${id}/${key}`).toBeTruthy()
      }
    }
    for (const template of ORDER_TEMPLATES) {
      expect(CUSTOMER_COPY[template.id]?.name, template.id).toBe(template.customer.name)
    }
  })

  it('resolves every unique asset to a real approved file without path traversal', () => {
    const manifest = PRODUCTION_ASSETS
    const assetRoot = realpathSync(resolve(process.cwd(), 'public/assets'))
    expect(new Set(manifest.map((asset) => asset.id)).size).toBe(manifest.length)
    expect(manifest.some(asset => ['townspeople-a', 'townspeople-b'].includes(asset.id))).toBe(false)
    for (const id of supportingIds) {
      const sheet = manifest.find(asset => asset.id === id)
      expect(sheet?.kind).toBe('character-sheet')
      expect(sheet?.kind === 'character-sheet' && sheet.crops.some(crop => crop.id === id)).toBe(true)
    }
    for (const asset of manifest) {
      expect(asset.src).toMatch(/^\/assets\/[a-z0-9/-]+\.(?:png|jpe?g|webp)$/)
      expect(asset.src).not.toMatch(/\.\.|\\|%/)
      const path = resolve(assetRoot, asset.src.slice('/assets/'.length))
      expect(existsSync(path), asset.src).toBe(true)
      const local = relative(assetRoot, realpathSync(path))
      expect(local.startsWith('..') || isAbsolute(local), asset.src).toBe(false)
      expect(statSync(path).isFile()).toBe(true)
      expect(asset.usage).toBe('cosmetic')
    }
  })

  it('provides valid presentation focus and separately addressable group-sheet crops', () => {
    for (const asset of PRODUCTION_ASSETS) {
      for (const coordinate of [asset.focus.x, asset.focus.y]) {
        expect(coordinate).toBeGreaterThanOrEqual(0)
        expect(coordinate).toBeLessThanOrEqual(1)
      }
      if (asset.kind !== 'character-sheet') continue
      expect(asset.crops.length).toBeGreaterThan(0)
      expect(new Set(asset.crops.map((crop) => crop.id)).size).toBe(asset.crops.length)
      for (const crop of asset.crops) {
        expect(crop.x).toBeGreaterThanOrEqual(0)
        expect(crop.y).toBeGreaterThanOrEqual(0)
        expect(crop.width).toBeGreaterThan(0)
        expect(crop.height).toBeGreaterThan(0)
        expect(crop.x + crop.width).toBeLessThanOrEqual(1)
        expect(crop.y + crop.height).toBeLessThanOrEqual(1)
      }
    }
    for (const id of supportingIds) {
      const sheet = PRODUCTION_ASSETS.find((asset) => asset.id === id)!
      expect(sheet.kind === 'character-sheet' ? sheet.crops : []).toHaveLength(1)
    }
  })
})
