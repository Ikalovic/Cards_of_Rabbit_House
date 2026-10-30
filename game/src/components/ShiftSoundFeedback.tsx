import { useEffect, useRef } from 'react'
import { useAudio } from '../app/AudioProvider'
import type { SfxId } from '../content/audio'
import type { ShiftRun } from '../domain/shift-types'
import { shiftTimeAt } from '../domain/shift-engine'

function events(run: ShiftRun): { id: string; sound: SfxId; atMs: number }[] {
  return [
    ...Object.values(run.tasks).filter(task => task.status === 'ready')
      .flatMap(task => task.status === 'ready' ? [{ id: `ready:${task.id}`, sound: 'machine_ready' as const, atMs: task.readyAtMs }] : []),
    ...run.orders.filter(order => order.arrivalAtMs <= run.lastProcessedAtMs && order.outcome.status === 'pending' && order.patience.phase === 'last_wait')
      .flatMap(order => order.patience.phase === 'last_wait' ? [{ id: `patience:${order.id}`, sound: 'patience_warning' as const, atMs: order.patience.startedAtMs }] : []),
    ...Object.values(run.puzzles).flatMap(puzzle => puzzle.result.status === 'pending' ? [] : [{
      id: `puzzle:${puzzle.id}`,
      sound: puzzle.result.status === 'succeeded' ? 'puzzle_success' as const : 'puzzle_failure' as const,
      atMs: puzzle.result.status === 'succeeded' ? puzzle.result.submittedAtMs : puzzle.result.failedAtMs,
    }]),
    ...Object.values(run.tasks).filter(task => task.status === 'printing')
      .flatMap(task => task.status === 'printing' ? [{ id: `printing:${task.id}`, sound: 'printer_start' as const, atMs: task.startedAtMs }] : []),
    ...run.orders.filter(order => order.arrivalAtMs <= run.lastProcessedAtMs)
      .map(order => ({ id: `arrival:${order.id}`, sound: 'order_arrive' as const, atMs: order.arrivalAtMs })),
    ...run.orders.flatMap(order => order.outcome.status === 'pending' ? [] : [{
      id: `outcome:${order.id}`,
      sound: order.outcome.status === 'left' ? 'customer_leave' as const
        : order.outcome.evaluation.satisfied ? 'delivery_good' as const : 'delivery_okay' as const,
      atMs: order.outcome.status === 'left' ? order.outcome.leftAtMs : order.outcome.deliveredAtMs,
    }]),
  ]
}

/** Presentation only: restored, muted and background events are consumed without replay. */
export function ShiftSoundFeedback({ run }: { run: ShiftRun }) {
  const { playSfx, setLoop, stopEffects, preferences } = useAudio()
  const heard = useRef<{ runId: string; ids: Set<string> } | null>(null)
  const resumedAtWallMs = useRef(-Infinity)
  const currentRun = useRef(run)
  currentRun.current = run
  const printing = Object.values(run.tasks).some(task => task.status === 'printing')

  useEffect(() => {
    let wasHidden = document.visibilityState === 'hidden'
    const visibility = () => {
      const hidden = document.visibilityState === 'hidden'
      if (wasHidden && !hidden) {
        resumedAtWallMs.current = Date.now()
        const latest = currentRun.current
        const at = shiftTimeAt(latest, resumedAtWallMs.current)
        if (!Object.values(latest.tasks).some(task => task.status === 'printing' && task.completesAtMs > at)) setLoop(null)
      }
      wasHidden = hidden
    }
    document.addEventListener('visibilitychange', visibility, true)
    return () => document.removeEventListener('visibilitychange', visibility, true)
  }, [setLoop])

  useEffect(() => {
    const current = events(run)
    if (!heard.current || heard.current.runId !== run.id) {
      heard.current = { runId: run.id, ids: new Set(current.map(event => event.id)) }
      return
    }
    const sounds = new Set<SfxId>()
    for (const event of current) {
      const timely = !Number.isFinite(resumedAtWallMs.current) || event.atMs >= shiftTimeAt(run, resumedAtWallMs.current)
      if (!heard.current.ids.has(event.id) && timely) sounds.add(event.sound)
      heard.current.ids.add(event.id)
    }
    if (run.status !== 'running' || document.visibilityState === 'hidden' || preferences.muted || preferences.effectsVolume === 0) return
    for (const sound of sounds) playSfx(sound)
  }, [run, playSfx, preferences.muted, preferences.effectsVolume])

  useEffect(() => {
    setLoop(run.status === 'running' && printing ? 'printer_loop' : null)
    if (run.status !== 'running') stopEffects()
  }, [run.status, printing, setLoop, stopEffects])
  useEffect(() => () => setLoop(null), [setLoop])
  return null
}
