import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ShiftProvider, useShift, type ShiftContextValue } from '../app/ShiftProvider'
import { AUTHORED_STAGES, ORDER_TEMPLATES } from '../content/production'
import { InMemoryPrintShop } from '../domain/gateways'
import { initializeShift, transitionShift, type ShiftEngineAction } from '../domain/shift-engine'
import type { CraftKind, CraftRequirement, ProductionDraft, StageDefinition } from '../domain/shift-types'
import { BrowserShiftStore } from '../infrastructure/shift-store'
import { ShiftScreen } from '../screens/ShiftScreen'

const START = 1_000_000
let context: ShiftContextValue
function Probe() { context = useShift(); return null }
function currentDraft(): ProductionDraft { return Object.values(context.run!.drafts).filter(draft => draft.orderId === context.selectedOrderId).sort((a, b) => b.revision - a.revision)[0] }
async function click(name: string | RegExp) { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); await context.tick() }) }
async function change(name: string, value: string) { await act(async () => { fireEvent.change(screen.getByLabelText(name), { target: { value } }); await context.tick() }) }
async function mount(craft?: CraftKind) {
  let time = START
  const now = () => time
  const template = (craft && ORDER_TEMPLATES.find(order => order.requirements.crafts.some(item => item.kind === craft))) || ORDER_TEMPLATES[0]
  const requirement: CraftRequirement | undefined = craft ? { id: craft, kind: craft, label: '本单手工要求',
    targets: craft === 'foil' ? { coverage: { min: .85, max: 1 } } : { position: { min: .45, max: .55 }, [craft === 'ribbon' || craft === 'trim' ? 'length' : craft === 'wax' ? 'time' : 'pressure']: { min: .4, max: .6 } },
    discrete: craft === 'ribbon' ? { color: 'blue' } : craft === 'wax' ? { color: 'blue', stamp: 'star' } : {},
    materialCosts: craft === 'ribbon' ? [{ materialId: 'special-ribbon', quantity: 1 }] : craft === 'foil' ? [{ materialId: 'foil-sheet', quantity: 1 }] : craft === 'wax' ? [{ materialId: 'wax', quantity: 1 }] : [],
  } : undefined
  const stage: StageDefinition = { ...AUTHORED_STAGES.tutorial, inventory: { ...AUTHORED_STAGES.tutorial.inventory, wax: 5, 'foil-sheet': 5, 'special-ribbon': 5, 'emboss-sheet': 5 },
    customers: [{ ...AUTHORED_STAGES.tutorial.customers[0], order: { ...template, requirements: { ...template.requirements, surfaceFinishId: 'matte', crafts: requirement ? [requirement] : [] } } }] }
  let run = initializeShift(stage, 'station-run', START)
  run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: stage.customers[0].id }, START)
  if (craft) {
    const draft = Object.values(run.drafts)[0]
    run = transitionShift(run, { station: 'preparation', type: 'select-preparation', draftId: draft.id, selection: template.requirements }, START)
    run = transitionShift(run, { station: 'preparation', type: 'cut-blank', draftId: draft.id }, START)
    run = transitionShift(run, { station: 'assembly', type: 'fix-assembly', draftId: draft.id }, START)
    run = transitionShift(run, { type: 'switch-station', station: 'craft' }, START)
  }
  const store = new BrowserShiftStore()
  await store.saveCurrent({ version: 1, revision: 1, savedAtMs: START, run })
  const gateway = new InMemoryPrintShop()
  const tree = () => <ShiftProvider stage={stage} runId={run.id} now={now} scheduleTick={null} store={store} gateway={gateway}><ShiftScreen /><Probe /></ShiftProvider>
  let view = render(tree())
  await waitFor(() => expect(context?.status).toBe('ready'))
  return { requirement, store, async remount() { view.unmount(); view = render(tree()); await waitFor(() => expect(context.status).toBe('ready')) }, async at(value: number) { time = value; await act(async () => { await context.tick() }) }, async send(action: ShiftEngineAction) { await act(async () => { await context.dispatch(action) }) } }
}
async function selectCraft(requirement: CraftRequirement) { await click(`准备${({ stamp: '盖章', trim: '裁边', ribbon: '贴缎带', foil: '烫金', wax: '蜡封' })[requirement.kind]}`) }

