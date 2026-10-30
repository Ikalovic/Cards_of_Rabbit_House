/** Business-mode contracts. All persisted values are plain, JSON-serializable data. */
export type AuthoredStageId = 'tutorial' | 'beginner' | 'story'
export const OFFICIAL_CHARACTER_IDS = [
  'chino', 'cocoa', 'rize', 'chiya', 'syaro', 'maya', 'megu',
  'aoyama', 'rin', 'moka', 'yura', 'fuyu', 'natsume', 'elulu',
] as const
export type OfficialCharacterId = typeof OFFICIAL_CHARACTER_IDS[number]
export type MachineId = 'quick' | 'fine'
export type AuthoredCalibrationKind = 'minesweeper' | 'sudoku' | 'math'
export type StationId = 'reception' | 'preparation' | 'assembly' | 'craft' | 'inspection' | 'print'
export const TUTORIAL_STATION_TRIGGERS = {
  reception: 'read_order', preparation: 'choose_materials', assembly: 'place_elements',
  craft: 'complete_craft', inspection: 'inspect_card', print: 'choose_printer',
} as const satisfies Readonly<Record<StationId, string>>
export type TutorialTrigger = typeof TUTORIAL_STATION_TRIGGERS[StationId]
export type PaperId = 'cream' | 'coffee' | 'mint' | 'pink' | 'sky' | 'lilac' | 'midnight' | 'kraft'
export type PaperMaterialId = 'smooth' | 'textured' | 'pearl' | 'linen' | 'kraft'
export type ShapeId = 'landscape' | 'portrait' | 'folded' | 'square' | 'ticket' | 'tag'
export type Orientation = 'landscape' | 'portrait'
export type ElementKind = 'motif' | 'word-stamp' | 'decoration' | 'border'
export type ElementSize = 'small' | 'medium' | 'large'
export type ElementDirection = 'upright' | 'left' | 'right' | 'inverted'
export type ElementLayer = 'back' | 'front'
export type SurfaceFinishId = 'matte' | 'gloss' | 'foil' | 'emboss' | 'wax'
export type CraftKind = 'stamp' | 'trim' | 'ribbon' | 'foil' | 'wax'
export type MaterialId =
  | 'pearl-paper' | 'linen-paper' | 'shaped-blank' | 'lace' | 'special-border'
  | 'premium-decoration' | 'special-ribbon' | 'foil-sheet' | 'emboss-sheet' | 'wax'
export type ConsumptionTrigger = 'cut-blank' | 'fix-assembly' | 'first-craft-action'

export type MaterialCost = Readonly<{ materialId: MaterialId; quantity: number }>
export type CatalogItem<Id extends string = string> = Readonly<{
  id: Id
  label: string
  tags: readonly string[]
  materialCosts: readonly MaterialCost[]
}>
export type PaperDefinition = CatalogItem<PaperId> & Readonly<{
  color: string
  materialId: PaperMaterialId
}>
export type ShapeDefinition = CatalogItem<ShapeId> & Readonly<{ orientation: Orientation }>
export type SlotDefinition = Readonly<{
  id: string
  label: string
  accepts: readonly ElementKind[]
  sizes: readonly ElementSize[]
  directions: readonly ElementDirection[]
  layers: readonly ElementLayer[]
  x: number
  y: number
  width: number
  height: number
}>
export type LayoutDefinition = CatalogItem & Readonly<{ slots: readonly SlotDefinition[] }>
export type MaterialDefinition = Readonly<{
  id: MaterialId
  label: string
  consumeOn: ConsumptionTrigger
}>

export type MaterialInventory = Readonly<Record<MaterialId, number>>
export type CriterionRule =
  | Readonly<{ kind: 'tags'; tags: readonly string[]; match: 'all' | 'any' }>
  | Readonly<{ kind: 'layout-tag'; tag: string }>
  | Readonly<{ kind: 'element-count'; minimum: number; maximum: number }>
