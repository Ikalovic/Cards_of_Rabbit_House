import type {
  CardDesign,
  CommissionId,
  PaperId,
  StickerLayer,
  TextStampLayer,
} from '../domain/types'

export type DialogueLine = Readonly<{
  speaker: string
  text: string
  expression?: string
}>

export type Commission = Readonly<{
  id: CommissionId
  number: string
  title: string
  shortTitle: string
  customer: string
  paperId: PaperId
  paperLabel: string
  threshold: number
  art: string
  accent: string
  intro: readonly DialogueLine[]
  branch: Readonly<{
    prompt: string
    options: readonly Readonly<{ label: string; response: DialogueLine }>[]
  }>
  requirements: readonly string[]
  successLine: DialogueLine
  retryLine: DialogueLine
}>

export const COMMISSION_ORDER: readonly CommissionId[] = ['chino', 'rize', 'chiya-sharo']

export const COMMISSIONS: Record<CommissionId, Commission> = {
  chino: {
    id: 'chino',
    number: '01',
    title: '智乃的咖啡感谢卡',
    shortTitle: '咖啡感谢卡',
    customer: '智乃',
    paperId: 'cream',
    paperLabel: '奶油白卡纸',
    threshold: 60,
    art: '/assets/characters/cocoa-chino-tippy-api.png',
    accent: '#76a8bc',
    intro: [
      { speaker: '心爱', text: '欢迎来 Rabbit House 值班！今天我就是你的制卡姐姐了！' },
      { speaker: '智乃', text: '请不要擅自增加并不存在的职位。' },
      { speaker: '智乃', text: '第一张是给常客的感谢卡。不需要太华丽，让心意一眼能看清就好。' },
    ],
    branch: {
      prompt: '你想怎么回答？',
      options: [
        { label: '从简洁的版面开始', response: { speaker: '智乃', text: '嗯，这样比较稳妥。' } },
        { label: '先挑一枚小兔贴纸', response: { speaker: '心爱', text: '看吧，兔子果然是必需品！' } },
      ],
    },
    requirements: [
      '使用奶油白卡纸',
      '左侧放一只咖啡杯',
      '右侧放“谢谢光临”字章',
      '加一枚小巧的兔兔贴纸',
    ],
    successLine: { speaker: '智乃', text: '很清楚，也很有心意。谢谢你。' },
    retryLine: { speaker: '智乃', text: '已经很接近了。再把最显眼的一处整理一下吧。' },
  },
  rize: {
    id: 'rize',
    number: '02',
    title: '理世的活动邀请卡',
    shortTitle: '活动邀请卡',
    customer: '理世',
    paperId: 'coffee',
    paperLabel: '咖啡棕卡纸',
    threshold: 65,
    art: '/assets/characters/rize-api.png',
    accent: '#78638e',
    intro: [
      { speaker: '理世', text: '第二份任务是活动邀请卡。目标是标题清晰、重心稳定。' },
      { speaker: '理世', text: '缎带放在底层，两颗星左右配置。先确认队形，再冲印。' },
      { speaker: '心爱', text: '原来理世最想要的是可爱呀。' },
      { speaker: '理世', text: '那是视线平衡！……当然，好看也很重要。' },
    ],
    branch: {
      prompt: '你准备如何布置两颗星？',
      options: [
        { label: '像队形一样左右呼应', response: { speaker: '理世', text: '很好，配置目标一致。' } },
        { label: '让它们像小灯一样发亮', response: { speaker: '理世', text: '形容得很可爱……不，很准确。' } },
      ],
    },
    requirements: [
      '使用咖啡棕卡纸',
      '上方居中放“今日推荐”',
      '咖啡杯放在画面中心',
      '缎带在底层，两颗星左右平衡',
    ],
    successLine: { speaker: '理世', text: '配置清晰，重心很稳。这次任务完成得很漂亮。' },
    retryLine: { speaker: '理世', text: '别急，先重整最不稳的部分，再进行一次检查。' },
  },
  'chiya-sharo': {
    id: 'chiya-sharo',
    number: '03',
    title: '千夜与纱路的午后茶会卡',
    shortTitle: '午后茶会卡',
    customer: '千夜与纱路',
    paperId: 'mint',
    paperLabel: '薄荷绿卡纸',
    threshold: 70,
    art: '/assets/characters/chiya-syaro-api.png',
    accent: '#5f8d75',
    intro: [
      { speaker: '千夜', text: '最后一张，就叫“翠风轻拂、百花为茶歌唱的……”' },
      { speaker: '纱路', text: '等等，名字还没念完卡片就已经放不下了！就写“午后茶会”！' },
      { speaker: '千夜', text: '那我来准备花园和风，留白就拜托纱路了。' },
      { speaker: '纱路', text: '别把风也塞到卡上！你只要让花别挡住字就好。' },
    ],
    branch: {
      prompt: '你要先回应谁的想法？',
      options: [
        { label: '先给千夜看花的位置', response: { speaker: '千夜', text: '真好，它们已经开始在卡上散步了。' } },
        { label: '先给纱路看标题留白', response: { speaker: '纱路', text: '对，这样客人总算能第一眼看懂了。' } },
      ],
    },
    requirements: [
      '使用薄荷绿卡纸',
      '两只茶杯放在下半部',
      '三朵花分开点缀卡面',
      '“午后茶会”周围保持清爽',
      '在底部画一笔浅色桌面线',
    ],
    successLine: { speaker: '千夜', text: '花和茶都找到了自己的位置，真像一首小诗。' },
    retryLine: { speaker: '纱路', text: '氛围已经有了，接下来只要让标题更好读！' },
  },
}

