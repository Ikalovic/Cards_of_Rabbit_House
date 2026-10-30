import type { CardDesign, CardLayer, StickerLayer, StrokeLayer, TextStampLayer } from './types'

export type EditorHistory = Readonly<{
  past: readonly CardDesign[]
  present: CardDesign
  future: readonly CardDesign[]
}>

export type CardLayerPatch =
  | Partial<Omit<StickerLayer, 'kind' | 'id'>>
  | Partial<Omit<TextStampLayer, 'kind' | 'id'>>
  | Partial<Omit<StrokeLayer, 'kind' | 'id'>>

const HISTORY_LIMIT = 50
const clone = <T>(value: T): T => structuredClone(value)

export function createEditorHistory(design: CardDesign): EditorHistory {
  return { past: [], present: clone(design), future: [] }
}

function record(history: EditorHistory, present: CardDesign): EditorHistory {
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
  }
}

function withLayers(history: EditorHistory, layers: readonly CardLayer[]): EditorHistory {
  return record(history, { ...history.present, layers })
}

export function addLayer(history: EditorHistory, layer: CardLayer): EditorHistory {
  return withLayers(history, [...history.present.layers, clone(layer)])
}

export function updateLayer(
  history: EditorHistory,
  layerId: string,
  patch: CardLayerPatch,
): EditorHistory {
  const index = history.present.layers.findIndex((layer) => layer.id === layerId)
  if (index < 0) return history

  const layers = [...history.present.layers]
  layers[index] = { ...layers[index], ...clone(patch) } as CardLayer
  return withLayers(history, layers)
}

export function removeLayer(history: EditorHistory, layerId: string): EditorHistory {
  if (!history.present.layers.some((layer) => layer.id === layerId)) return history
  return withLayers(
    history,
    history.present.layers.filter((layer) => layer.id !== layerId),
  )
}

export function duplicateLayer(
  history: EditorHistory,
  layerId: string,
  duplicateId: string,
): EditorHistory {
  const index = history.present.layers.findIndex((layer) => layer.id === layerId)
  if (index < 0) return history

  const duplicate = { ...clone(history.present.layers[index]), id: duplicateId } as CardLayer
  const layers = [...history.present.layers]
  layers.splice(index + 1, 0, duplicate)
  return withLayers(history, layers)
}

export function reorderLayer(
  history: EditorHistory,
  layerId: string,
  destinationIndex: number,
): EditorHistory {
  const sourceIndex = history.present.layers.findIndex((layer) => layer.id === layerId)
  if (sourceIndex < 0 || history.present.layers.length < 2) return history

  const boundedDestination = Math.max(
    0,
    Math.min(history.present.layers.length - 1, Math.trunc(destinationIndex)),
  )
  if (sourceIndex === boundedDestination) return history

  const layers = [...history.present.layers]
  const [layer] = layers.splice(sourceIndex, 1)
  layers.splice(boundedDestination, 0, layer)
  return withLayers(history, layers)
}

export function undo(history: EditorHistory): EditorHistory {
  if (history.past.length === 0) return history
  return {
    past: history.past.slice(0, -1),
    present: history.past.at(-1)!,
    future: [history.present, ...history.future],
  }
}

export function redo(history: EditorHistory): EditorHistory {
  if (history.future.length === 0) return history
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: history.future[0],
    future: history.future.slice(1),
  }
}