export type OrderCriterion = Readonly<{
  id: string
  label: string
  tags: readonly string[]
  rule: CriterionRule
  /** Optional premium choices never contribute to required inventory demand. */
  optionalMaterialCosts: readonly MaterialCost[]
}>
export type RequiredElement = Readonly<{
  id: string
  kind: ElementKind
  assetId: string
  label: string
  quantity: number
}>
export type CraftDimension = 'position' | 'pressure' | 'length' | 'time' | 'coverage'
export type CraftRequirement = Readonly<{
  id: string
  kind: CraftKind
  label: string
  targets: Readonly<Partial<Record<CraftDimension, Readonly<{ min: number; max: number }>>>>
  discrete: Readonly<Record<string, string>>
  materialCosts: readonly MaterialCost[]
}>
export type OrderRequirements = Readonly<{
  paperId: PaperId
  paperMaterialId: PaperMaterialId
  shapeId: ShapeId
  orientation: Orientation
  layoutId: string
  surfaceFinishId: SurfaceFinishId
  elements: readonly RequiredElement[]
  crafts: readonly CraftRequirement[]
}>
export type CustomerIdentity = Readonly<{
  kind: 'official'; characterId: OfficialCharacterId; name: string; situation: string
}>
export type OrderTemplate = Readonly<{
  id: string
  title: string
  customer: CustomerIdentity
  requirements: OrderRequirements
  preferences: readonly OrderCriterion[]
  taboo: OrderCriterion
  qualityExpectation: number
}>
export type ScheduledCustomer = Readonly<{
  id: string
  order: OrderTemplate
  arrivalSeconds: number
  arrivalBaseSeconds: number
  arrivalJitterSeconds: number
  basePatienceSeconds: number
  unadjustedPatienceSeconds: number
  lastWaitSeconds: number
  /** Content-owned teaching sequence, independent of the enabled runtime kind pool. */
  calibrationPlan?: Readonly<Partial<Record<MachineId, AuthoredCalibrationKind>>>
}>
export type AuthoredThresholds = Readonly<{
  kind: 'authored'; minDelivered: number; minSatisfied: number; maxLeft: number
}>
export type SurvivalThresholds = Readonly<{
  kind: 'survival'; minDeliveredRatio: number; satisfiedRatioExclusive: number; maxLeft: number
}>
type StageBase = Readonly<{
  id: string
  label: string
  seed: string
  day: number
  durationSeconds: 720
  customers: readonly ScheduledCustomer[]
  inventory: MaterialInventory
  inspections: 3
  freeDemoInspections: 0 | 1
}>
export type AuthoredStageDefinition = StageBase & Readonly<{
  kind: 'authored'; id: AuthoredStageId; thresholds: AuthoredThresholds
  puzzleDifficulty?: number
}>
export type SurvivalStageDefinition = StageBase & Readonly<{
  kind: 'survival'
  thresholds: SurvivalThresholds
  arrivalHorizonSeconds: number
  complexProbability: number
  hardPuzzleWeight: number
  patienceReductionSeconds: number
}>
export type StageDefinition = AuthoredStageDefinition | SurvivalStageDefinition

/** Reception position, patience, and outcome are deliberately independent. */
export type CustomerPosition = 'door_waiting' | 'active' | 'closed'
export type CustomerPatience =
  | Readonly<{ phase: 'normal'; depletesAtMs: number; remainingSeconds: number; updatedAtMs: number }>
  | Readonly<{ phase: 'last_wait'; startedAtMs: number; deadlineAtMs: number; originalDurationSeconds: number }>
  | Readonly<{ phase: 'expired'; expiredAtMs: number }>
export type CustomerOutcome =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'delivered'; taskId: string; deliveredAtMs: number; evaluation: OrderEvaluation }>
  | Readonly<{ status: 'left'; leftAtMs: number; reason: 'patience' | 'closing' }>
