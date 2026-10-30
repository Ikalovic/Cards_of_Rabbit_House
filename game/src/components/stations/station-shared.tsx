import { useEffect, useRef, type ReactNode } from 'react'
import { useAudio } from '../../app/AudioProvider'
import { useShift } from '../../app/ShiftProvider'
import { BORDERS, DECORATIONS, MATERIALS, MOTIFS, WORD_STAMPS } from '../../content/production'
import type { CatalogItem, CraftDimension, CraftKind, ElementKind, MaterialCost, ProductionDraft, ShiftRun } from '../../domain/shift-types'

export const ELEMENT_CATALOGS: Record<ElementKind, readonly CatalogItem[]> = { motif: MOTIFS, 'word-stamp': WORD_STAMPS, decoration: DECORATIONS, border: BORDERS }
export const KIND_NAMES: Record<ElementKind, string> = { motif: '主体', 'word-stamp': '字章', decoration: '装饰', border: '边框' }
export const MATERIAL_NAMES = { smooth: '平滑纸', textured: '纹理纸', pearl: '珠光纸', linen: '棉麻纸', kraft: '牛皮纸' }
export const CRAFT_NAMES: Record<CraftKind, string> = { stamp: '盖章', trim: '裁边', ribbon: '贴缎带', foil: '烫金', wax: '蜡封' }
export const DIMENSION_NAMES: Record<CraftDimension, string> = { position: '位置', pressure: '压力', length: '长度', time: '按压', coverage: '有效覆盖' }
export const DISCRETE_NAMES: Record<string, string> = { blue: '蓝色', cream: '奶油色', pink: '樱花粉', red: '朱红色', star: '星形', rabbit: '兔兔', flower: '花朵' }
export function costLabel(costs: readonly MaterialCost[]): string {
  return costs.length ? costs.map(cost => `${MATERIALS.find(item => item.id === cost.materialId)?.label ?? '材料'} ×${cost.quantity}`).join('、') : '普通材料不限量'
}
export function useStationDraft() {
  const context = useShift()
  const draft: ProductionDraft | undefined = context.run ? Object.values(context.run.drafts).filter(item => item.orderId === context.selectedOrderId).sort((a, b) => b.revision - a.revision)[0] : undefined
  return { ...context, draft }
}

/** Compare accepted domain changes, rather than treating a resolved dispatch as success. */
export function useStationAudio(run: ShiftRun | null, draft: ProductionDraft | undefined) {
  const { playSfx } = useAudio()
  const previous = useRef<{ runId: string; draft: ProductionDraft } | null>(null)
  useEffect(() => {
    const before = previous.current
    previous.current = run && draft ? { runId: run.id, draft } : null
    if (!run || !draft || !before || run.status !== 'running' || before.runId !== run.id
      || before.draft.orderId !== draft.orderId) return
    const old = before.draft
    if (run.station === 'preparation') {
      if (JSON.stringify(old.design.preparation) !== JSON.stringify(draft.design.preparation)) playSfx('paper_pick')
      if (old.stage === 'preparing' && draft.stage === 'assembling') playSfx('paper_cut')
    } else if (run.station === 'assembly') {
      if (JSON.stringify(old.design.elements) !== JSON.stringify(draft.design.elements)) {
        playSfx(draft.design.elements.length < old.design.elements.length ? 'paper_pick' : 'piece_place')
      } else if (old.stage === 'assembling' && draft.stage === 'crafting') playSfx('piece_place')
    } else if (run.station === 'craft') {
      const completed = draft.design.crafts.find(craft => !old.design.crafts.some(previous => previous.id === craft.id))
      if (completed?.kind === 'trim') playSfx('paper_cut')
      if (completed?.kind === 'ribbon') playSfx('ribbon_fix')
      if (completed?.kind === 'foil') playSfx('foil_peel')
      const active = draft.stage === 'crafting' ? draft.activeCraft : null
      const oldActive = old.stage === 'crafting' ? old.activeCraft : null
      if (active?.kind === 'ribbon' && active.progress.completedSteps.includes('left-end')
        && (!oldActive || oldActive.operationId !== active.operationId || !oldActive.progress.completedSteps.includes('left-end'))) {
        playSfx('ribbon_fix')
      }
    } else if (run.station === 'inspection' && draft.inspections.length > old.inspections.length) {
      playSfx('inspection_open')
    } else if (run.station === 'print' && draft.stage === 'archived'
      && (old.stage !== 'archived' || old.snapshotId !== draft.snapshotId)) {
      // Archive is only published by ShiftProvider after its durable save succeeds.
      playSfx('archive_success')
    }
  }, [draft, playSfx, run])
}
export function EmptyStation() { return <div className="station-empty"><span aria-hidden="true">☕</span><h3>先迎接一位客人吧</h3><p>在左侧接下订单，或从右侧挑选正在制作的卡片。</p></div> }
export function StationNext({ station, children }: { station: 'preparation' | 'assembly' | 'craft' | 'inspection' | 'print'; children: ReactNode }) {
  const { dispatch, run } = useShift()
  return <button className="station-secondary" disabled={run?.status !== 'running'} onClick={() => { void dispatch({ type: 'switch-station', station }) }}>{children} →</button>
}
