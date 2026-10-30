import { useEffect, useRef, useState } from 'react'
import { useAudio, useAudioDuck } from '../app/AudioProvider'
import { LAYOUTS, isComplexOrder } from '../content/production'
import { STORY_STAGES, type TriggeredStoryLine } from '../content/story'
import { hasCompletedSurfaceFinish } from '../domain/shift-engine'
import type { ShiftRun } from '../domain/shift-types'

function activeTriggers(run: ShiftRun, nowMs: number): Readonly<Record<string, readonly string[]>> {
  const waiting = run.orders.filter(order => order.arrivalAtMs <= nowMs && order.outcome.status === 'pending')
  const active = waiting.filter(order => order.position === 'active')
  const order = active.find(order => order.id === run.selectedOrderId)
  const drafts = active.flatMap(order => Object.values(run.drafts).filter(draft => draft.orderId === order.id).sort((a, b) => b.revision - a.revision).slice(0, 1))
  const draft = drafts.find(draft => draft.orderId === order?.id)
  const missing = order?.content.requirements.elements.filter(required => (draft?.design.elements.filter(element => element.kind === required.kind && element.assetId === required.assetId).length ?? 0) < required.quantity) ?? []
  const report = draft?.inspections.at(-1)
  const issues = report?.draftRevision === draft?.revision ? report?.issues ?? [] : []
  const layout = LAYOUTS.find(layout => layout.id === draft?.design.preparation.layoutId)
  const mismatch = draft?.design.elements.some(element => {
    const slot = layout?.slots.find(slot => slot.id === element.slotId)
    return !slot || !slot.accepts.includes(element.kind) || !slot.sizes.includes(element.size)
      || !slot.directions.includes(element.direction) || !slot.layers.includes(element.layer)
  }) ?? false
  const puzzle = Object.values(run.puzzles).find(puzzle => puzzle.result.status === 'pending' && nowMs <= puzzle.deadlineAtMs
    && run.station === 'print' && puzzle.orderId === order?.id)
  const failed = Object.values(run.puzzles).some(puzzle => puzzle.result.status === 'failed')
  const completedWork = drafts.filter(draft => draft.stage === 'crafting' && draft.activeCraft === null
    && hasCompletedSurfaceFinish(run, draft) && !draft.reservationIds.some(id => run.materials.reservations[id]?.status === 'reserved')
    && (run.orders.find(order => order.id === draft.orderId)?.content.requirements.crafts ?? []).every(required => draft.design.crafts.some(craft => craft.requirementId === required.id)))
  const foil = run.materials.stock['foil-sheet']
  const lastCustomer = run.orders.at(-1)
  const urgent = waiting.filter(order => ['syaro', 'rin', 'yura'].includes(order.content.customer.characterId))
  const door = waiting.filter(order => order.position === 'door_waiting')
  const draftContext = draft ? JSON.stringify([draft.orderId, draft.id]) : undefined
  const reportContext = draft && report ? JSON.stringify([draft.orderId, draft.id, report.id, report.draftRevision]) : undefined
  const groupContext = (ids: readonly string[]) => JSON.stringify([...ids].sort())
  const when = (condition: boolean, context: string | undefined): readonly string[] => condition && context !== undefined ? [context] : []
  return {
    slot_empty: when(run.station === 'assembly' && Boolean(draft?.design.elements.length) && missing.length > 0, draftContext),
    slot_mismatch: when(run.station === 'assembly' && mismatch, draftContext),
    taboo_placed: when(issues.some(issue => issue.code === 'taboo-violated'), reportContext),
    rush_trigger: urgent.map(order => order.id),
    print_fast_math: when(puzzle?.definition.kind === 'number-search', puzzle?.id),
    print_grid_stuck: when(puzzle?.definition.kind === 'sudoku', puzzle?.id),
    inspect_border_miss: when(issues.some(issue => issue.code === 'required-content-missing') && missing.some(required => required.kind === 'border'), reportContext),
    patience_half: active.filter(order => order.patience.phase === 'normal' && order.patience.remainingSeconds <= order.basePatienceSeconds / 2).map(order => order.id),
    station_clogged: active.length >= 3 ? completedWork.map(draft => draft.id) : [],
    'queue-grow': when(door.length >= 2, groupContext(door.map(order => order.id))),
    'switch-press': when(run.station === 'print' && Boolean(order && (isComplexOrder(order.content) || failed)), order?.id),
    'foil-low': when(foil.available <= 1 && foil.consumed > 0, 'foil-sheet'),
    'rush-order': when(active.length >= 3, groupContext(active.map(order => order.id))),
    'client-wait': run.remedies.explainProgressAvailable ? waiting.filter(order => order.remedy === 'none'
      && (order.patience.phase === 'last_wait' || (order.patience.phase === 'normal' && order.patience.remainingSeconds <= order.basePatienceSeconds / 2))).map(order => order.id) : [],
    'machine-hot': Object.values(run.tasks).filter(task => task.status === 'ready' && waiting.some(order => order.id === task.orderId)).map(task => task.id),
    'flavor-boost': run.station === 'craft' && active.length >= 2 ? drafts.flatMap(draft => draft.stage === 'crafting' && draft.activeCraft !== null ? [draft.activeCraft.operationId] : []) : [],
    rush_start: when(active.length >= 2 && door.length > 0, groupContext(waiting.map(order => order.id))),
    order_split: when(active.length >= 2, groupContext(active.map(order => order.id))),
    tight_budget: Object.entries(run.materials.stock).filter(([, stock]) => stock.available <= 1 && stock.consumed > 0).map(([materialId]) => materialId),
    chino_glance: when(active.length >= 3, groupContext(active.map(order => order.id))),
    cocoa_recover: when(failed && (run.station === 'preparation' || run.station === 'assembly'), draftContext),
    precision_pass: drafts.flatMap(draft => {
      const report = draft.inspections.at(-1)
      return report?.draftRevision === draft.revision && report.issues.length === 0
        ? [JSON.stringify([run.selectedOrderId, draft.orderId, draft.id, report.id, report.draftRevision])] : []
    }),
    final_card_prep: when(lastCustomer?.position === 'active' && lastCustomer.outcome.status === 'pending', lastCustomer?.id),
  }
}