export type CustomerOrder = Readonly<{
  id: string
  shiftRunId: string
  content: OrderTemplate
  arrivalAtMs: number
  acceptedAtMs: number | null
  basePatienceSeconds: number
  lastWaitSeconds: number
  position: CustomerPosition
  patience: CustomerPatience
  outcome: CustomerOutcome
  remedy: 'none' | 'explain-progress' | 'expedite'
}>

export type PlacedElement = Readonly<{
  id: string
  assetId: string
  kind: ElementKind
  slotId: string
  size: ElementSize
  direction: ElementDirection
  layer: ElementLayer
}>
export type CraftMeasurements = Readonly<Partial<Record<CraftDimension, number>>>
export type CraftResult = Readonly<{
  id: string
  requirementId: string
  kind: CraftKind
  measurements: CraftMeasurements
  discrete: Readonly<Record<string, string>>
  completedAtMs: number
}>
export type CraftProgress = Readonly<{
  measurements: CraftMeasurements
  completedSteps: readonly string[]
  coverageCells: readonly number[]
  trace: readonly Readonly<{ x: number; y: number }>[]
}>
export type ActiveCraftOperation = Readonly<{
  operationId: string
  requirementId: string
  kind: CraftKind
  discrete: Readonly<Record<string, string>>
  reservationIds: readonly string[]
  progress: CraftProgress
}> & (
  | Readonly<{ status: 'selected' }>
  | Readonly<{ status: 'in_progress'; startedAtMs: number; irreversibleActionAtMs: number }>
)
export type PreparationSelection = Readonly<{
  paperId: PaperId | null
  paperMaterialId: PaperMaterialId | null
  shapeId: ShapeId | null
  orientation: Orientation
  layoutId: string | null
  surfaceFinishId: SurfaceFinishId
}>
export type ProductionDesign = Readonly<{
  version: 1
  preparation: PreparationSelection
  elements: readonly PlacedElement[]
  crafts: readonly CraftResult[]
}>
export type InspectionSnapshot = Readonly<{
  id: string
  draftRevision: number
  checkedAtMs: number
  issues: readonly Readonly<{ code: string; label: string; elementId?: string }>[]
  freeDemo: boolean
}>
type DraftBase = Readonly<{
  id: string
  shiftRunId: string
  orderId: string
  revision: number
  derivedFromSnapshotId: string | null
  design: ProductionDesign
  reservationIds: readonly string[]
  inspections: readonly InspectionSnapshot[]
}>
export type ProductionDraft = DraftBase & (
  | Readonly<{ stage: 'not_started' | 'preparing' | 'assembling' }>
  | Readonly<{ stage: 'crafting'; activeCraft: ActiveCraftOperation | null }>
  | Readonly<{ stage: 'archived'; snapshotId: string }>
)
/** An archive contains only immutable artwork and provenance, never live timers. */
export type ShiftCardSnapshot = Readonly<{
  kind: 'production-card'
  version: 1
  id: string
  shiftRunId: string
  orderId: string
  draftId: string
  draftRevision: number
  savedAtMs: number
  design: ProductionDesign
}>
/** A closed shift's unfinished artwork, without live order, inventory or print state. */
export type WorkshopDraft = Readonly<{
  kind: 'workshop-draft'
  version: 1
  id: string
  shiftRunId: string
  customerName: string
  title: string
  savedAtMs: number
  design: ProductionDesign
}>
type MaterialReservationBase = Readonly<{
  id: string; materialId: MaterialId; quantity: number; draftId: string; draftRevision: number
  consumeOn: ConsumptionTrigger; operationId: string; reservedAtMs: number
}>
export type MaterialReservation = MaterialReservationBase & (
  | Readonly<{ status: 'reserved' }>
  | Readonly<{ status: 'consumed'; consumedAtMs: number }>
  | Readonly<{ status: 'released'; releasedAtMs: number }>
)
export type MaterialLedger = Readonly<{
  stock: Readonly<Record<MaterialId, Readonly<{ available: number; reserved: number; consumed: number }>>>
  reservations: Readonly<Record<string, MaterialReservation>>
}>