export const commissionFor = (commissionId: CommissionId) => COMMISSIONS[commissionId]

export function requirementChecks(commission: Commission, design: CardDesign): readonly boolean[] {
  const stickers = (assetId: string) =>
    design.layers.filter(
      (layer): layer is StickerLayer => layer.kind === 'sticker' && layer.assetId === assetId,
    )
  const texts = (text: string) =>
    design.layers.filter(
      (layer): layer is TextStampLayer => layer.kind === 'text-stamp' && layer.text === text,
    )

  if (commission.id === 'chino') {
    const cup = stickers('coffee-cup')[0]
    const label = texts('谢谢光临')[0]
    const rabbit = stickers('rabbit')[0]
    return [
      design.paperId === 'cream',
      cup !== undefined && cup.x <= 0.4 && cup.scale >= 0.2 && cup.scale <= 0.32,
      label !== undefined && label.x >= 0.55,
      rabbit !== undefined && rabbit.scale >= 0.08 && rabbit.scale <= 0.15,
    ]
  }
  if (commission.id === 'rize') {
    const title = texts('今日推荐')[0]
    const cup = stickers('coffee-cup')[0]
    const ribbon = stickers('ribbon')[0]
    const stars = [...stickers('star')].sort((left, right) => left.x - right.x)
    const ribbonIndex = ribbon === undefined ? -1 : design.layers.findIndex((layer) => layer.id === ribbon.id)
    const cupIndex = cup === undefined ? -1 : design.layers.findIndex((layer) => layer.id === cup.id)
    return [
      design.paperId === 'coffee',
      title !== undefined && title.x >= 0.35 && title.x <= 0.65 && title.y <= 0.3,
      cup !== undefined && cup.x >= 0.35 && cup.x <= 0.65,
      ribbon !== undefined && ribbonIndex < cupIndex && stars.length >= 2 &&
        Math.abs(stars[0].x + stars[1].x - 1) <= 0.15 &&
        Math.abs(stars[0].y - stars[1].y) <= 0.08,
    ]
  }
  const cups = stickers('tea-cup')
  const flowers = stickers('flower')
  const title = texts('午后茶会')[0]
  const strokes = design.layers.filter((layer) => layer.kind === 'stroke')
  return [
    design.paperId === 'mint',
    cups.length >= 2 && cups.every((cup) => cup.y >= 0.5),
    flowers.some((flower) => flower.x < 0.35 && flower.y < 0.4) &&
      flowers.some((flower) => flower.x > 0.65 && flower.y < 0.4) &&
      flowers.some((flower) => flower.y > 0.55),
    title !== undefined && title.x >= 0.35 && title.x <= 0.65 && title.y <= 0.3,
    strokes.length === 1 && strokes[0].points.every((point) => point.y >= 0.85),
  ]
}