function readSeen(key: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

/** Presentation memory only: no business action, clock pause, or puzzle answer is read here. */
export function ShiftChatter({ run, nowMs }: Readonly<{ run: ShiftRun; nowMs: number }>) {
  const { playSfx } = useAudio()
  const spoken = useRef<string | null>(null)
  const storageKey = `rabbit-house:chatter:${run.id}`
  const seen = useRef(new Set(readSeen(storageKey)))
  const [line, setLine] = useState<Readonly<{ copy: TriggeredStoryLine; context: string }> | null>(null)
  const triggers = run.status === 'running' && run.stage.kind === 'authored' ? activeTriggers(run, nowMs) : {}
  const applicable = line !== null && (triggers[line.copy.trigger]?.includes(line.context) ?? false)
  useAudioDuck(applicable)
  useEffect(() => {
    if (line) {
      if (!applicable) setLine(null)
      return
    }
    if (run.status !== 'running' || run.stage.kind !== 'authored') return
    for (const trigger of readSeen(storageKey)) seen.current.add(trigger)
    const next = STORY_STAGES[run.stage.id].midShift.find(candidate => triggers[candidate.trigger]?.length && !seen.current.has(candidate.trigger))
    if (!next) return
    seen.current.add(next.trigger)
    try { localStorage.setItem(storageKey, JSON.stringify([...seen.current])) } catch { /* The current visit still remembers heard lines. */ }
    setLine({ copy: next, context: triggers[next.trigger][0] })
  }, [run, nowMs, line, storageKey, applicable])
  useEffect(() => {
    if (!line) return
    const timeout = window.setTimeout(() => setLine(null), 8_000)
    return () => window.clearTimeout(timeout)
  }, [line])
  useEffect(() => {
    if (!line || !applicable) return
    const id = `${line.copy.trigger}:${line.context}`
    if (spoken.current === id) return
    spoken.current = id
    playSfx('dialogue_open')
  }, [line, applicable, playSfx])
  if (!line || !applicable) return null
  return <aside className="shift-chatter" aria-label="店内闲话" aria-live="polite">
    <strong>{line.copy.speaker}</strong><p>{line.copy.text}</p>
  </aside>
}