export type PublicMathQuestionBase = Readonly<{
  id: string; prompt: string; timeLimitSeconds: number
  images?: readonly Readonly<{ src: string; alt: string }>[]
  table?: Readonly<{ headers: readonly string[]; rows: readonly (readonly string[])[] }>
}>
export type MathChoiceQuestion = PublicMathQuestionBase & Readonly<{
  kind: 'math-choice'
  options: readonly Readonly<{ id: string; label: string }>[]
  multiple: boolean
}>
export type MathFillQuestion = PublicMathQuestionBase & Readonly<{ kind: 'math-fill' }>
export type PublicMathQuestion = MathChoiceQuestion | MathFillQuestion
export type MathQuestion = PublicMathQuestion
export type PublicPuzzleDefinition =
  | Readonly<{ kind: 'number-search'; grid: readonly number[]; columns: number; target: number }>
  | Readonly<{ kind: 'connect'; nodes: readonly Readonly<{ id: string; x: number; y: number }>[] }>
  | Readonly<{ kind: 'identify'; prompt: string; target: Readonly<{ color: string; shape: string; direction: ElementDirection }>; options: readonly Readonly<{ id: string; color: string; shape: string; direction: ElementDirection }>[] }>
  | Readonly<{ kind: 'minesweeper'; rows: number; columns: number; mineCount: number; revealedCells: readonly Readonly<{ index: number; clue: number }>[] }>
  | Readonly<{ kind: 'sudoku'; size: number; boxRows: number; boxColumns: number; givens: readonly number[] }>
  | PublicMathQuestion
/** Browser and persisted state contain only the public question. */
export type PuzzleDefinition = PublicPuzzleDefinition
export type PuzzleAnswer =
  | Readonly<{ kind: 'number-search'; index: number }>
  | Readonly<{ kind: 'connect'; path: readonly string[] }>
  | Readonly<{ kind: 'identify'; optionId: string }>
  | Readonly<{ kind: 'minesweeper'; revealedIndices: readonly number[]; flaggedIndices: readonly number[] }>
  | Readonly<{ kind: 'sudoku'; cells: readonly number[] }>
  | Readonly<{ kind: 'math-choice'; optionIds: readonly string[] }>
  | Readonly<{ kind: 'math-fill'; text: string }>
export type PuzzleResult =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'succeeded'; submittedAtMs: number; answer: PuzzleAnswer }>
  | Readonly<{ status: 'failed'; failedAtMs: number; reason: 'wrong' | 'timeout' | 'exit'; answer: PuzzleAnswer | null }>
