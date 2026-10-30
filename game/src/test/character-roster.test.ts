import { describe, expect, it } from 'vitest'
import { AUTHORED_STAGES, generateSurvivalStage, inventoryShortfalls, ORDER_TEMPLATES } from '../content/production'
import { initializeShift } from '../domain/shift-engine'
import { OFFICIAL_CHARACTER_IDS, type ShiftSnapshot } from '../domain/shift-types'
import { BrowserShiftStore, SHIFT_STORE_KEYS } from '../infrastructure/shift-store'

const replacements = [
  ['student', 'student-note', '放学的学生', '学生的友谊小卡', 'maya-friendship'],
  ['office-worker', 'office-thanks', '午休的上班族', '上班族的感谢卡', 'rin-thanks'],
  ['tourist', 'tourist-ticket', '街角的游客', '游客的旅行票卡', 'fuyu-visit'],
  ['neighbor', 'neighbor-tea', '熟悉的街坊', '街坊的茶会邀请', 'moka-tea'],
  ['collector', 'collector-keepsake', '卡片收藏家', '收藏家的纪念卡', 'aoyama-keepsake'],
  ['hurried', 'hurried-gift', '提着礼物的客人', '赶路客人的礼物吊牌', 'yura-gift'],
] as const

function legacySave() {
  const customers = AUTHORED_STAGES.beginner.customers.map((customer, index) => ({
    ...customer, order: ORDER_TEMPLATES.find(template => template.id === replacements[index][4])!,
  }))
  const run = initializeShift({ ...AUTHORED_STAGES.beginner, customers }, 'legacy-characters', 1000)
  const oldOrders = customers.map(({ order }, index) => ({
    ...order, id: index === 5 ? 'survival:2:order:6' : replacements[index][1], title: replacements[index][3],
    customer: { kind: 'regular', identity: replacements[index][0], name: replacements[index][2], personality: '原有性格', situation: '原有委托' },
  }))
  return { version: 1, revision: 7, savedAtMs: 1000, run: { ...run,
    stage: { ...run.stage, customers: run.stage.customers.map((customer, index) => ({ ...customer, order: oldOrders[index] })) },
    orders: run.orders.map((order, index) => ({ ...order, content: oldOrders[index] })),
  } }
}

function store() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } as Storage
  return { storage, browser: new BrowserShiftStore(storage, { transactions: null,
    locks: { request: async (_name, action) => action() } }) }
}

describe('canon customer integration', () => {
  it('introduces all fourteen characters in the first three stages with sufficient required stock', () => {
    const stages = Object.values(AUTHORED_STAGES)
    expect(stages.map(stage => stage.customers.length)).toEqual([5, 6, 7])
    const customers = stages.flatMap(stage => stage.customers.map(customer => customer.order.customer))
    expect(new Set(customers.map(customer => customer.characterId))).toEqual(new Set(OFFICIAL_CHARACTER_IDS))
    for (const stage of [...stages, generateSurvivalStage(8, 'canon-roster')]) {
      expect(stage.customers.every(customer => customer.order.customer.kind === 'official')).toBe(true)
      expect(inventoryShortfalls(stage.customers.map(customer => customer.order), stage.inventory)).toEqual([])
    }
  })

  it('reads legacy current/reconciliation saves without writes, preserving production state and generated IDs', async () => {
    const { storage, browser } = store()
    const old = legacySave()
    const raw = JSON.stringify({ version: 1, kind: 'shift-current', value: old })
    storage.setItem(SHIFT_STORE_KEYS.current, raw)
    storage.setItem(SHIFT_STORE_KEYS.reconciliation, JSON.stringify({ version: 1, kind: 'shift-reconciliation', value: [old] }))
    const loaded = (await browser.loadCurrent())!
    expect(loaded).toBeDefined()
    expect(loaded.run.orders.map(order => order.content.customer.characterId)).toEqual(['maya', 'rin', 'fuyu', 'moka', 'aoyama', 'yura'])
    expect(loaded.run.stage.customers.map(customer => customer.order.customer)).toEqual(loaded.run.orders.map(order => order.content.customer))
    expect(loaded.run.orders.map(order => order.content.requirements)).toEqual(old.run.orders.map(order => order.content.requirements))
    expect(loaded.run.orders.map(order => order.id)).toEqual(old.run.orders.map(order => order.id))
    expect(loaded.run.orders.map(order => order.content.id)).toEqual(old.run.orders.map(order => order.content.id))
    expect(loaded.run.orders.at(-1)!.content.id).toBe('survival:2:order:6')
    expect(loaded.run.materials).toEqual(old.run.materials)
    expect(loaded.run.deadlineAtMs).toBe(old.run.deadlineAtMs)
    expect(loaded.revision).toBe(7)
    expect((await browser.listReconciliations())[0]).toEqual(loaded)
    expect(storage.getItem(SHIFT_STORE_KEYS.current)).toBe(raw)
    await browser.saveCurrent({ ...loaded, revision: 8 } satisfies ShiftSnapshot, 7)
    expect(JSON.parse(storage.getItem(SHIFT_STORE_KEYS.current)!).value.run.orders[0].content.customer.characterId).toBe('maya')
  })

  it('keeps unknown legacy identities corrupt and updates saved workshop labels without changing the design', async () => {
    const { storage, browser } = store()
    const unknown = legacySave()
    const corrupt = JSON.parse(JSON.stringify(unknown))
    corrupt.run.orders[0].content.customer.identity = 'unknown'
    storage.setItem(SHIFT_STORE_KEYS.current, JSON.stringify({ version: 1, kind: 'shift-current', value: corrupt }))
    expect(await browser.inspectCurrent()).toEqual({ status: 'corrupt' })
    const design = { version: 1, preparation: { ...unknown.run.orders[0].content.requirements }, elements: [], crafts: [] }
    const draft = { kind: 'workshop-draft', version: 1, id: 'draft', shiftRunId: 'legacy-characters',
      customerName: '放学的学生', title: '学生的友谊小卡', savedAtMs: 1000, design }
    const raw = JSON.stringify({ version: 2, kind: 'shift-collection', value: { cards: [], drafts: [draft] } })
    storage.setItem(SHIFT_STORE_KEYS.collection, raw)
    expect((await browser.listWorkshopDrafts())[0]).toEqual({ ...draft, customerName: '麻耶', title: '麻耶的友谊小卡' })
    expect(storage.getItem(SHIFT_STORE_KEYS.collection)).toBe(raw)
  })
})