describe('production stations', () => {
  it('requires explicit cutting and fixed-slot placement with size, direction and layer choices', async () => {
    await mount()
    const ticket = screen.getByRole('button', { name: 'Q 订单位 1 心爱' })
    expect(ticket).toHaveTextContent('平滑纸')
    expect(ticket).toHaveTextContent('横向')
    await click(/^2 备料台/)
    expect(screen.getByRole('button', { name: '裁出卡胚' })).toBeDisabled()
    await click('樱花粉')
    await change('卡纸材质', 'smooth')
    await click('横卡')
    await change('成品方向', 'landscape')
    await click('暖心迎宾')
    expect(currentDraft().stage).toBe('preparing')
    expect(currentDraft().design.elements).toEqual([])
    await click('裁出卡胚')
    expect(currentDraft().stage).toBe('assembling')
    await click(/^3 组装台/)
    await click('选取小白兔')
    expect(currentDraft().design.elements).toHaveLength(0)
    await click('放置到主体位')
    expect(currentDraft().design.elements).toEqual([expect.objectContaining({ assetId: 'rabbit', slotId: 'main', size: 'small' })])
    await change('元素大小', 'large')
    await change('元素方向', 'right')
    await change('元素层次', 'back')
    expect(currentDraft().design.elements[0]).toMatchObject({ size: 'large', direction: 'right', layer: 'back' })
    await click('字章')
    const data = { getData: (type: string) => type === 'application/x-rabbit-asset' ? JSON.stringify({ kind: 'word-stamp', assetId: 'welcome' }) : '' }
    await act(async () => { fireEvent.drop(screen.getByRole('button', { name: '放置到字章位' }), { dataTransfer: data }); await context.tick() })
    expect(currentDraft().design.elements).toHaveLength(2)
    expect(currentDraft().stage).toBe('assembling')
    await click('固定组装')
    expect(currentDraft().stage).toBe('crafting')
    expect(screen.getByLabelText('当前卡片')).toBeInTheDocument()
  })

  it('measures stamp placement and held pressure instead of granting a preset result', async () => {
    const test = await mount('stamp')
    await selectCraft(test.requirement!)
    await change('落章位置', '50')
    await act(async () => { fireEvent.pointerDown(screen.getByRole('button', { name: '按住盖章' })) })
    const active = currentDraft()
    expect(active.stage === 'crafting' && active.activeCraft?.status).toBe('in_progress')
    await test.at(START + 1_000)
    await act(async () => { fireEvent.pointerUp(screen.getByRole('button', { name: '松开印章' })) })
    expect(currentDraft().design.crafts[0]).toMatchObject({ kind: 'stamp', measurements: { position: .5, pressure: .5 } })
    expect(screen.getByLabelText('当前卡片')).toHaveTextContent(/压力.*50/)
  })

  it('requires a fresh complete premium blank when changing a cut card shape', async () => {
    await mount()
    await click(/^2 备料台/)
    await click('丁香紫')
    await click('票券卡')
    await click('暖心迎宾')
    await click('裁出卡胚')
    expect(context.run!.materials.stock['pearl-paper'].consumed).toBe(1)
    await click('吊牌卡')
    expect(context.run!.materials.stock['pearl-paper']).toMatchObject({ consumed: 1, reserved: 1 })
    expect(currentDraft().stage).toBe('preparing')
    await click('裁出卡胚')
    expect(context.run!.materials.stock['pearl-paper'].consumed).toBe(2)
    expect(context.run!.materials.stock['shaped-blank'].consumed).toBe(2)
  })

  it('keeps unchanged paper choices and explains an exhausted replacement material', async () => {
    await mount()
    await click(/^2 备料台/)
    await click('丁香紫')
    await click('票券卡')
    await click('暖心迎宾')
    await click('裁出卡胚')
    await click('丁香紫')
    expect(currentDraft().stage).toBe('assembling')
    await click('吊牌卡')
    await click('裁出卡胚')
    await click('横卡')
    expect(screen.getByRole('alert')).toHaveTextContent('珠光卡纸')
    expect(currentDraft().design.preparation.shapeId).toBe('tag')
    expect(currentDraft().stage).toBe('assembling')
  })

  it('captures the moving trim ruler at the player cut and preserves the chosen line', async () => {
    const test = await mount('trim')
    await selectCraft(test.requirement!)
    await change('裁边线位置', '50')
    await click('启动裁边尺')
    await test.at(START + 1_000)
    await click('落刀裁边')
    expect(currentDraft().design.crafts[0]).toMatchObject({ kind: 'trim', measurements: { position: .5, length: .5 } })
    expect(screen.getByLabelText('当前卡片')).toHaveTextContent(/长度.*50/)
  })

  it('holds the stamp clock through a controlled pause and supports keyboard pressing', async () => {
    const test = await mount('stamp')
    await selectCraft(test.requirement!)
    await change('落章位置', '50')
    await act(async () => { fireEvent.keyDown(screen.getByRole('button', { name: '按住盖章' }), { key: ' ' }) })
    await test.at(START + 500)
    await test.send({ type: 'pause', reason: 'story' })
    await test.at(START + 10_500)
    await test.send({ type: 'resume' })
    await test.at(START + 11_000)
    await act(async () => { fireEvent.keyUp(screen.getByRole('button', { name: '松开印章' }), { key: ' ' }) })
    expect(currentDraft().design.crafts[0].measurements.pressure).toBe(.5)
  })

  it('consumes ribbon at the first fixed end, does not refund on cancel, and charges fresh material on redo', async () => {
    const test = await mount('ribbon')
    await selectCraft(test.requirement!)
    expect(context.run!.materials.stock['special-ribbon']).toMatchObject({ consumed: 0, reserved: 1 })
    await change('缎带颜色', 'blue')
    await change('缎带长度', '50')
    await change('左端位置', '15')
    await click('固定左端')
    await test.remount()
    expect(screen.getByLabelText('缎带颜色')).toHaveValue('blue')
    expect(context.run!.materials.stock['special-ribbon']).toMatchObject({ consumed: 1, reserved: 0 })
    await click('放弃本次工艺')
    expect(context.run!.materials.stock['special-ribbon'].consumed).toBe(1)
    await selectCraft(test.requirement!)
    await change('缎带颜色', 'blue')
    await change('缎带长度', '50')
    await change('左端位置', '15')
    await click('固定左端')
    await change('右端位置', '85')
    await click('固定右端并收好')
    expect(currentDraft().design.crafts[0]).toMatchObject({ kind: 'ribbon', measurements: { position: .5, length: .5 }, discrete: { color: 'blue', startPosition: '0.15', endPosition: '0.85' } })
    expect(context.run!.materials.stock['special-ribbon'].consumed).toBe(2)
    expect(screen.getByLabelText('当前卡片')).toHaveTextContent(/蓝/)
    expect((await test.store.loadCurrent())!.run.materials.stock['special-ribbon'].consumed).toBe(2)
  })

  it('records brushed foil coverage and penalizes visible overflow', async () => {
    const test = await mount('foil')
    await selectCraft(test.requirement!)
    const cells = screen.getAllByRole('button', { name: /烫金第.*目标区/ })
    for (const cell of cells) await act(async () => { fireEvent.click(cell); await context.tick() })
    expect(context.run!.materials.stock['foil-sheet'].consumed).toBe(1)
    await click(/烫金第1格 边缘/)
    await click('揭下烫金纸')
    expect(currentDraft().design.crafts[0]).toMatchObject({ kind: 'foil', measurements: { coverage: .95 }, discrete: { overflow: '0.05' } })
    expect(screen.getByLabelText('当前卡片')).toHaveTextContent(/越界/)
  })

  it('records wax color, seal and the actual held press duration', async () => {
    const test = await mount('wax')
    await selectCraft(test.requirement!)
    await change('蜡封颜色', 'blue')
    await change('蜡封图案', 'star')
    await change('蜡封位置', '50')
    await act(async () => { fireEvent.pointerDown(screen.getByRole('button', { name: '倒蜡并按章' })) })
    expect(context.run!.materials.stock.wax.consumed).toBe(1)
    await test.at(START + 1_000)
    await act(async () => { fireEvent.pointerUp(screen.getByRole('button', { name: '松开印章' })) })
    expect(currentDraft().design.crafts[0]).toMatchObject({ kind: 'wax', measurements: { position: .5, time: .5 }, discrete: { color: 'blue', stamp: 'star' } })
    expect(screen.getByLabelText('当前卡片')).toHaveTextContent(/按压/)
  })

  it('spends one complete five-second inspection, displays every issue, and marks old reports after editing', async () => {
    await mount()
    await click(/^5 检查台/)
    await click('完整检查 · 5 秒')
    expect(context.run!.inspectionsRemaining).toBe(2)
    expect(context.run!.lastProcessedAtMs).toBe(START + 5_000)
    const report = screen.getByRole('article', { name: '检查记录 1' })
    expect(within(report).getByText('卡纸颜色与订单不同')).toBeInTheDocument()
    expect(within(report).getByText('还缺少订单中的必需内容')).toBeInTheDocument()
    expect(within(report).getAllByRole('listitem')).toHaveLength(new Set(currentDraft().inspections[0].issues.map(issue => issue.code)).size)
    await click(/^2 备料台/)
    await click('樱花粉')
    await click(/^5 检查台/)
    expect(screen.getByText('修改前的检查')).toBeInTheDocument()
    expect(context.run!.inspectionsRemaining).toBe(2)
    expect(document.body.textContent).not.toMatch(/\b(?:JSON|API|token|field|log|payload|schema)\b/i)
  })
})