export type PuzzleInstance = Readonly<{
  id: string; shiftRunId: string; orderId: string; intentId: string; machineId: MachineId
  attempt: number; startedAtMs: number; deadlineAtMs: number
  definition: PuzzleDefinition; result: PuzzleResult
}>

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }
type ReceiptBase = Readonly<{
  receiptId: string; intentId: string; snapshotId: string; machineId: MachineId; shiftRunId: string
  receivedAtMs: number; authority: 'local' | 'remote'; details: JsonValue
}>
export type PrintReceipt = ReceiptBase & (
  | Readonly<{ status: 'accepted'; taskId: string }>
  | Readonly<{ status: 'rejected'; reasonCode: string; message: string }>
)
type AuthorizationBase = Readonly<{
  id: string; shiftRunId: string; orderId: string; snapshotId: string; confirmedAtMs: number
  nextAttempt: number
}>
export type PrintAuthorization = AuthorizationBase & (
  | Readonly<{ status: 'confirmed'; machineId: MachineId }>
  | Readonly<{ status: 'calibrating'; machineId: MachineId; attempt: number; reservationId: string; puzzleId: string }>
  | Readonly<{ status: 'failed'; machineId: MachineId; machineLockUntilMs: number; puzzleId: string }>
  | Readonly<{ status: 'calibrated_pending_start'; machineId: MachineId; reservationId: string; puzzleId: string; calibratedAtMs: number }>
  | Readonly<{ status: 'bound'; machineId: MachineId; taskId: string; receipt: Extract<PrintReceipt, { status: 'accepted' }> }>
  | Readonly<{ status: 'rejected'; machineId: MachineId; receipt: Extract<PrintReceipt, { status: 'rejected' }> }>
  | Readonly<{ status: 'expired_unprinted'; expiredAtMs: number }>
)
type PrintTaskBase = Readonly<{
  id: string; intentId: string; snapshotId: string; orderId: string; shiftRunId: string
  machineId: MachineId; createdAtMs: number; durationMs: number; expedited: boolean
}>
export type PrintTask = PrintTaskBase & (
  | Readonly<{ status: 'queued' }>
  | Readonly<{ status: 'printing'; startedAtMs: number; completesAtMs: number }>
  | Readonly<{ status: 'ready'; readyAtMs: number }>
  | Readonly<{ status: 'delivered'; readyAtMs: number; deliveredAtMs: number }>
  | Readonly<{ status: 'unclaimed'; readyAtMs: number; unclaimedAtMs: number }>
)
export type PrinterReservation = Readonly<{
  id: string; intentId: string; orderId: string; shiftRunId: string; machineId: MachineId; puzzleId: string
}> & (
  | Readonly<{ status: 'calibrating'; deadlineAtMs: number }>
  | Readonly<{ status: 'calibrated_pending_start'; calibratedAtMs: number }>
)
export type PrinterState = Readonly<{
  machineId: MachineId
  currentTaskId: string | null
  queuedTaskIds: readonly string[]
  reservations: readonly PrinterReservation[]
  orderLockUntilMs: Readonly<Record<string, number>>
  estimatedFreeAtMs: number | null
}>

export type OrderEvaluation = Readonly<{
  accuracy: number; preferences: number; quality: number; printing: number; timeliness: number
  rawScore: number; score: number; grade: 'S' | 'A' | 'B' | 'C' | 'D'; satisfied: boolean
  missingRequiredIds: readonly string[]; tabooViolated: boolean; advice: readonly string[]
}>
export type ShiftResult = Readonly<{
  shiftRunId: string; stageId: string; day: number; closedAtMs: number
  delivered: number; satisfied: number; left: number; averageScore: number
  /** Maximum consecutive satisfied A/S handoffs within this day, ordered by delivery time. */
  longestQualityStreak: number
  passed: boolean; failureReasons: readonly ('deliveries' | 'satisfaction' | 'departures' | 'corrupt-save')[]
}>
export type ControlledPauseReason = 'story' | 'tutorial' | 'settlement'
export type PauseInterval = Readonly<{ reason: ControlledPauseReason; startedAtMs: number; endedAtMs: number }>
type ShiftRunBase = Readonly<{
  version: 1
  id: string
  stage: StageDefinition
  seed: string
  startedAtMs: number
  deadlineAtMs: number
  lastProcessedAtMs: number
  /** Added operating time from inspections; missing in older v1 saves means zero. */
  inspectionTimeOffsetMs?: number
  pauses: readonly PauseInterval[]
  seenTutorialTriggers: readonly TutorialTrigger[]
  orders: readonly CustomerOrder[]
  activeOrderIds: readonly string[]
  selectedOrderId: string | null
  station: StationId
  drafts: Readonly<Record<string, ProductionDraft>>
  snapshotIds: readonly string[]
  snapshots: Readonly<Record<string, ShiftCardSnapshot>>
  materials: MaterialLedger
  authorizations: Readonly<Record<string, PrintAuthorization>>
  puzzles: Readonly<Record<string, PuzzleInstance>>
  tasks: Readonly<Record<string, PrintTask>>
  printers: Readonly<Record<MachineId, PrinterState>>
  inspectionsRemaining: number
  freeDemoInspectionsRemaining: number
  remedies: Readonly<{ explainProgressAvailable: boolean; expediteAvailable: boolean }>
  pendingReconciliationIntentIds: readonly string[]
}>
export type ShiftRun = ShiftRunBase & (
  | Readonly<{ status: 'running' }>
  | Readonly<{ status: 'paused'; pause: Readonly<{ reason: ControlledPauseReason; startedAtMs: number }> }>
  | Readonly<{ status: 'settled'; result: ShiftResult }>
)
export type ShiftSnapshot = Readonly<{
  version: 1
  revision: number
  savedAtMs: number
  run: ShiftRun
}>
export type ShiftProgression = Readonly<{
  version: 1
  completedAuthoredStages: readonly AuthoredStageId[]
  survivalUnlocked: boolean
  survivalRun: Readonly<{ seed: string; nextDay: number; satisfied: number }> | null
  highestSurvivalDay: number
  cumulativeSatisfied: number
  highestDailyScore: number
  longestQualityStreak: number
  unlockedCosmeticIds: readonly string[]
  results: readonly ShiftResult[]
}>

