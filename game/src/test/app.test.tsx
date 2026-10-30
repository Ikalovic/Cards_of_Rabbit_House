import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../app/App'
import { createInitialShiftProgression, recordShiftResult } from '../app/progression'
import { AUTHORED_STAGES, generateSurvivalStage } from '../content/production'
import { STORY_STAGES, TUTORIAL_INTERVENTIONS } from '../content/story'
import { advanceShift, initializeShift, transitionShift } from '../domain/shift-engine'
import type { OrderEvaluation, PrintReceipt, ShiftRun, ShiftSnapshot, StageDefinition } from '../domain/shift-types'
import { TUTORIAL_STATION_TRIGGERS } from '../domain/shift-types'
import { BrowserCardLibrary, BrowserPrintShop } from '../infrastructure/browser-store'
import { BrowserShiftStore } from '../infrastructure/shift-store'

const START = 1_000_000
const clock = () => START

/** A complete persisted handoff fixture, with all archive / intent / task references. */
function passedShift(stage: StageDefinition, id: string): ShiftRun {
  const initial = initializeShift(stage, id, START - 720_000)
  const drafts: Record<string, ShiftRun['drafts'][string]> = {}
  const snapshots: Record<string, ShiftRun['snapshots'][string]> = {}
  const authorizations: Record<string, ShiftRun['authorizations'][string]> = {}
  const tasks: Record<string, ShiftRun['tasks'][string]> = {}
  const evaluation: OrderEvaluation = { accuracy: 40, preferences: 10, quality: 10, printing: 15, timeliness: 5,
    rawScore: 80, score: 80, grade: 'A', satisfied: true, missingRequiredIds: [], tabooViolated: false, advice: [] }
  const orders = initial.orders.map((order, index) => {
    const draftId = `draft-${index}`, snapshotId = `card-${index}`, intentId = `intent-${index}`, taskId = `task-${index}`
    const design = { version: 1 as const, preparation: order.content.requirements, elements: [], crafts: [] }
    drafts[draftId] = { id: draftId, shiftRunId: id, orderId: order.id, revision: 1, derivedFromSnapshotId: null, design,
      reservationIds: [], inspections: [], stage: 'archived', snapshotId }
    snapshots[snapshotId] = { kind: 'production-card', version: 1, id: snapshotId, shiftRunId: id, orderId: order.id,
      draftId, draftRevision: 1, savedAtMs: order.arrivalAtMs, design }
    authorizations[intentId] = { id: intentId, shiftRunId: id, orderId: order.id, snapshotId, confirmedAtMs: order.arrivalAtMs,
      nextAttempt: 2, status: 'bound', machineId: 'quick', taskId, receipt: { status: 'accepted', receiptId: `receipt-${index}`, intentId,
        snapshotId, machineId: 'quick', shiftRunId: id, receivedAtMs: order.arrivalAtMs, authority: 'local', details: null, taskId } }
    tasks[taskId] = { id: taskId, intentId, snapshotId, orderId: order.id, shiftRunId: id, machineId: 'quick', createdAtMs: order.arrivalAtMs,
      durationMs: 45_000, expedited: false, status: 'delivered', readyAtMs: order.arrivalAtMs + 45_000, deliveredAtMs: order.arrivalAtMs + 50_000 }
    return { ...order, position: 'closed' as const, acceptedAtMs: order.arrivalAtMs,
      outcome: { status: 'delivered' as const, taskId, deliveredAtMs: order.arrivalAtMs + 50_000, evaluation } }
  })
  return advanceShift({ ...initial, orders, drafts, snapshots, snapshotIds: Object.keys(snapshots), authorizations, tasks }, START)
}

