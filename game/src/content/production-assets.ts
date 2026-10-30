export type AssetFocus = Readonly<{ x: number; y: number }>

export type CharacterCrop = Readonly<{
  id: string
  x: number
  y: number
  width: number
  height: number
  /** Focus within the crop, using coordinates from zero to one. */
  focus?: AssetFocus
}>

type CosmeticAsset = Readonly<{
  id: string
  label: string
  alt: string
  src: `/assets/${string}`
  usage: 'cosmetic'
  /** Focus within the source image, using coordinates from zero to one. */
  focus: AssetFocus
}>

export type ProductionAsset = CosmeticAsset & (
  | Readonly<{ kind: 'background' }>
  | Readonly<{ kind: 'character-sheet'; dimensions: Readonly<{ width: number; height: number }>; crops: readonly CharacterCrop[] }>
)

// These images and normalized crops are cosmetic presentation data only.
// Scores, puzzle answers, and progression never depend on image pixels.
export const PRODUCTION_ASSETS = [
  {
    id: 'card-workbench', kind: 'background', label: '制卡工作台',
    alt: '暖色木桌上的卡纸与手工工具',
    src: '/assets/backgrounds/card-workbench-background.png',
    usage: 'cosmetic', focus: { x: 0.5, y: 0.58 },
  },
  {
    id: 'print-workshop', kind: 'background', label: '冲印工坊',
    alt: '木质工坊里的冲印设备与纸张',
    src: '/assets/backgrounds/print-workshop-background.png',
    usage: 'cosmetic', focus: { x: 0.5, y: 0.5 },
  },
  {
    id: 'rabbit-house-exterior', kind: 'background', label: 'Rabbit House 门前',
    alt: '小镇街道上的温暖咖啡馆外景',
    src: '/assets/backgrounds/rabbit-house-exterior.png',
    usage: 'cosmetic', focus: { x: 0.5, y: 0.5 },
  },
  {
    id: 'rabbit-house-interior', kind: 'background', label: 'Rabbit House 店内',
    alt: '柔和灯光照亮咖啡馆的木质吧台与座席',
    src: '/assets/backgrounds/rabbit-house-interior-api.png',
    usage: 'cosmetic', focus: { x: 0.5, y: 0.5 },
  },
  {
    id: 'cocoa-chino-tippy', kind: 'character-sheet', label: '心爱、智乃与提比',
    alt: '心爱与智乃并肩站立，提比趴在智乃头上',
    src: '/assets/characters/cocoa-chino-tippy-api.png',
    dimensions: { width: 1024, height: 1536 },
    usage: 'cosmetic', focus: { x: 0.54, y: 0.17 },
    // The overlapping figures use portrait crops instead of body cutouts.
    crops: [
      { id: 'cocoa', x: 0.3, y: 0.03, width: 0.27, height: 0.21, focus: { x: 0.55, y: 0.57 } },
      { id: 'chino', x: 0.555, y: 0.095, width: 0.215, height: 0.175, focus: { x: 0.45, y: 0.62 } },
      { id: 'tippy', x: 0.585, y: 0.01, width: 0.165, height: 0.095, focus: { x: 0.5, y: 0.55 } },
    ],
  },
  {
    id: 'chiya-syaro', kind: 'character-sheet', label: '千夜与纱路',
    alt: '千夜捧着花边卡片，纱路在旁边说话',
    src: '/assets/characters/chiya-syaro-api.png',
    dimensions: { width: 1024, height: 1536 },
    usage: 'cosmetic', focus: { x: 0.5, y: 0.18 },
    crops: [
      { id: 'chiya', x: 0.155, y: 0.01, width: 0.31, height: 0.24, focus: { x: 0.56, y: 0.6 } },
      { id: 'syaro', x: 0.5, y: 0.015, width: 0.36, height: 0.26, focus: { x: 0.43, y: 0.65 } },
    ],
  },
  {
    id: 'rize', kind: 'character-sheet', label: '理世',
    alt: '理世拿着星星与缎带装饰的卡片',
    src: '/assets/characters/rize-api.png',
    dimensions: { width: 1024, height: 1536 },
    usage: 'cosmetic', focus: { x: 0.5, y: 0.16 },
    crops: [
      { id: 'rize', x: 0.31, y: 0, width: 0.34, height: 0.3, focus: { x: 0.53, y: 0.43 } },
    ],
  },
  {
    id: 'production-floor', kind: 'background', label: '制卡工坊全景',
    alt: '奶油色与柔和青绿色点缀的木质制卡工坊，各处工位整齐相连',
    src: '/assets/production/backgrounds/production-floor.png',
    usage: 'cosmetic', focus: { x: 0.5, y: 0.5 },
  },
  {
    id: 'maya', kind: 'character-sheet', label: '麻耶',
    alt: '戴着校帽、笑着招手的条河麻耶',
    src: '/assets/production/customers/maya.png', dimensions: { width: 152, height: 318 },
    usage: 'cosmetic', focus: { x: 0.48, y: 0.2 },
    crops: [{ id: 'maya', x: 41 / 152, y: 25 / 318, width: 65 / 152, height: 75 / 318, focus: { x: 0.5, y: 0.5 } }],
  },
  {
    id: 'megu', kind: 'character-sheet', label: '惠',
    alt: '穿着水手校服、神情温柔的奈津惠',
    src: '/assets/production/customers/megu.png', dimensions: { width: 149, height: 290 },
    usage: 'cosmetic', focus: { x: 0.5, y: 0.23 },
    crops: [{ id: 'megu', x: 44 / 149, y: 31 / 290, width: 61 / 149, height: 70 / 290, focus: { x: 0.5, y: 0.5 } }],
  },
  {
    id: 'aoyama', kind: 'character-sheet', label: '青山',
    alt: '穿着蓝色长裙、带着从容微笑的青山翠',
    src: '/assets/production/customers/aoyama.png', dimensions: { width: 214, height: 410 },
    usage: 'cosmetic', focus: { x: 0.55, y: 0.15 },
    crops: [{ id: 'aoyama', x: 74 / 214, y: 6 / 410, width: 88 / 214, height: 105 / 410, focus: { x: 0.5, y: 0.5 } }],
  },
  {
    id: 'rin', kind: 'character-sheet', label: '凛',
    alt: '短发、穿着黄色外套的责任编辑真手凛',
    src: '/assets/production/customers/rin.png', dimensions: { width: 382, height: 687 },
    usage: 'cosmetic', focus: { x: 0.6, y: 0.12 },
    crops: [{ id: 'rin', x: 156 / 382, y: 5 / 687, width: 147 / 382, height: 158 / 687, focus: { x: 0.5, y: 0.5 } }],
  },
  {
    id: 'moka', kind: 'character-sheet', label: '摩卡',
    alt: '穿着绿色围裙、亲切地举手招呼的保登摩卡',
    src: '/assets/production/customers/moka.png', dimensions: { width: 212, height: 409 },
    usage: 'cosmetic', focus: { x: 0.51, y: 0.14 },
    crops: [{ id: 'moka', x: 59 / 212, y: 3 / 409, width: 98 / 212, height: 112 / 409, focus: { x: 0.5, y: 0.5 } }],
  },
  {
    id: 'yura', kind: 'character-sheet', label: '结良',
    alt: '紫红色头发、穿着女仆服并拿着吹箭的狩手结良',
    src: '/assets/production/customers/yura.png', dimensions: { width: 351, height: 485 },
    usage: 'cosmetic', focus: { x: 0.65, y: 0.2 },
    crops: [{ id: 'yura', x: 144 / 351, y: 10 / 485, width: 170 / 351, height: 175 / 485, focus: { x: 0.5, y: 0.5 } }],
  },
  {
    id: 'fuyu', kind: 'character-sheet', label: '冬优',
    alt: '蓝紫色短发、穿着深色外套的风衣叶冬优',
    src: '/assets/production/customers/fuyu.png', dimensions: { width: 324, height: 465 },
    usage: 'cosmetic', focus: { x: 0.53, y: 0.22 },
    crops: [{ id: 'fuyu', x: 101 / 324, y: 31 / 465, width: 140 / 324, height: 137 / 465, focus: { x: 0.5, y: 0.5 } }],
  },
  {
    id: 'natsume', kind: 'character-sheet', label: '夏明',
    alt: '金色短发、俏皮地眨着眼睛的神沙夏明',
    src: '/assets/production/customers/natsume.png', dimensions: { width: 355, height: 483 },
    usage: 'cosmetic', focus: { x: 0.49, y: 0.2 },
    crops: [{ id: 'natsume', x: 110 / 355, y: 29 / 483, width: 131 / 355, height: 133 / 483, focus: { x: 0.5, y: 0.5 } }],
  },
  {
    id: 'elulu', kind: 'character-sheet', label: '映月',
    alt: '金色长发、戴着贝雷帽并拿着饮料的神沙映月',
    src: '/assets/production/customers/elulu.png', dimensions: { width: 341, height: 537 },
    usage: 'cosmetic', focus: { x: 0.56, y: 0.27 },
    crops: [{ id: 'elulu', x: 140 / 341, y: 88 / 537, width: 104 / 341, height: 116 / 537, focus: { x: 0.5, y: 0.5 } }],
  },
] as const satisfies readonly ProductionAsset[]

export type BackgroundAssetId = Extract<(typeof PRODUCTION_ASSETS)[number], { kind: 'background' }>['id']

type CharacterSheetAsset = Extract<(typeof PRODUCTION_ASSETS)[number], { kind: 'character-sheet' }>
export type CharacterPortrait = {
  [Sheet in CharacterSheetAsset as Sheet['id']]: Readonly<{
    assetId: Sheet['id']
    cropId: Sheet['crops'][number]['id']
  }>
}[CharacterSheetAsset['id']]
