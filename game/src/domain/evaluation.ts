import type {
  CardDesign,
  CardLayer,
  CommissionId,
  Evaluation,
  EvaluationPart,
  StickerLayer,
  StrokeLayer,
  TextStampLayer,
} from './types'

type MissionScores = Readonly<{
  paper: number
  elements: number
  layout: number
  clarity: number
  neatness: number
}>

const MAXIMUMS = {
  paper: 20,
  elements: 30,
  layout: 25,
  clarity: 15,
  neatness: 10,
} as const

const LABELS = {
  paper: '卡纸搭配',
  elements: '订单元素',
  layout: '版面布局',
  clarity: '信息清晰',
  neatness: '制作工整',
} as const

const THRESHOLDS: Record<CommissionId, number> = {
  chino: 60,
  rize: 65,
  'chiya-sharo': 70,
}

const LAYOUT_ADVICE: Record<CommissionId, string> = {
  chino: '杯子靠左、文字靠右，小兔保持小巧，画面会更整齐。',
  rize: '让标题居中、缎带垫底，并把两颗星摆得更平衡。',
  'chiya-sharo': '茶杯放在下半区，花朵分散到指定位置，桌面线留在底部。',
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const fractionScore = (matches: readonly boolean[], maximum: number) => {
  if (matches.length === 0) return 0
  return Math.round((matches.filter(Boolean).length / matches.length) * maximum)
}

const stickerLayers = (design: CardDesign, assetToken: string): readonly StickerLayer[] =>
  design.layers.filter(
    (layer): layer is StickerLayer =>
      layer.kind === 'sticker' && layer.assetId.toLowerCase().includes(assetToken),
  )

const textLayers = (design: CardDesign, text: string): readonly TextStampLayer[] =>
  design.layers.filter(
    (layer): layer is TextStampLayer => layer.kind === 'text-stamp' && layer.text.includes(text),
  )

const strokeLayers = (design: CardDesign): readonly StrokeLayer[] =>
  design.layers.filter((layer): layer is StrokeLayer => layer.kind === 'stroke')

const inRange = (value: number, minimum: number, maximum: number) =>
  value >= minimum && value <= maximum

const approximateOverlap = (left: StickerLayer | TextStampLayer, right: CardLayer) => {
  if (right.kind === 'stroke') return false
  const horizontalDistance = Math.abs(left.x - right.x)
  const verticalDistance = Math.abs(left.y - right.y)
  return (
    horizontalDistance < (left.scale + right.scale) * 0.42 &&
    verticalDistance < (left.scale + right.scale) * 0.24
  )
}

const clarityScore = (design: CardDesign, requiredText: string) => {
  const labels = textLayers(design, requiredText)
  if (labels.length === 0) return 0
  const isClear = labels.every((label) =>
    design.layers.every((layer) => layer.id === label.id || !approximateOverlap(label, layer)),
  )
  return isClear ? MAXIMUMS.clarity : 7
}

const layerIsNeat = (layer: CardLayer) => {
  if (layer.kind === 'stroke') {
    return (
      layer.width > 0 &&
      layer.points.length > 0 &&
      layer.points.length <= 128 &&
      layer.points.every((point) => inRange(point.x, 0, 1) && inRange(point.y, 0, 1))
    )
  }
  return (
    inRange(layer.x, 0.05, 0.95) &&
    inRange(layer.y, 0.05, 0.95) &&
    layer.scale > 0 &&
    layer.scale <= 0.8 &&
    Number.isFinite(layer.rotation)
  )
}

const neatnessScore = (design: CardDesign) => {
  if (design.layers.length === 0) return 0
  const legalStrokeCount = strokeLayers(design).length <= 20
  return legalStrokeCount
    ? fractionScore(design.layers.map(layerIsNeat), MAXIMUMS.neatness)
    : 0
}

const toEvaluation = (
  commissionId: CommissionId,
  scores: MissionScores,
): Evaluation => {
  const parts: readonly EvaluationPart[] = (
    Object.keys(MAXIMUMS) as readonly (keyof MissionScores)[]
  ).map((key) => ({
    key,
    label: LABELS[key],
    score: clamp(Math.round(scores[key]), 0, MAXIMUMS[key]),
    maxScore: MAXIMUMS[key],
  }))
  const totalScore = parts.reduce((total, part) => total + part.score, 0)
  const adviceByKey: Record<keyof MissionScores, string> = {
    paper: '换成订单指定的卡纸，会更贴合这份委托。',
    elements: '先把订单票上的必需装饰补齐。',
    layout: LAYOUT_ADVICE[commissionId],
    clarity: '给文字周围多留一些空白，会更容易读清。',
    neatness: '把装饰收回卡面安全区，成品会更工整。',
  }
  const advice = [...parts]
    .filter((part) => part.score < part.maxScore)
    .sort(
      (left, right) =>
        left.score / left.maxScore - right.score / right.maxScore,
    )
    .slice(0, 2)
    .map((part) => adviceByKey[part.key])

  return {
    commissionId,
    passed: totalScore >= THRESHOLDS[commissionId],
    totalScore,
    parts,
    advice,
  }
}

export function evaluateChino(design: CardDesign): Evaluation {
  const cups = stickerLayers(design, 'coffee-cup')
  const rabbits = stickerLayers(design, 'rabbit')
  const thanks = textLayers(design, '谢谢光临')
  const cup = cups[0]
  const rabbit = rabbits[0]
  const label = thanks[0]

  return toEvaluation('chino', {
    paper: design.paperId === 'cream' ? MAXIMUMS.paper : 0,
    elements: fractionScore(
      [cups.length >= 1, thanks.length >= 1, rabbits.length >= 1],
      MAXIMUMS.elements,
    ),
    layout: fractionScore(
      [
        cup !== undefined && cup.x <= 0.4 && inRange(cup.scale, 0.2, 0.32),
        label !== undefined && label.x >= 0.55,
        rabbit !== undefined && inRange(rabbit.scale, 0.08, 0.15),
        cup !== undefined && label !== undefined && !approximateOverlap(cup, label),
      ],
      MAXIMUMS.layout,
    ),
    clarity: clarityScore(design, '谢谢光临'),
    neatness: neatnessScore(design),
  })
}

export function evaluateRize(design: CardDesign): Evaluation {
  const titles = textLayers(design, '今日推荐')
  const cups = stickerLayers(design, 'coffee-cup')
  const ribbons = stickerLayers(design, 'ribbon')
  const stars = stickerLayers(design, 'star')
  const title = titles[0]
  const cup = cups[0]
  const ribbon = ribbons[0]
  const leftStar = [...stars].sort((left, right) => left.x - right.x)[0]
  const rightStar = [...stars].sort((left, right) => left.x - right.x)[1]
  const ribbonIndex = ribbon === undefined ? -1 : design.layers.findIndex((layer) => layer.id === ribbon.id)
  const cupIndex = cup === undefined ? -1 : design.layers.findIndex((layer) => layer.id === cup.id)

  return toEvaluation('rize', {
    paper: design.paperId === 'coffee' ? MAXIMUMS.paper : 0,
    elements: fractionScore(
      [titles.length >= 1, cups.length >= 1, ribbons.length >= 1, stars.length >= 2],
      MAXIMUMS.elements,
    ),
    layout: fractionScore(
      [
        title !== undefined && inRange(title.x, 0.35, 0.65) && title.y <= 0.3,
        cup !== undefined && inRange(cup.x, 0.35, 0.65) && inRange(cup.scale, 0.24, 0.36),
        ribbon !== undefined && ribbon.y >= 0.65 && ribbonIndex < cupIndex,
        leftStar !== undefined &&
          rightStar !== undefined &&
          Math.abs(leftStar.x + rightStar.x - 1) <= 0.15 &&
          Math.abs(leftStar.y - rightStar.y) <= 0.08 &&
          Math.abs(leftStar.scale - rightStar.scale) <= 0.03,
      ],
      MAXIMUMS.layout,
    ),
    clarity: clarityScore(design, '今日推荐'),
    neatness: neatnessScore(design),
  })
}

export function evaluateChiyaSharo(design: CardDesign): Evaluation {
  const cups = stickerLayers(design, 'tea-cup')
  const flowers = stickerLayers(design, 'flower')
  const titles = textLayers(design, '午后茶会')
  const strokes = strokeLayers(design)
  const title = titles[0]

  return toEvaluation('chiya-sharo', {
    paper: design.paperId === 'mint' ? MAXIMUMS.paper : 0,
    elements: fractionScore(
      [cups.length >= 2, flowers.length >= 3, titles.length >= 1, strokes.length >= 1],
      MAXIMUMS.elements,
    ),
    layout: fractionScore(
      [
        cups.length >= 2 &&
          cups.every(
            (cup) => cup.y >= 0.5 && inRange(cup.scale, 0.16, 0.24) && Math.abs(cup.rotation) <= 15,
          ),
        flowers.some((flower) => flower.x < 0.35 && flower.y < 0.4) &&
          flowers.some((flower) => flower.x > 0.65 && flower.y < 0.4) &&
          flowers.some((flower) => flower.y > 0.55),
        title !== undefined && inRange(title.x, 0.35, 0.65) && title.y <= 0.3,
        strokes.length === 1 && strokes[0].points.every((point) => point.y >= 0.85),
      ],
      MAXIMUMS.layout,
    ),
    clarity: clarityScore(design, '午后茶会'),
    neatness: neatnessScore(design),
  })
}

export function evaluateCommission(
  commissionId: CommissionId,
  design: CardDesign,
): Evaluation {
  switch (commissionId) {
    case 'chino':
      return evaluateChino(design)
    case 'rize':
      return evaluateRize(design)
    case 'chiya-sharo':
      return evaluateChiyaSharo(design)
  }
}