function withPendingReceipt(run: ShiftRun): ShiftRun {
  const orderId = run.orders[0].id
  const archive = Object.values(run.snapshots).find(card => card.orderId === orderId)!
  const context = { intentId: 'late-intent', shiftRunId: run.id, orderId, machineId: 'quick' as const }
  return { ...run, pendingReconciliationIntentIds: ['late-intent'], authorizations: { ...run.authorizations,
    'late-intent': { ...context, id: 'late-intent', snapshotId: archive.id, confirmedAtMs: START - 100,
      nextAttempt: 2, status: 'calibrated_pending_start', reservationId: 'late-reservation', puzzleId: 'late-puzzle', calibratedAtMs: START - 50 } },
    puzzles: { ...run.puzzles, 'late-puzzle': { ...context, id: 'late-puzzle', attempt: 1,
      startedAtMs: START - 100, deadlineAtMs: START + 100,
      definition: { kind: 'number-search', grid: [1, 2], columns: 2, target: 1 },
      result: { status: 'succeeded', submittedAtMs: START - 50, answer: { kind: 'number-search', index: 0 } } } },
    printers: { ...run.printers, quick: { ...run.printers.quick, reservations: [
      { ...context, id: 'late-reservation', puzzleId: 'late-puzzle', status: 'calibrated_pending_start', calibratedAtMs: START - 50 },
    ] } },
  }
}

async function openStory() {
  const start = await screen.findByRole('button', { name: '剧情经营' })
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  await screen.findByRole('heading', { name: STORY_STAGES.tutorial.title })
}

async function readOpening() {
  for (let i = 1; i < STORY_STAGES.tutorial.opening.length; i += 1) fireEvent.click(screen.getByRole('button', { name: '下一句' }))
  fireEvent.click(screen.getByRole('button', { name: '开门营业' }))
  await screen.findByRole('main', { name: '制卡工作台' })
}

async function openCollection() {
  fireEvent.click(screen.getByRole('button', { name: '回到店门' }))
  fireEvent.click(await screen.findByRole('button', { name: '自由工坊' }))
  await screen.findByRole('heading', { name: '制卡桌' })
  fireEvent.click(screen.getByRole('button', { name: '翻开卡册' }))
  await screen.findByRole('heading', { name: 'StampBook' })
  fireEvent.click(await screen.findByRole('button', { name: /值班纪念 01/ }))
  expect(screen.getByRole('figure', { name: '当前卡片' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '继续修改' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /送去冲印/ })).not.toBeInTheDocument()
}

