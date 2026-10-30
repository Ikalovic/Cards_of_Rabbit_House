import type { ElementDirection, PuzzleInstance } from '../src/domain/shift-types'

export type MathQuestionBase = Readonly<{
  id: string; prompt: string; timeLimitSeconds: number
  images?: readonly Readonly<{ src: string; alt: string }>[]
  table?: Readonly<{ headers: readonly string[]; rows: readonly (readonly string[])[] }>
}>
export type MathChoiceQuestion = MathQuestionBase & Readonly<{
  kind: 'math-choice'
  options: readonly Readonly<{ id: string; label: string }>[]
  correctOptionIds: readonly string[]
  multiple?: boolean
}>
export type MathFillQuestion = MathQuestionBase & Readonly<{
  kind: 'math-fill'
  acceptedAnswers: readonly string[]
}>
export type MathQuestion = MathChoiceQuestion | MathFillQuestion
export type PrivatePuzzleDefinition =
  | Readonly<{ kind: 'number-search'; grid: readonly number[]; columns: number; target: number; correctIndex: number }>
  | Readonly<{ kind: 'connect'; nodes: readonly Readonly<{ id: string; x: number; y: number }>[]; correctPath: readonly string[] }>
  | Readonly<{ kind: 'identify'; prompt: string; target: Readonly<{ color: string; shape: string; direction: ElementDirection }>; options: readonly Readonly<{ id: string; color: string; shape: string; direction: ElementDirection }>[]; correctOptionId: string }>
  | Readonly<{ kind: 'minesweeper'; rows: number; columns: number; mineIndices: readonly number[]; revealedIndices: readonly number[] }>
  | Readonly<{ kind: 'sudoku'; size: number; boxRows: number; boxColumns: number; givens: readonly number[]; solution: readonly number[] }>
  | MathQuestion

export type PrivatePuzzleInstance = Omit<PuzzleInstance, 'definition'> & Readonly<{
  seed: string
  definition: PrivatePuzzleDefinition
}>
