import { useState } from 'react'
import { LAYOUTS, MATERIALS, PAPERS, SHAPES, SURFACE_FINISHES } from '../../content/production'
import type { MaterialCost, PreparationSelection } from '../../domain/shift-types'
import { ProductionCard } from '../ProductionCard'
import { EmptyStation, MATERIAL_NAMES, StationNext, useStationAudio, useStationDraft } from './station-shared'

export function PrepStation() {
  const { draft, dispatch, run } = useStationDraft()
  useStationAudio(run, draft)
  const [materialWarning, setMaterialWarning] = useState<string | null>(null)
  if (!draft || !run) return <EmptyStation />
  const preparation = draft.design.preparation
  const complete = preparation.paperId && preparation.paperMaterialId && preparation.shapeId && preparation.layoutId
  const cut = draft.stage !== 'not_started' && draft.stage !== 'preparing'
  const choose = (selection: Partial<PreparationSelection>) => {
    if (Object.entries(selection).every(([key, value]) => preparation[key as keyof PreparationSelection] === value)) return
    const next = { ...preparation, ...selection }
    if ('paperId' in selection && !('paperMaterialId' in selection)) next.paperMaterialId = PAPERS.find(paper => paper.id === selection.paperId)?.materialId ?? null
    const replaceBlank = cut && ['paperId', 'paperMaterialId', 'shapeId', 'orientation'].some(key => key in selection)
    const costs: MaterialCost[] = []
    if (replaceBlank || 'paperId' in selection || 'paperMaterialId' in selection) {
      if (next.paperMaterialId === 'pearl') costs.push({ materialId: 'pearl-paper', quantity: 1 })
      if (next.paperMaterialId === 'linen') costs.push({ materialId: 'linen-paper', quantity: 1 })
    }
    if (replaceBlank || 'shapeId' in selection) costs.push(...(SHAPES.find(shape => shape.id === next.shapeId)?.materialCosts ?? []))
    const missing = costs.find(cost => run.materials.stock[cost.materialId].available + Object.values(run.materials.reservations).filter(reservation => reservation.draftId === draft.id && reservation.status === 'reserved' && reservation.materialId === cost.materialId && ['paper', 'shape'].includes(reservation.operationId)).reduce((sum, reservation) => sum + reservation.quantity, 0) < cost.quantity)
    if (missing) { setMaterialWarning(`${MATERIALS.find(item => item.id === missing.materialId)?.label ?? '所需材料'}已经用完，无法再裁一张。请换一种材料，或保留当前卡胚。`); return }
    setMaterialWarning(null)
    void dispatch({ station: 'preparation', type: 'select-preparation', draftId: draft.id, selection })
  }
  return <div className="station-stack">
    <p className="station-intro">挑好纸张与卡型，再亲手裁出这一张卡。高级纸张与异形卡胚会在落刀时用掉。</p>
    {materialWarning && <p className="station-warning" role="alert">{materialWarning}</p>}
    <div className="station-prep-layout"><div className="station-prep-controls" data-sound="none">
      <fieldset className="station-fieldset" disabled={run.status !== 'running'}><legend>01 · 选卡纸</legend><div className="station-paper-grid">{PAPERS.map(paper => <button key={paper.id} aria-label={paper.label} aria-pressed={preparation.paperId === paper.id} onClick={() => choose({ paperId: paper.id })}><i style={{ backgroundColor: paper.color }} /><span>{paper.label}</span></button>)}</div>
        <label className="station-label">卡纸材质<select aria-label="卡纸材质" value={preparation.paperMaterialId ?? ''} onChange={event => choose({ paperMaterialId: event.target.value as PreparationSelection['paperMaterialId'] })}><option value="" disabled>请选择材质</option>{Object.entries(MATERIAL_NAMES).map(([id, name]) => <option key={id} value={id}>{name}{id === 'pearl' ? ` · 库存 ${run.materials.stock['pearl-paper'].available}` : id === 'linen' ? ` · 库存 ${run.materials.stock['linen-paper'].available}` : ''}</option>)}</select></label>
      </fieldset>
      <fieldset className="station-fieldset" disabled={run.status !== 'running'}><legend>02 · 选卡型</legend><div className="station-shapes">{SHAPES.map(shape => <button key={shape.id} aria-pressed={preparation.shapeId === shape.id} onClick={() => choose({ shapeId: shape.id })}><i className={`station-shape station-shape-${shape.id}`} /><span>{shape.label}</span></button>)}</div><label className="station-label">成品方向<select aria-label="成品方向" value={preparation.orientation} onChange={event => choose({ orientation: event.target.value as PreparationSelection['orientation'] })}><option value="landscape">横向</option><option value="portrait">竖向</option></select></label></fieldset>
    </div><div className="station-paper-preview"><ProductionCard design={draft.design} /><p>当前试样 · {cut ? '卡胚已裁好' : '尚未裁切'}</p></div></div>
    <fieldset className="station-fieldset" disabled={run.status !== 'running'}><legend>03 · 选版式</legend><div className="station-layout-grid">{LAYOUTS.map(layout => <button data-sound="none" key={layout.id} aria-label={layout.label} aria-pressed={preparation.layoutId === layout.id} onClick={() => choose({ layoutId: layout.id })}><span className="station-layout-mini" aria-hidden="true">{layout.slots.filter(slot => slot.id !== 'frame').map(slot => <i key={slot.id} style={{ left: `${slot.x * 100}%`, top: `${slot.y * 100}%`, width: `${slot.width * 70}%`, height: `${slot.height * 70}%` }} />)}</span><span>{layout.label}</span></button>)}</div></fieldset>
    <label className="station-label">表面效果<select aria-label="表面效果" value={preparation.surfaceFinishId} onChange={event => choose({ surfaceFinishId: event.target.value as PreparationSelection['surfaceFinishId'] })}>{SURFACE_FINISHES.map(finish => <option key={finish.id} value={finish.id}>{finish.label}{finish.materialCosts.length ? ' · 需在工艺台完成' : ''}</option>)}</select></label>
    {cut ? <div className="station-actions"><span>✓ 卡胚已裁好。换纸、卡型或方向会另用一张卡胚，并清空纸上的组装与工艺。</span><StationNext station="assembly">去组装</StationNext></div> : <button data-sound="none" className="station-primary" disabled={!complete || run.status !== 'running'} onClick={() => { void dispatch({ station: 'preparation', type: 'cut-blank', draftId: draft.id }) }}>裁出卡胚</button>}
  </div>
}