describe('App production flow', () => {
  it('adopts already archived artwork from an older open save before the player enters the workshop', async () => {
    const store = new BrowserShiftStore()
    const initial = initializeShift(AUTHORED_STAGES.tutorial, 'older-open-archive', START)
    const artwork = passedShift(AUTHORED_STAGES.tutorial, initial.id)
    const run: ShiftRun = { ...initial, drafts: { 'draft-0': artwork.drafts['draft-0'] },
      snapshots: { 'card-0': artwork.snapshots['card-0'] }, snapshotIds: ['card-0'] }
    await store.saveCurrent({ version: 1, revision: 1, savedAtMs: START, run })
    render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '剧情经营' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
    await screen.findByRole('heading', { name: '制卡桌' })
    fireEvent.click(screen.getByRole('button', { name: '翻开卡册' }))
    expect(await screen.findByRole('button', { name: /值班纪念 01/ })).toBeEnabled()
    expect(await store.listFinished()).toEqual([])
  })
  it('lets a departed customer draft continue in the workshop with an explicit preview of conversion limits', async () => {
    const store = new BrowserShiftStore()
    let run = initializeShift(AUTHORED_STAGES.tutorial, 'unfinished-keepsake', START)
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    const draft = Object.values(run.drafts)[0]
    run = { ...run, drafts: { [draft.id]: { ...draft, stage: 'crafting', activeCraft: null, design: { version: 1,
      preparation: { ...run.orders[0].content.requirements, paperMaterialId: 'textured', shapeId: 'square' },
      elements: [
        { id: 'kept-rabbit', assetId: 'rabbit', kind: 'motif', slotId: 'main', size: 'medium', direction: 'left', layer: 'front' },
        { id: 'kept-word', assetId: 'welcome', kind: 'word-stamp', slotId: 'title', size: 'medium', direction: 'upright', layer: 'front' },
        { id: 'original-border', assetId: 'gilded', kind: 'border', slotId: 'frame', size: 'medium', direction: 'upright', layer: 'back' },
      ], crafts: [{ id: 'original-stamp', requirementId: 'stamp', kind: 'stamp', completedAtMs: START,
        measurements: { position: .5, pressure: .5 }, discrete: {} }],
    } } } }
    run = advanceShift(run, run.deadlineAtMs)
    if (run.status !== 'settled') throw new Error('Fixture must be closed')
    await store.saveCurrent({ version: 1, revision: 1, savedAtMs: run.deadlineAtMs, run })
    await store.recordSettlement(run.result, recordShiftResult)
    render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '剧情经营' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
    await screen.findByRole('heading', { name: '制卡桌' })
    fireEvent.click(screen.getByRole('button', { name: '翻开卡册' }))
    await screen.findByRole('heading', { name: '未完成的心意' })
    fireEvent.click(screen.getByRole('button', { name: /心爱的兔兔欢迎卡/ }))
    expect(screen.getByText(/鎏金边框/)).toBeInTheDocument()
    expect(screen.getByText(/横向平卡/)).toBeInTheDocument()
    expect(screen.getByText(/已做的盖章工艺效果/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '带入自由工坊继续制作' }))
    expect(screen.getByRole('heading', { name: '制卡桌' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择小兔' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择欢迎光临' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收入 StampBook' }))
    await screen.findByRole('heading', { name: 'StampBook' })
    const [card] = await new BrowserCardLibrary().list()
    expect(card.commissionId).toBeUndefined()
    expect(card.design).toMatchObject({ paperId: 'pink', layers: [{ assetId: 'rabbit', rotation: -15 }, { text: '欢迎光临' }] })
    expect(await store.loadCurrent()).toMatchObject({ run: { drafts: run.drafts, status: 'settled' } })
    expect(await new BrowserPrintShop().list()).toEqual([])
  })
  it('preserves old earned milestones when upgrading a profile before cosmetic IDs existed', async () => {
    const store = new BrowserShiftStore()
    await store.saveProgression({ ...createInitialShiftProgression(), highestSurvivalDay: 5, highestDailyScore: 85 })
    render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '剧情经营' })).toBeEnabled())
    expect((await new BrowserShiftStore().loadProgression()).unlockedCosmeticIds).toEqual([
      'paper-cotton', 'ribbon-rose', 'book-botanical', 'note-chino',
    ])
  })

  it('archives into the collection before closing and lets the player retry an atomic save failure', async () => {
    const store = new BrowserShiftStore()
    let run = initializeShift(AUTHORED_STAGES.tutorial, 'live-archive', START)
    run = transitionShift(run, { station: 'reception', type: 'accept-order', orderId: run.orders[0].id }, START)
    const draft = Object.values(run.drafts)[0]
    run = { ...run, station: 'print', seenTutorialTriggers: Object.values(TUTORIAL_STATION_TRIGGERS),
      drafts: { [draft.id]: { ...draft, stage: 'crafting', activeCraft: null,
        design: { version: 1, preparation: run.orders[0].content.requirements, elements: [], crafts: [] } } } }
    await store.saveCurrent({ version: 1, revision: 1, savedAtMs: START, run })
    vi.spyOn(store, 'saveArchive').mockRejectedValueOnce(new Error('Temporary archive failure'))
    render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '继续值班' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '继续值班' }))
    fireEvent.click(await screen.findByRole('button', { name: '收入 StampBook' }))
    await screen.findByText('营业记录暂时没能记好。请保留这个页面，稍后操作时会再次尝试。')
    expect(screen.queryByRole('button', { name: '已收入 StampBook' })).not.toBeInTheDocument()
    expect(await store.listCollectedCards()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '收入 StampBook' }))
    await screen.findByRole('button', { name: '已收入 StampBook' })
    expect(await store.listFinished()).toEqual([])
    await openCollection()
    expect(screen.getByRole('button', { name: /值班纪念 01/ })).toBeInTheDocument()
  })

  it('shows earned survival rewards and applies the cosmetic styles in the workshop and collection', async () => {
    const store = new BrowserShiftStore()
    await store.saveProgression({ ...createInitialShiftProgression(), highestSurvivalDay: 5, highestDailyScore: 85,
      unlockedCosmeticIds: ['paper-cotton', 'ribbon-rose', 'book-botanical', 'note-chino'] })
    render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '剧情经营' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
    await screen.findByRole('heading', { name: '制卡桌' })
    expect(screen.getByText('棉絮纸纹')).toBeInTheDocument()
    expect(screen.getByText('玫瑰缎带')).toBeInTheDocument()
    expect(screen.getByTestId('card-surface').closest('.cosmetic-paper-cotton')).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '装饰' }))
    fireEvent.click(screen.getByRole('button', { name: '添加缎带' }))
    expect(screen.getByRole('button', { name: '选择缎带' })).toHaveAttribute('data-asset-id', 'ribbon')
    fireEvent.click(screen.getByRole('button', { name: '翻开卡册' }))
    await screen.findByRole('heading', { name: 'StampBook' })
    expect(screen.getByRole('main').closest('.cosmetic-book-botanical')).not.toBeNull()
    expect(screen.getByText('每一张用心做好的卡片，我都有好好看见。明天也一起加油吧。')).toBeInTheDocument()
  })
  it('clears a collection loading error when returning to the workshop', async () => {
    const store = new BrowserShiftStore()
    vi.spyOn(store, 'listCollectedCards').mockRejectedValueOnce(new Error('Unavailable'))
    render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '自由工坊' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
    await screen.findByRole('heading', { name: '制卡桌' })
    fireEvent.click(screen.getByRole('button', { name: '翻开卡册' }))
    await screen.findByText('值班纪念暂时没能取出来。')
    fireEvent.click(screen.getByRole('button', { name: '← 回到制卡桌' }))
    expect(screen.getByRole('heading', { name: '制卡桌' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the authored title and keeps survival locked on a fresh profile', async () => {
    render(<App now={clock} scheduleTick={null} />)
    expect(screen.getByRole('heading', { name: 'Rabbit House 手作值班' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生存天梯' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '直接开始值班' })).not.toBeInTheDocument()
    await openStory()
    expect(screen.getByText(STORY_STAGES.tutorial.opening[0].text)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '接受委托' })).not.toBeInTheDocument()
  })

  it('enters the Free Workshop from a fresh profile and saves before explicit print confirmation', async () => {
    render(<App now={clock} scheduleTick={null} />)
    fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
    await screen.findByRole('heading', { name: '制卡桌' })
    expect(screen.queryByText('当班剩余')).not.toBeInTheDocument()
    expect(await new BrowserShiftStore().loadCurrent()).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: '收入 StampBook' }))
    await screen.findByRole('heading', { name: 'StampBook' })
    fireEvent.click(screen.getByRole('button', { name: /送去冲印/ }))
    expect(screen.getByRole('heading', { name: '冲印前确认' })).toBeInTheDocument()
    expect(await new BrowserPrintShop().list()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '确认冲印' }))
    await waitFor(async () => expect(await new BrowserPrintShop().list()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '回到店门' }))
    expect(await screen.findByRole('button', { name: '自由工坊' })).toBeEnabled()
  })

  it('opens the fixed tutorial only after dialogue and pauses the short teaching overlay', async () => {
    const store = new BrowserShiftStore()
    render(<App store={store} now={clock} scheduleTick={null} />)
    await openStory()
    expect(await store.loadCurrent()).toBeUndefined()
    expect(screen.queryByRole('button', { name: '跳过已读对白' })).not.toBeInTheDocument()
    await readOpening()
    await waitFor(async () => expect((await store.loadCurrent())?.run.seed).toBe(AUTHORED_STAGES.tutorial.seed))
    await screen.findByRole('heading', { name: '值班小提醒' })
    fireEvent.click(screen.getByRole('button', { name: '记住了，继续制作' }))
    await waitFor(async () => expect((await store.loadCurrent())?.run.status).toBe('running'))
  })

  it('continues the exact saved shift and transitions to settlement when its clock closes', async () => {
    const store = new BrowserShiftStore()
    const run = { ...initializeShift(AUTHORED_STAGES.tutorial, 'existing-shift', START), seenTutorialTriggers: ['read_order'] as const }
    await store.saveCurrent({ version: 1, revision: 1, savedAtMs: START, run })
    let now = START + 20_000
    let tick: (() => void) | undefined
    const scheduler = (callback: () => void) => { tick = callback; return () => {} }
    render(<App store={store} now={() => now} scheduleTick={scheduler} />)
    const button = screen.getByRole('button', { name: '继续值班' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await screen.findByRole('main', { name: '制卡工作台' })
    expect((await store.loadCurrent())?.run.id).toBe('existing-shift')
    now = run.deadlineAtMs
    await act(async () => { tick?.() })
    await screen.findByRole('heading', { name: '今天先歇一歇' })
    await waitFor(() => expect(screen.getByRole('button', { name: '再试这一班' })).toBeEnabled())
    expect((await store.loadProgression()).completedAuthoredStages).toEqual([])
    expect(await store.listFinished()).toHaveLength(1)
  })

  it('retries the same failed fixed stage and preserves archived cards and one settlement', async () => {
    const store = new BrowserShiftStore()
    const initial = initializeShift(AUTHORED_STAGES.tutorial, 'failed-shift', START - 720_000)
    const artwork = passedShift(AUTHORED_STAGES.tutorial, initial.id)
    const failed = advanceShift({ ...initial, drafts: { 'draft-0': artwork.drafts['draft-0'] },
      snapshots: { 'card-0': artwork.snapshots['card-0'] }, snapshotIds: ['card-0'] }, START)
    await store.saveCurrent({ version: 1, revision: 1, savedAtMs: START, run: failed })
    const library = new BrowserCardLibrary()
    const card = await library.save({ requestId: 'archive-workshop', design: { version: 1, paperId: 'cream', layers: [] } })
    const append = vi.spyOn(store, 'recordSettlement')
    render(<App store={store} now={clock} scheduleTick={null} createSeed={() => 'retry-unique'} />)
    const button = screen.getByRole('button', { name: '继续值班' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await screen.findByRole('heading', { name: '今天先歇一歇' })
    expect(screen.getByText(STORY_STAGES.tutorial.endings.fail[0].text)).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: '再试这一班' })
    await waitFor(() => expect(retry).toBeEnabled())
    fireEvent.click(retry)
    await screen.findByRole('heading', { name: STORY_STAGES.tutorial.title })
    expect(screen.getByRole('button', { name: '跳过已读对白' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '跳过已读对白' }))
    await screen.findByRole('main', { name: '制卡工作台' })
    await waitFor(async () => expect((await store.loadCurrent())?.run.id).not.toBe('failed-shift'))
    expect((await store.loadCurrent())?.run.seed).toBe(AUTHORED_STAGES.tutorial.seed)
    expect(await library.list()).toEqual([card])
    expect(append).toHaveBeenCalledTimes(1)
    await openCollection()
    expect(screen.getAllByRole('button', { name: /值班纪念 \d+/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /收藏卡 01/ }))
    expect(screen.getByRole('button', { name: '继续修改' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /送去冲印/ }))
    expect(screen.getByRole('heading', { name: '冲印前确认' })).toBeInTheDocument()
    expect(await new BrowserPrintShop().list()).toHaveLength(0)
  })

  it('starts an unlocked survival run with a stable seed and preserves it while visiting the workshop', async () => {
    const store = new BrowserShiftStore()
    await store.saveProgression({ ...createInitialShiftProgression(), completedAuthoredStages: ['tutorial', 'beginner', 'story'], survivalUnlocked: true })
    const seed = vi.fn(() => 'new-survival-root')
    render(<App store={store} now={clock} scheduleTick={null} createSeed={seed} />)
    const survival = screen.getByRole('button', { name: '生存天梯' })
    await waitFor(() => expect(survival).toBeEnabled())
    fireEvent.click(survival)
    await screen.findByRole('main', { name: '制卡工作台' })
    const current = await store.loadCurrent()
    expect(current?.run.stage.id).toBe('survival:1')
    expect((await store.loadProgression()).survivalRun?.seed).toBe('new-survival-root')
    expect(seed).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '回到店门' }))
    await screen.findByRole('button', { name: '自由工坊' })
    fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
    await screen.findByRole('heading', { name: '制卡桌' })
    expect((await store.loadCurrent())?.run.id).toBe(current?.run.id)
  })

  it.each(['tutorial', 'beginner'] as const)('settles %s once and starts the next authored stage with a new revision', async id => {
    const store = new BrowserShiftStore()
    const run = passedShift(AUTHORED_STAGES[id], `passed-${id}`)
    await store.saveCurrent({ version: 1, revision: 20, savedAtMs: START, run })
    await store.saveProgression({ ...createInitialShiftProgression(), completedAuthoredStages: id === 'beginner' ? ['tutorial'] : [] })
    const append = vi.spyOn(store, 'recordSettlement')
    const mounted = render(<StrictMode><App store={store} now={clock} scheduleTick={null} createSeed={() => 'next-shift'} /></StrictMode>)
    const resume = screen.getByRole('button', { name: '继续值班' })
    await waitFor(() => expect(resume).toBeEnabled())
    fireEvent.click(resume)
    await screen.findByRole('heading', { name: '今天也辛苦了' })
    expect(screen.getByText(STORY_STAGES[id].endings.great[0].text)).toBeInTheDocument()
    const next = screen.getByRole('button', { name: '准备下一班' })
    await waitFor(() => expect(next).toBeEnabled())
    fireEvent.click(next)
    const nextId = id === 'tutorial' ? 'beginner' : 'story'
    await screen.findByRole('heading', { name: STORY_STAGES[nextId].title })
    for (let index = 1; index < STORY_STAGES[nextId].opening.length; index += 1) fireEvent.click(screen.getByRole('button', { name: '下一句' }))
    fireEvent.click(screen.getByRole('button', { name: '开门营业' }))
    await screen.findByRole('main', { name: '制卡工作台' })
    const current = await store.loadCurrent()
    expect(current?.run.stage.id).toBe(nextId)
    expect(current?.run.seed).toBe(AUTHORED_STAGES[nextId].seed)
    expect(current?.revision).toBeGreaterThan(20)
    expect(append).toHaveBeenCalledTimes(1)
    expect(await store.listFinished()).toHaveLength(1)
    await openCollection()
    expect(screen.getAllByRole('button', { name: /值班纪念 \d+/ })).toHaveLength(run.snapshotIds.length)
    mounted.unmount()
    render(<App store={new BrowserShiftStore()} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '自由工坊' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
    await screen.findByRole('heading', { name: '制卡桌' })
    fireEvent.click(screen.getByRole('button', { name: '翻开卡册' }))
    expect(await screen.findByRole('button', { name: /值班纪念 01/ })).toBeEnabled()
    expect(screen.getAllByRole('button', { name: /值班纪念 \d+/ })).toHaveLength(run.snapshotIds.length)
  })

  it('keeps settlement actions unavailable until progression is safely saved and retries without duplicate history', async () => {
    const store = new BrowserShiftStore()
    await store.saveCurrent({ version: 1, revision: 1, savedAtMs: START, run: passedShift(AUTHORED_STAGES.tutorial, 'retry-save') })
    const save = vi.spyOn(store, 'recordSettlement').mockRejectedValueOnce(new Error('Temporarily unavailable'))
    render(<App store={store} now={clock} scheduleTick={null} />)
    const resume = screen.getByRole('button', { name: '继续值班' })
    await waitFor(() => expect(resume).toBeEnabled())
    fireEvent.click(resume)
    await screen.findByRole('button', { name: '再记一次成绩' })
    expect(screen.getByRole('button', { name: '准备下一班' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '再记一次成绩' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '准备下一班' })).toBeEnabled())
    expect(save).toHaveBeenCalledTimes(2)
    expect(await store.listFinished()).toHaveLength(1)
    expect((await store.loadProgression()).completedAuthoredStages).toEqual(['tutorial'])
  })

  it('moves a successful survival settlement to the next day without minting another root seed', async () => {
    const store = new BrowserShiftStore()
    const root = 'two-day-run'
    const stage = generateSurvivalStage(1, root)
    await store.saveProgression({ ...createInitialShiftProgression(), completedAuthoredStages: ['tutorial', 'beginner', 'story'],
      survivalUnlocked: true, survivalRun: { seed: root, nextDay: 1, satisfied: 0 } })
    await store.saveCurrent({ version: 1, revision: 8, savedAtMs: START, run: passedShift(stage, `survival:${root}:day:1`) })
    const seed = vi.fn(() => 'unused')
    render(<App store={store} now={clock} scheduleTick={null} createSeed={seed} />)
    const resume = screen.getByRole('button', { name: '继续值班' })
    await waitFor(() => expect(resume).toBeEnabled())
    fireEvent.click(resume)
    const next = await screen.findByRole('button', { name: '迎接下一营业日' })
    await waitFor(() => expect(next).toBeEnabled())
    expect(screen.getByText(`本日最长连续优质交付：${stage.customers.length} 张 · 历史最佳：${stage.customers.length} 张（同日连续满意且达到 A 或 S）`)).toBeInTheDocument()
    fireEvent.click(next)
    await screen.findByRole('main', { name: '制卡工作台' })
    expect((await store.loadCurrent())?.run.stage).toEqual(generateSurvivalStage(2, root))
    expect((await store.loadProgression()).survivalRun?.nextDay).toBe(2)
    expect(seed).not.toHaveBeenCalled()
    expect((await store.loadProgression()).longestQualityStreak).toBe(stage.customers.length)
  })

  it('waits for the original print receipt before recording or unlocking a provisional pass', async () => {
    const store = new BrowserShiftStore()
    const run = withPendingReceipt(passedShift(AUTHORED_STAGES.story, 'late-conflict'))
    await store.saveCurrent({ version: 1, revision: 1, savedAtMs: START, run })
    await store.saveProgression({ ...createInitialShiftProgression(), completedAuthoredStages: ['tutorial', 'beginner'] })
    let resolveReceipt!: (receipt: Extract<PrintReceipt, { status: 'accepted' }>) => void
    vi.spyOn(store, 'recoverPendingPrint').mockReturnValue(new Promise(resolve => { resolveReceipt = resolve }))
    const record = vi.spyOn(store, 'recordSettlement')
    render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '继续值班' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '继续值班' }))
    await screen.findByText('正在核对最后一张冲印单，确认后再记入营业簿……')
    expect(screen.getByRole('button', { name: '挑战生存天梯' })).toBeDisabled()
    expect(screen.queryByText(/生存天梯已经开放/)).not.toBeInTheDocument()
    expect(record).not.toHaveBeenCalled()
    expect(await store.listFinished()).toHaveLength(0)
    expect((await store.loadProgression()).survivalUnlocked).toBe(false)
    await act(async () => { resolveReceipt({ status: 'accepted', receiptId: 'late-receipt', intentId: 'late-intent',
      snapshotId: run.authorizations['late-intent'].snapshotId, machineId: 'quick', shiftRunId: run.id,
      receivedAtMs: START, authority: 'remote', details: null, taskId: 'task-1' }) })
    await waitFor(() => expect(screen.getByRole('button', { name: '再试这一班' })).toBeEnabled())
    expect(await store.listFinished()).toMatchObject([{ passed: false, failureReasons: ['corrupt-save'] }])
    expect((await store.loadProgression()).survivalUnlocked).toBe(false)
    expect(record).toHaveBeenCalledTimes(1)
  })

  it('restores unseen tutorial explanations and remembers acknowledgements after refresh and title return', async () => {
    const store = new BrowserShiftStore()
    const run: ShiftRun = { ...initializeShift(AUTHORED_STAGES.tutorial, 'resumed-tutorial', START),
      station: 'preparation', seenTutorialTriggers: ['read_order'] }
    await store.saveCurrent({ version: 1, revision: 1, savedAtMs: START, run })
    const first = render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '继续值班' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '继续值班' }))
    await screen.findByRole('dialog')
    expect(screen.getByText(TUTORIAL_INTERVENTIONS.find(line => line.trigger === 'choose_materials')!.text)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '记住了，继续制作' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '记住了，继续制作' }))
    await waitFor(async () => expect((await store.loadCurrent())?.run.seenTutorialTriggers).toEqual(['read_order', 'choose_materials']))
    first.unmount()
    render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '继续值班' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '继续值班' }))
    await screen.findByRole('main', { name: '制卡工作台' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const assembly = screen.getByRole('button', { name: '3 组装台' })
    assembly.focus()
    fireEvent.click(assembly)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: '记住了，继续制作' }))
    await waitFor(() => expect(assembly).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: '回到店门' }))
    await screen.findByRole('button', { name: '继续值班' })
    fireEvent.click(screen.getByRole('button', { name: '继续值班' }))
    await screen.findByRole('main', { name: '制卡工作台' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['completed', 'failed'] as const)('offers skip-seen dialogue from persisted %s progress after refresh', async state => {
    const store = new BrowserShiftStore()
    const failed = advanceShift(initializeShift(AUTHORED_STAGES.tutorial, 'seen-failure', START - 720_000), START)
    if (failed.status !== 'settled') throw new Error('Expected settlement')
    await store.saveProgression({ ...createInitialShiftProgression(),
      ...(state === 'completed' ? { completedAuthoredStages: ['tutorial', 'beginner', 'story'] as const, survivalUnlocked: true }
        : { results: [failed.result] }) })
    render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '剧情经营' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '剧情经营' }))
    expect(await screen.findByRole('button', { name: '跳过已读对白' })).toBeEnabled()
  })

  it('keeps Free Workshop disabled during a deferred title action', async () => {
    const store = new BrowserShiftStore()
    render(<App store={store} now={clock} scheduleTick={null} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '剧情经营' })).toBeEnabled())
    let resolveLoad!: (snapshot: ShiftSnapshot | undefined) => void
    vi.spyOn(store, 'loadCurrent').mockReturnValueOnce(new Promise(resolve => { resolveLoad = resolve }))
    fireEvent.click(screen.getByRole('button', { name: '剧情经营' }))
    expect(screen.getByRole('button', { name: '自由工坊' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '自由工坊' }))
    expect(screen.queryByRole('heading', { name: '制卡桌' })).not.toBeInTheDocument()
    await act(async () => { resolveLoad(undefined) })
    await screen.findByRole('heading', { name: STORY_STAGES.tutorial.title })
  })

  it('shares the winning survival root when two tabs start the same new run', async () => {
    const firstStore = new BrowserShiftStore(), secondStore = new BrowserShiftStore()
    await firstStore.saveProgression({ ...createInitialShiftProgression(), completedAuthoredStages: ['tutorial', 'beginner', 'story'], survivalUnlocked: true })
    const firstSeed = vi.fn(() => 'first-tab'), secondSeed = vi.fn(() => 'second-tab')
    const first = render(<App store={firstStore} now={clock} scheduleTick={null} createSeed={firstSeed} />)
    const second = render(<App store={secondStore} now={clock} scheduleTick={null} createSeed={secondSeed} />)
    const firstButton = within(first.container).getByRole('button', { name: '生存天梯' })
    const secondButton = within(second.container).getByRole('button', { name: '生存天梯' })
    await waitFor(() => { expect(firstButton).toBeEnabled(); expect(secondButton).toBeEnabled() })
    fireEvent.click(firstButton)
    fireEvent.click(secondButton)
    await within(first.container).findByRole('main', { name: '制卡工作台' })
    await within(second.container).findByRole('main', { name: '制卡工作台' })
    const progress = await firstStore.loadProgression()
    expect(progress.survivalRun?.seed).toBe('first-tab')
    expect((await secondStore.loadCurrent())?.run.id).toBe('survival:first-tab:day:1')
    expect(firstSeed.mock.calls.length + secondSeed.mock.calls.length).toBe(1)
  })

  it('shows action failures on the opening screen so the player can retry', async () => {
    const store = new BrowserShiftStore()
    render(<App store={store} now={clock} scheduleTick={null} />)
    await openStory()
    vi.spyOn(store, 'loadCurrent').mockRejectedValueOnce(new Error('Temporarily unavailable'))
    for (let index = 1; index < STORY_STAGES.tutorial.opening.length; index += 1) fireEvent.click(screen.getByRole('button', { name: '下一句' }))
    fireEvent.click(screen.getByRole('button', { name: '开门营业' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('营业簿')
    expect(screen.getByRole('button', { name: '开门营业' })).toBeEnabled()
  })
})