export type ReceptionAction = Readonly<{ station: 'reception'; type: 'accept-order' | 'explain-progress'; orderId: string }>
export type PreparationAction = Readonly<{ station: 'preparation'; draftId: string }> & (
  | Readonly<{ type: 'select-preparation'; selection: Partial<PreparationSelection> }>
  | Readonly<{ type: 'cut-blank' }>
)
export type AssemblyAction = Readonly<{ station: 'assembly'; draftId: string }> & (
  | Readonly<{ type: 'place-element'; element: PlacedElement }>
  | Readonly<{ type: 'remove-element'; elementId: string }>
  | Readonly<{ type: 'fix-assembly' }>
)
export type CraftAction = Readonly<{ station: 'craft'; draftId: string; craftId: string }> & (
  | Readonly<{ type: 'select-craft'; operationId: string; discrete: Readonly<Record<string, string>> }>
  | Readonly<{ type: 'begin-craft' | 'cancel-craft' }>
  | Readonly<{ type: 'update-craft'; progress: CraftProgress }>
  | Readonly<{ type: 'finish-craft'; measurements: CraftMeasurements; discrete: Readonly<Record<string, string>> }>
)
export type InspectionAction = Readonly<{ station: 'inspection'; type: 'inspect'; draftId: string; freeDemo: boolean }>
export type PrintAction = Readonly<{ station: 'print' }> & (
  | Readonly<{ type: 'archive'; draftId: string; snapshotId: string }>
  | Readonly<{ type: 'confirm-print'; snapshotId: string; intentId: string; machineId: MachineId }>
  | Readonly<{ type: 'begin-calibration'; intentId: string; machineId: MachineId }>
  | Readonly<{ type: 'submit-puzzle'; puzzleId: string; answer: PuzzleAnswer }>
  | Readonly<{ type: 'exit-puzzle'; puzzleId: string }>
  | Readonly<{ type: 'record-receipt'; receipt: PrintReceipt }>
  | Readonly<{ type: 'reorder-queue'; machineId: MachineId; taskIds: readonly string[] }>
  | Readonly<{ type: 'expedite' | 'deliver'; taskId: string }>
)
export type StationAction = ReceptionAction | PreparationAction | AssemblyAction | CraftAction | InspectionAction | PrintAction
export type ShiftAction = StationAction
  | Readonly<{ type: 'advance-time'; nowMs: number }>
  | Readonly<{ type: 'pause'; reason: ControlledPauseReason }>
  | Readonly<{ type: 'dismiss-tutorial'; trigger: TutorialTrigger }>
  | Readonly<{ type: 'resume' | 'close-shift' }>
  | Readonly<{ type: 'switch-station'; station: StationId }>
  | Readonly<{ type: 'select-order'; orderId: string }>
