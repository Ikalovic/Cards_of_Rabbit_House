export type CardId = string
export type PrintJobId = string
export type CommissionId = 'chino' | 'rize' | 'chiya-sharo'
export type PaperId = 'cream' | 'coffee' | 'mint' | 'pink'

export type NormalizedPoint = Readonly<{
  x: number
  y: number
}>

export type StickerLayer = Readonly<{
  kind: 'sticker'
  id: string
  assetId: string
  x: number
  y: number
  scale: number
  rotation: number
}>

export type TextStampLayer = Readonly<{
  kind: 'text-stamp'
  id: string
  styleId: string
  text: string
  x: number
  y: number
  scale: number
  rotation: number
}>

export type StrokeLayer = Readonly<{
  kind: 'stroke'
  id: string
  points: readonly NormalizedPoint[]
  colorId: string
  width: number
}>

export type CardLayer = StickerLayer | TextStampLayer | StrokeLayer

export type CardDesign = Readonly<{
  version: 1
  paperId: PaperId
  layers: readonly CardLayer[]
}>

export type RequestId = string

/** Safe, display-only summary of how a card entered the library. */
export type CardSourceSummary = Readonly<{ kind: 'native' }>

export type SavedCard = Readonly<{
  cardId: CardId
  design: CardDesign
  source: CardSourceSummary
  commissionId?: CommissionId
  savedAt: string
}>

/** Plain-text workshop receipt surfaced to the player. */
export type ShopReceipt = Readonly<{
  receiptId: string
  title: 'Rabbit House 工坊回执'
  bodyText: string
}>

export type PrintStatus = 'queued' | 'processing' | 'succeeded' | 'failed'

export type PrintJob = Readonly<{
  printJobId: PrintJobId
  cardId: CardId
  status: PrintStatus
  createdAt: string
}>

export type EvaluationPartKey = 'paper' | 'elements' | 'layout' | 'clarity' | 'neatness'

export type EvaluationPart = Readonly<{
  key: EvaluationPartKey
  label: string
  score: number
  maxScore: number
}>

export type Evaluation = Readonly<{
  commissionId: CommissionId
  passed: boolean
  totalScore: number
  parts: readonly EvaluationPart[]
  advice: readonly string[]
}>

export type GameMode = 'story' | 'direct-shift' | 'free'

export type ProgressState = Readonly<{
  mode: GameMode
  tutorialCompleted: boolean
  currentCommissionId?: CommissionId
  completedCommissionIds: readonly CommissionId[]
  unlockedAssetIds: readonly string[]
  freeModeUnlocked: boolean
  dialogueNodeId: string
  readNodeIds: readonly string[]
}>
