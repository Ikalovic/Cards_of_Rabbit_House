import type { MachineId, PuzzleAnswer, PuzzleInstance, PuzzleResult } from '../domain/shift-types'
import { examRequest, waitForExamWrites } from './exam-session'

export type PuzzleReply = Readonly<{ puzzle: PuzzleInstance; result?: PuzzleResult; serverNowMs: number }>
export type GradeReply = Readonly<{ result: PuzzleResult; serverNowMs: number }>

export async function beginServerPuzzle(shiftRunId: string, intentId: string, machineId: MachineId): Promise<PuzzleReply> {
  await waitForExamWrites()
  return examRequest('/api/puzzles/begin', { shiftRunId, intentId, machineId })
}
export const submitServerPuzzle = (puzzleId: string, answer: PuzzleAnswer): Promise<GradeReply> =>
  examRequest(`/api/puzzles/${encodeURIComponent(puzzleId)}/submit`, { answer })
export const exitServerPuzzle = (puzzleId: string): Promise<GradeReply> =>
  examRequest(`/api/puzzles/${encodeURIComponent(puzzleId)}/exit`, {})
export const revealServerPuzzle = (puzzleId: string, index: number): Promise<PuzzleReply> =>
  examRequest(`/api/puzzles/${encodeURIComponent(puzzleId)}/reveal`, { index })
