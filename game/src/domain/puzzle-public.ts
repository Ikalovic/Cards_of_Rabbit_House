import type { AuthoredCalibrationKind, ElementDirection, MachineId, PublicPuzzleDefinition } from './shift-types'

export type PuzzleCreationInput = Readonly<{
  shiftSeed: string
  shiftRunId: string
  orderId: string
  intentId: string
  machineId: MachineId
  attempt: number
  startedAtMs: number
  difficulty?: number
  calibrationKind?: AuthoredCalibrationKind
}>
export type PuzzleValidation = Readonly<{ valid: boolean; issues: readonly string[] }>

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const directions: readonly ElementDirection[] = ['upright', 'left', 'right', 'inverted']
const directionLabels: Readonly<Record<ElementDirection, string>> = { upright: '正向', left: '向左', right: '向右', inverted: '倒置' }
const dense = (value: unknown): value is unknown[] => Array.isArray(value)
  && Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index))
const keys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key))
const validation = (valid: boolean, issue: string): PuzzleValidation => ({ valid, issues: valid ? [] : [issue] })
const unique = (values: readonly unknown[]): boolean => new Set(values).size === values.length
const boundedCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const appearance = (value: unknown): value is Record<string, unknown> => record(value)
  && nonempty(value.color) && nonempty(value.shape) && directions.includes(value.direction as ElementDirection)
const strings = (value: unknown): value is string[] => dense(value) && value.length > 0 && value.every(nonempty)

function validMathMedia(definition: Record<string, unknown>): boolean {
  const images = definition.images
  const allowedImages = ['/assets/math/questions/single_14.png', '/assets/math/questions/multiple_03.png']
  if (images !== undefined && (!dense(images) || images.length === 0 || !images.every(image => record(image)
    && keys(image, ['src', 'alt']) && typeof image.src === 'string' && allowedImages.includes(image.src) && nonempty(image.alt)))) return false
  const table = definition.table
  return table === undefined || (record(table) && keys(table, ['headers', 'rows']) && strings(table.headers)
    && dense(table.rows) && table.rows.length > 0 && table.rows.every(row => strings(row) && row.length === (table.headers as string[]).length))
}

/** Validate browser-safe shapes only. Extra fields are rejected so old answer-bearing saves cannot re-enter state. */
export function validatePublicPuzzleDefinition(value: unknown): PuzzleValidation {
  if (!record(value)) return validation(false, 'Public puzzle definition must be an object')
  switch (value.kind) {
    case 'number-search':
      return validation(keys(value, ['kind', 'grid', 'columns', 'target']) && integer(value.columns) && value.columns > 0 && value.columns <= 12
        && dense(value.grid) && value.grid.length > 1 && value.grid.length <= 144 && value.grid.length % value.columns === 0
        && value.grid.every(integer) && integer(value.target) && value.grid.filter(number => number === value.target).length === 1,
      'Number search needs a rectangular public grid with one target')
    case 'connect': {
      if (!keys(value, ['kind', 'nodes']) || !dense(value.nodes) || value.nodes.length < 2 || value.nodes.length > 20
        || !value.nodes.every(node => record(node) && keys(node, ['id', 'x', 'y']) && nonempty(node.id) && boundedCoordinate(node.x) && boundedCoordinate(node.y))) {
        return validation(false, 'Connect needs public labelled nodes with normalized positions')
      }
      const nodes = value.nodes as { id: string; x: number; y: number }[]
      return validation(unique(nodes.map(node => JSON.stringify([node.x, node.y]))) && unique(nodes.map(node => node.id))
        && nodes.every(node => Array.from({ length: nodes.length }, (_, index) => String(index + 1)).includes(node.id)),
      'Connect needs every visible ordinal label exactly once')
    }
    case 'identify': {
      if (!keys(value, ['kind', 'prompt', 'target', 'options']) || !appearance(value.target) || !keys(value.target, ['color', 'shape', 'direction'])
        || value.prompt !== `找出：${value.target.color}、${value.target.shape}、${directionLabels[value.target.direction as ElementDirection]}`
        || !dense(value.options) || value.options.length < 2 || value.options.length > 20
        || !value.options.every(option => appearance(option) && keys(option, ['id', 'color', 'shape', 'direction']) && nonempty(option.id))) {
        return validation(false, 'Identify needs public target criteria and complete options')
      }
      const options = value.options as Record<string, unknown>[]
      const target = value.target
      return validation(unique(options.map(option => option.id)) && unique(options.map(option => JSON.stringify([option.color, option.shape, option.direction])))
        && options.filter(option => option.color === target.color && option.shape === target.shape && option.direction === target.direction).length === 1,
      'Identify needs distinct visible options and one matching appearance')
    }
    case 'minesweeper': {
      if (!keys(value, ['kind', 'rows', 'columns', 'mineCount', 'revealedCells']) || !integer(value.rows) || !integer(value.columns)
        || value.rows < 2 || value.rows > 8 || value.columns < 2 || value.columns > 8) return validation(false, 'Minesweeper needs a bounded public board')
      const size = value.rows * value.columns
      return validation(integer(value.mineCount) && value.mineCount > 0 && value.mineCount < size && dense(value.revealedCells)
        && value.revealedCells.length > 0 && value.revealedCells.length <= size - value.mineCount
        && value.revealedCells.every(cell => record(cell) && keys(cell, ['index', 'clue']) && integer(cell.index) && cell.index >= 0 && cell.index < size
          && integer(cell.clue) && cell.clue >= 0 && cell.clue <= 8 && cell.clue <= (value.mineCount as number))
        && unique(value.revealedCells.map(cell => (cell as Record<string, unknown>).index)),
      'Minesweeper exposes only a mine count and revealed safe-cell clues')
    }
    case 'sudoku':
      return validation(keys(value, ['kind', 'size', 'boxRows', 'boxColumns', 'givens']) && value.size === 4 && value.boxRows === 2 && value.boxColumns === 2
        && dense(value.givens) && value.givens.length === 16 && value.givens.every(cell => integer(cell) && cell >= 0 && cell <= 4),
      'Mini sudoku needs 16 public givens and 2×2 boxes')
    case 'math-choice':
    case 'math-fill': {
      const allowed = ['kind', 'id', 'prompt', 'timeLimitSeconds', 'images', 'table', ...(value.kind === 'math-choice' ? ['options', 'multiple'] : [])]
      if (!keys(value, allowed) || !nonempty(value.id) || !nonempty(value.prompt) || !integer(value.timeLimitSeconds)
        || value.timeLimitSeconds < 60 || value.timeLimitSeconds > 120 || !validMathMedia(value)) return validation(false, 'Math questions need public text and registered local media')
      return validation(value.kind === 'math-fill' || (typeof value.multiple === 'boolean' && dense(value.options) && value.options.length >= 2
        && value.options.every(option => record(option) && keys(option, ['id', 'label']) && nonempty(option.id) && nonempty(option.label))
        && unique(value.options.map(option => (option as Record<string, unknown>).id))), 'Math choices need public options and a selection mode')
    }
    default: return validation(false, 'Unknown public puzzle kind')
  }
}

export function isPublicPuzzleDefinition(value: unknown): value is PublicPuzzleDefinition {
  return validatePublicPuzzleDefinition(value).valid
}
