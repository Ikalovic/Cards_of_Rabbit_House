import type {
  AuthoredStageDefinition, AuthoredStageId, CatalogItem, CraftKind, CraftRequirement,
  CustomerIdentity, ElementKind, LayoutDefinition, MaterialCost, MaterialDefinition,
  MaterialId, MaterialInventory, OfficialCharacterId, OrderCriterion, OrderRequirements, OrderTemplate,
  PaperDefinition, RequiredElement, ScheduledCustomer, ShapeDefinition, SlotDefinition,
  SurfaceFinishId, SurvivalStageDefinition,
} from '../domain/shift-types'
import { createRng, forkRng, nextRandom, pickRandom, randomInt, shuffleRandom } from '../domain/shift-rng'
import { ownValue } from '../domain/own-value'

function item<Id extends string>(
  id: Id, label: string, tags: readonly string[] = [], materialId?: MaterialId,
): CatalogItem<Id> {
  return { id, label, tags, materialCosts: materialId ? [{ materialId, quantity: 1 }] : [] }
}

export const PAPERS: readonly PaperDefinition[] = [
  { ...item('cream', '奶油白', ['warm', 'clear']), color: '#fff5df', materialId: 'smooth' },
  { ...item('coffee', '咖啡棕', ['coffee', 'warm']), color: '#a47758', materialId: 'smooth' },
  { ...item('mint', '薄荷绿', ['garden', 'restrained']), color: '#bad8c8', materialId: 'textured' },
  { ...item('pink', '樱花粉', ['warm', 'rabbit']), color: '#efc5cf', materialId: 'smooth' },
  { ...item('sky', '天空蓝', ['clear', 'stable']), color: '#b9d7ed', materialId: 'smooth' },
  { ...item('lilac', '丁香紫', ['refined'], 'pearl-paper'), color: '#cdbbdc', materialId: 'pearl' },
  { ...item('midnight', '深夜蓝', ['midnight', 'layered', 'star'], 'linen-paper'), color: '#354568', materialId: 'linen' },
  { ...item('kraft', '牛皮纸', ['restrained', 'warm']), color: '#c3a174', materialId: 'kraft' },
]

export const SHAPES: readonly ShapeDefinition[] = [
  { ...item('landscape', '横卡'), orientation: 'landscape' },
  { ...item('portrait', '竖卡'), orientation: 'portrait' },
  { ...item('folded', '折叠卡'), orientation: 'landscape' },
  { ...item('square', '方卡'), orientation: 'landscape' },
  { ...item('ticket', '票券卡', [], 'shaped-blank'), orientation: 'landscape' },
  { ...item('tag', '吊牌卡', [], 'shaped-blank'), orientation: 'portrait' },
]

function slot(id: string, label: string, kind: ElementKind, x: number, y: number): SlotDefinition {
  return {
    id, label, accepts: [kind], sizes: kind === 'motif' ? ['medium', 'large'] : ['small', 'medium'],
    directions: ['upright', 'left', 'right'], layers: ['back', 'front'],
    x, y, width: kind === 'motif' ? 0.38 : 0.24, height: kind === 'motif' ? 0.4 : 0.18,
  }
}

function layout(id: string, label: string, tags: readonly string[], x: number, y: number): LayoutDefinition {
  return {
    ...item(id, label, tags),
    slots: [
      slot('main', '主体位', 'motif', x, y),
      slot('title', '字章位', 'word-stamp', 0.5, 0.16),
      slot('left', '左饰位', 'decoration', 0.19, 0.78),
      slot('right', '右饰位', 'decoration', 0.81, 0.78),
      { ...slot('frame', '边框位', 'border', 0.5, 0.5), width: 0.94, height: 0.94 },
    ],
  }
}

export const LAYOUTS: readonly LayoutDefinition[] = [
  layout('welcome', '暖心迎宾', ['warm', 'busy'], 0.5, 0.5),
  layout('clear-note', '清爽便笺', ['clear', 'whitespace', 'readable'], 0.3, 0.5),
  layout('balanced', '稳稳对称', ['stable', 'layered'], 0.5, 0.46),
  layout('garden', '花园回响', ['garden', 'decorative-echo'], 0.5, 0.56),
  layout('refined', '精致留白', ['refined', 'restrained', 'readable'], 0.65, 0.5),
  layout('postcard', '旅途明信', ['clear', 'whitespace'], 0.3, 0.56),
  layout('ribbon-band', '缎带横幅', ['ribbon', 'layered'], 0.5, 0.4),
  layout('star-corner', '星角舞台', ['star', 'layered'], 0.65, 0.55),
  layout('tea-menu', '茶会小笺', ['garden', 'readable'], 0.35, 0.5),
  layout('rabbit-party', '兔兔聚会', ['rabbit', 'busy', 'warm'], 0.55, 0.58),
  layout('keepsake', '纪念相册', ['clear', 'whitespace', 'refined', 'decorative-echo'], 0.48, 0.52),
  layout('shop-ticket', '店铺票面', ['restrained', 'stable', 'readable'], 0.7, 0.5),
]

export const BORDERS = [
  item('plain-line', '细线边框', ['clear']), item('double-line', '双线边框', ['stable']),
  item('dotted', '点点边框', ['busy']), item('coffee-beans', '咖啡豆边框', ['coffee']),
  item('leaf-vine', '叶蔓边框', ['garden']), item('rabbit-ears', '兔耳边框', ['rabbit']),
  item('star-trail', '星轨边框', ['star']), item('lace', '蕾丝花边', ['refined', 'garden'], 'lace'),
  item('gilded', '鎏金边框', ['refined'], 'special-border'),
  item('ribbon-frame', '缎带边框', ['ribbon', 'layered'], 'special-border'),
] as const

export const MOTIFS = [
  item('coffee-cup', '热咖啡', ['coffee']), item('coffee-pot', '手冲咖啡壶', ['coffee']),
  item('coffee-bean', '咖啡豆', ['coffee']), item('rabbit', '小白兔', ['rabbit', 'warm']),
  item('rabbit-pair', '双兔作伴', ['rabbit', 'busy']), item('rabbit-house', '兔兔小屋', ['rabbit', 'warm']),
  item('tea-cup', '花茶杯', ['garden']), item('tea-pot', '花园茶壶', ['garden']),
  item('bouquet', '小花束', ['garden']), item('rose', '玫瑰花', ['garden', 'refined']),
  item('star', '五角星', ['star']), item('moon', '弯月', ['refined']),
  item('ribbon-bow', '蝴蝶结', ['ribbon']), item('book', '纪念册', ['clear']),
  item('shop-sign', '店铺招牌', ['readable']), item('bread', '刚烤好的面包', ['warm']),
  item('camera', '旅行相机', ['stable']), item('envelope', '心意信封', ['restrained']),
] as const

export const DECORATIONS = [
  item('tiny-star', '小星星', ['star']), item('star-pair', '双星', ['star', 'decorative-echo']),
  item('cream-ribbon', '奶油色缎带', ['ribbon', 'warm']), item('blue-ribbon', '蓝色缎带', ['ribbon', 'stable']),
  item('silk-ribbon', '丝绸缎带饰片', ['ribbon', 'refined'], 'premium-decoration'),
  item('tiny-flower', '小花', ['garden']), item('flower-pair', '双生花', ['garden', 'decorative-echo']),
  item('leaf', '嫩叶', ['garden']), item('leaf-pair', '对叶', ['garden', 'decorative-echo']),
  item('coffee-speck', '咖啡小点', ['coffee']), item('bean-pair', '双咖啡豆', ['coffee', 'decorative-echo']),
  item('rabbit-paw', '兔兔脚印', ['rabbit']), item('rabbit-tail', '兔兔绒尾', ['rabbit', 'warm']),
  item('heart', '小爱心', ['warm']), item('heart-pair', '双心', ['warm', 'busy']),
  item('dot', '圆点', ['clear']), item('stripe', '短条纹', ['stable']),
  item('check', '小格纹', ['stable']), item('sparkle', '闪光', ['busy']),
  item('pearl', '珍珠饰片', ['refined'], 'premium-decoration'),
  item('pressed-flower', '压花饰片', ['garden', 'refined'], 'premium-decoration'),
  item('lace-corner', '蕾丝角花', ['refined', 'decorative-echo'], 'lace'),
  item('gold-star', '金色星片', ['star', 'refined'], 'premium-decoration'),
  item('tiny-bell', '小铃铛', ['busy']),
] as const

export const WORD_STAMPS = [
  item('welcome', '欢迎光临', ['warm', 'readable']), item('thanks', '谢谢光临', ['clear', 'readable']),
  item('recommendation', '今日推荐', ['readable']), item('tea-party', '午后茶会', ['garden', 'readable']),
  item('good-day', '祝你愉快', ['warm']), item('friendship', '友谊纪念', ['warm']),
  item('anniversary', '周年纪念', ['refined']), item('invitation', '诚挚邀请', ['refined']),
  item('rabbit-house', '兔子之家', ['rabbit', 'readable']), item('best-wishes', '美好祝愿', ['restrained']),
] as const

const ELEMENT_ASSETS: Readonly<Record<string, readonly CatalogItem[]>> = {
  motif: MOTIFS, 'word-stamp': WORD_STAMPS, decoration: DECORATIONS, border: BORDERS,
}

export function findProductionAsset(kind: unknown, assetId: unknown): CatalogItem | undefined {
  return typeof kind === 'string' && typeof assetId === 'string'
    ? ownValue(ELEMENT_ASSETS, kind)?.find(asset => asset.id === assetId) : undefined
}

export const SURFACE_FINISHES: readonly CatalogItem<SurfaceFinishId>[] = [
  item('matte', '哑光', ['restrained']), item('gloss', '亮面', ['glossy']),
  item('foil', '烫金', ['refined'], 'foil-sheet'),
  item('emboss', '压纹', ['layered'], 'emboss-sheet'),
  item('wax', '蜡封', ['refined'], 'wax'),
]

export const MATERIALS: readonly MaterialDefinition[] = [
  { id: 'pearl-paper', label: '珠光卡纸', consumeOn: 'cut-blank' },
  { id: 'linen-paper', label: '棉麻卡纸', consumeOn: 'cut-blank' },
  { id: 'shaped-blank', label: '异形卡胚', consumeOn: 'cut-blank' },
  { id: 'lace', label: '花边', consumeOn: 'fix-assembly' },
  { id: 'special-border', label: '特殊边框', consumeOn: 'fix-assembly' },
  { id: 'premium-decoration', label: '高级饰片', consumeOn: 'fix-assembly' },
  { id: 'special-ribbon', label: '特殊缎带', consumeOn: 'first-craft-action' },
  { id: 'foil-sheet', label: '烫金纸', consumeOn: 'first-craft-action' },
  { id: 'emboss-sheet', label: '压纹片', consumeOn: 'first-craft-action' },
  { id: 'wax', label: '蜡封材料', consumeOn: 'first-craft-action' },
]

function criterion(id: string, label: string, tags: readonly string[], materialId?: MaterialId): OrderCriterion {
  return { id, label, tags, rule: { kind: 'tags', tags, match: 'all' }, optionalMaterialCosts: materialId ? [{ materialId, quantity: 1 }] : [] }
}

function required(kind: ElementKind, assetId: string): RequiredElement {
  const catalogs: Record<ElementKind, readonly CatalogItem[]> = { motif: MOTIFS, 'word-stamp': WORD_STAMPS, decoration: DECORATIONS, border: BORDERS }
  const asset = catalogs[kind].find((candidate) => candidate.id === assetId)
  if (!asset) throw new Error(`Unknown ${kind}: ${assetId}`)
  return { id: `${kind}:${assetId}`, kind, assetId, label: asset.label, quantity: 1 }
}

function craft(kind: CraftKind): CraftRequirement {
  const labels = { stamp: '对准盖章，压力保持在标线内', trim: '沿目标线裁边', ribbon: '固定蓝色缎带的两端', foil: '均匀覆盖烫金区域', wax: '使用蓝色星形蜡封，保持目标按压时间' }
  const costs: Partial<Record<CraftKind, MaterialId>> = { ribbon: 'special-ribbon', foil: 'foil-sheet', wax: 'wax' }
  const materialId = costs[kind]
  return {
    id: kind, kind, label: labels[kind],
    targets: kind === 'foil' ? { coverage: { min: 0.85, max: 1 } } : { position: { min: 0.45, max: 0.55 }, [kind === 'ribbon' || kind === 'trim' ? 'length' : kind === 'wax' ? 'time' : 'pressure']: { min: 0.4, max: 0.6 } },
    discrete: kind === 'ribbon' ? { color: 'blue' } : kind === 'wax' ? { color: 'blue', stamp: 'star' } : {},
    materialCosts: materialId ? [{ materialId, quantity: 1 }] : [],
  }
}

function order(
  id: string, title: string, customer: CustomerIdentity,
  paperId: OrderRequirements['paperId'], shapeId: OrderRequirements['shapeId'], layoutId: string,
  elements: readonly RequiredElement[], preferences: readonly OrderCriterion[],
  options: Readonly<{ finish?: SurfaceFinishId; crafts?: readonly CraftKind[]; taboo?: OrderCriterion }> = {},
): OrderTemplate {
  const paper = PAPERS.find((candidate) => candidate.id === paperId)!
  const shape = SHAPES.find((candidate) => candidate.id === shapeId)!
  return {
    id, title, customer, qualityExpectation: 70,
    requirements: { paperId, paperMaterialId: paper.materialId, shapeId, orientation: shape.orientation, layoutId,
      surfaceFinishId: options.finish ?? 'matte', elements, crafts: (options.crafts ?? []).map(craft) },
    preferences,
    taboo: options.taboo ?? criterion('no-busy', '不要过于热闹的密集装饰', ['busy']),
  }
}

export const ORDER_TEMPLATES: readonly OrderTemplate[] = [
  order('cocoa-welcome', '心爱的兔兔欢迎卡', { kind: 'official', characterId: 'cocoa', name: '心爱', situation: '想把今天第一位客人的欢迎卡做得热热闹闹。' },
    'pink', 'landscape', 'welcome', [required('motif', 'rabbit'), required('word-stamp', 'welcome')],
    [criterion('warm-rabbit', '喜欢温暖的颜色与兔兔主题', ['warm', 'rabbit']), criterion('lively', '喜欢热闹一点的构图', ['busy'])],
    { taboo: criterion('no-midnight', '不要深夜般沉静的配色', ['midnight']) }),
  order('chino-coffee', '智乃的咖啡感谢卡', { kind: 'official', characterId: 'chino', name: '智乃', situation: '准备把感谢卡放在今日的咖啡袋里。' },
    'cream', 'landscape', 'clear-note', [required('motif', 'coffee-cup'), required('word-stamp', 'thanks')],
    [criterion('clear-coffee', '喜欢清楚的咖啡主题', ['clear', 'coffee']), criterion('whitespace', '请保留舒适的留白', ['whitespace'])]),
  order('rize-event', '理世的活动卡', { kind: 'official', characterId: 'rize', name: '理世', situation: '活动开始前，想把整齐的宣传卡发给街坊。' },
    'sky', 'landscape', 'balanced', [required('motif', 'star'), required('word-stamp', 'recommendation'), required('decoration', 'blue-ribbon')],
    [criterion('stable-layers', '喜欢稳定、有前后层次的构图', ['layered', 'stable']), criterion('star-ribbon', '星星和缎带相互呼应会更好', ['star', 'ribbon'])]),
  order('chiya-garden', '千夜的花园茶会卡', { kind: 'official', characterId: 'chiya', name: '千夜', situation: '想让午后的茶会邀请像一座小花园。' },
    'mint', 'square', 'garden', [required('motif', 'tea-cup'), required('word-stamp', 'tea-party'), required('border', 'lace')],
    [criterion('garden', '喜欢庭院花园的气氛', ['garden']), criterion('echo', '喜欢装饰呼应，也很喜欢压花饰片', ['decorative-echo'], 'premium-decoration')],
    { finish: 'emboss', crafts: ['stamp'] }),
  order('syaro-shift', '纱路的赶班卡', { kind: 'official', characterId: 'syaro', name: '纱路', situation: '还要赶去 Fleur de Lapin 值班，希望交班前能收到卡。' },
    'cream', 'portrait', 'refined', [required('motif', 'tea-pot'), required('word-stamp', 'good-day')],
    [criterion('refined', '喜欢精致的小细节，例如珍珠饰片', ['refined'], 'premium-decoration'), criterion('restrained-readable', '装饰克制，字章要容易读', ['restrained', 'readable'])]),
  order('chino-keepsake', '智乃的秘密纪念卡', { kind: 'official', characterId: 'chino', name: '智乃', situation: '已经察觉大家的心意，想把咖啡、兔兔、星星与花园一起收进纪念册。' },
    'cream', 'folded', 'keepsake', [required('motif', 'coffee-cup'), required('word-stamp', 'anniversary'), required('decoration', 'rabbit-paw'), required('decoration', 'tiny-star'), required('border', 'leaf-vine')],
    [criterion('clear-coffee', '仍然喜欢清楚的咖啡主题', ['clear', 'coffee']), criterion('whitespace', '回忆很多，也请留一点舒适的空白', ['whitespace'])]),
  order('maya-friendship', '麻耶的友谊小卡', { kind: 'official', characterId: 'maya', name: '麻耶', situation: '想给智乃和小惠一个放学后的小惊喜，笑着催大家把友谊卡一起收好。' },
    'pink', 'folded', 'rabbit-party', [required('motif', 'rabbit-pair'), required('word-stamp', 'friendship')],
    [criterion('warm', '暖暖的颜色，才像和朋友在一起的感觉', ['warm'])], { taboo: criterion('no-coffee', '这次说的是我们的友情，先不放咖啡图案啦', ['coffee']) }),
  order('rin-thanks', '凛的编辑感谢卡', { kind: 'official', characterId: 'rin', name: '凛', situation: '作为青山老师的责任编辑，想向帮忙整理原稿的人道谢，取卡后还得去找老师。' },
    'kraft', 'landscape', 'clear-note', [required('motif', 'envelope'), required('word-stamp', 'thanks')],
    [criterion('readable', '感谢的话请写清楚，别让老师又装作没看见', ['readable'])]),
  order('fuyu-visit', '冬优的小镇到访票卡', { kind: 'official', characterId: 'fuyu', name: '冬优', situation: '从大都市来到小镇，想和智乃留下一张到访 Rabbit House 的纪念票，开口时还有些腼腆。' },
    'coffee', 'ticket', 'shop-ticket', [required('motif', 'camera'), required('word-stamp', 'rabbit-house')],
    [criterion('stable', '票面排整齐一点就好，不用太张扬', ['stable'])]),
  order('moka-tea', '摩卡姐姐的茶会邀请', { kind: 'official', characterId: 'moka', name: '摩卡', situation: '来看望妹妹心爱的摩卡，想邀心爱和店里的大家一起喝茶，把热闹的午后交给姐姐准备。' },
    'mint', 'square', 'tea-menu', [required('motif', 'tea-pot'), required('word-stamp', 'invitation')],
    [criterion('garden', '用花园般的柔和气氛，把大家都迎进来吧', ['garden'])]),
  order('aoyama-keepsake', '青山的取材纪念卡', { kind: 'official', characterId: 'aoyama', name: '青山', situation: '一边为小说取材，一边慢悠悠地挑选纪念册里的新一页，似乎暂时忘了凛还在找她。' },
    'lilac', 'folded', 'keepsake', [required('motif', 'book'), required('word-stamp', 'anniversary'), required('decoration', 'pearl')],
    [criterion('refined', '细致的表面，仿佛能把今天的小故事也留下来', ['refined'])], { finish: 'foil', crafts: ['foil'] }),
  order('yura-gift', '结良的惊喜礼物吊牌', { kind: 'official', characterId: 'yura', name: '结良', situation: '吹箭部部长结良在与理世和后辈集合前，想给礼物配一张小吊牌，还故意卖了个关子。' },
    'cream', 'tag', 'refined', [required('motif', 'envelope'), required('word-stamp', 'best-wishes')],
    [criterion('readable', '祝福要看得清，惊喜就留到拆礼物时吧', ['readable'])]),
  order('megu-ballet', '惠的芭蕾祝福卡', { kind: 'official', characterId: 'megu', name: '惠', situation: '想把熟悉的芭蕾舞步化成一张温柔的祝福卡，认真挑选着像舞裙一样轻巧的蝴蝶结。' },
    'pink', 'portrait', 'ribbon-band', [required('motif', 'ribbon-bow'), required('word-stamp', 'good-day'), required('decoration', 'cream-ribbon')],
    [criterion('warm', '希望收到的人也觉得暖暖的', ['warm']), criterion('ribbon', '缎带像舞步一样轻轻舒展开就好了', ['ribbon'])]),
  order('natsume-friendship', '夏明的同窗友谊卡', { kind: 'official', characterId: 'natsume', name: '夏明', situation: '想回赠麻耶和小惠的心意，礼貌地说明要求，却不好意思直说自己有多珍惜这段友情。' },
    'sky', 'folded', 'balanced', [required('motif', 'envelope'), required('word-stamp', 'friendship'), required('decoration', 'flower-pair')],
    [criterion('stable', '请把卡面排整齐，心意可不能随便放', ['stable']), criterion('echo', '两朵花彼此呼应就好，才不是特意选的呢', ['decorative-echo'])]),
  order('elulu-tea', '映月的午后邀请卡', { kind: 'official', characterId: 'elulu', name: '映月', situation: '想和夏明邀请麻耶、小惠来喝茶，小心翼翼地挑着成对的小花，希望这次相聚还能延续下去。' },
    'mint', 'square', 'tea-menu', [required('motif', 'tea-cup'), required('word-stamp', 'invitation'), required('decoration', 'flower-pair')],
    [criterion('garden', '像花园一样安静的茶会，可以吗', ['garden']), criterion('echo', '请让两朵小花互相陪伴，压花饰片也很漂亮', ['decorative-echo'], 'premium-decoration')]),
]

export function isComplexOrder(order: OrderTemplate): boolean {
  return order.requirements.crafts.length === 2 || ['foil', 'emboss', 'wax'].includes(order.requirements.surfaceFinishId)
}

function emptyInventory(): Record<MaterialId, number> {
  return { 'pearl-paper': 0, 'linen-paper': 0, 'shaped-blank': 0, lace: 0, 'special-border': 0,
    'premium-decoration': 0, 'special-ribbon': 0, 'foil-sheet': 0, 'emboss-sheet': 0, wax: 0 }
}

export function requiredMaterialDemand(orders: readonly OrderTemplate[]): MaterialInventory {
  const demand = emptyInventory()
  const add = (costs: readonly MaterialCost[], quantity = 1) => {
    for (const cost of costs) demand[cost.materialId] += cost.quantity * quantity
  }
  const assets: Record<ElementKind, readonly CatalogItem[]> = { motif: MOTIFS, decoration: DECORATIONS, border: BORDERS, 'word-stamp': WORD_STAMPS }
  for (const { requirements } of orders) {
    add(PAPERS.find((paper) => paper.id === requirements.paperId)!.materialCosts)
    add(SHAPES.find((shape) => shape.id === requirements.shapeId)!.materialCosts)
    for (const element of requirements.elements) add(assets[element.kind].find((asset) => asset.id === element.assetId)!.materialCosts, element.quantity)
    for (const operation of requirements.crafts) add(operation.materialCosts)
    // A foil/wax operation and its visible finish describe the same physical sheet/seal.
    const craftMaterials = new Set(requirements.crafts.flatMap((operation) => operation.materialCosts.map((cost) => cost.materialId)))
    add(SURFACE_FINISHES.find((finish) => finish.id === requirements.surfaceFinishId)!.materialCosts.filter((cost) => !craftMaterials.has(cost.materialId)))
  }
  return demand
}

export function inventoryShortfalls(orders: readonly OrderTemplate[], inventory: MaterialInventory): readonly Readonly<{ materialId: MaterialId; required: number; available: number }>[] {
  const demand = requiredMaterialDemand(orders)
  return MATERIALS.filter((material) => demand[material.id] > inventory[material.id]).map((material) => ({ materialId: material.id, required: demand[material.id], available: inventory[material.id] }))
}

const AUTHORED_INVENTORY: MaterialInventory = {
  'pearl-paper': 2, 'linen-paper': 2, 'shaped-blank': 3, lace: 3, 'special-border': 2,
  'premium-decoration': 1, 'special-ribbon': 2, 'foil-sheet': 2, 'emboss-sheet': 2, wax: 1,
}

function authoredStage(
  id: AuthoredStageId, label: string, templateIds: readonly string[], arrivals: readonly number[],
  patience: readonly number[], lastWait: readonly number[], minDelivered: number, minSatisfied: number,
  puzzleDifficulty: number, calibrationPlans: Readonly<Partial<Record<number, ScheduledCustomer['calibrationPlan']>>>,
): AuthoredStageDefinition {
  return {
    kind: 'authored', id, label, seed: `rabbit-house:${id}:v1`, day: 1, durationSeconds: 720, puzzleDifficulty,
    inspections: 3, freeDemoInspections: id === 'tutorial' ? 1 : 0, inventory: AUTHORED_INVENTORY,
    thresholds: { kind: 'authored', minDelivered, minSatisfied, maxLeft: 1 },
    customers: templateIds.map((templateId, index) => ({
      id: `${id}:customer:${index + 1}`, order: ORDER_TEMPLATES.find((template) => template.id === templateId)!,
      arrivalSeconds: arrivals[index], arrivalBaseSeconds: arrivals[index], arrivalJitterSeconds: 0,
      basePatienceSeconds: patience[index], unadjustedPatienceSeconds: patience[index], lastWaitSeconds: lastWait[index],
      ...(calibrationPlans[index + 1] ? { calibrationPlan: calibrationPlans[index + 1] } : {}),
    })),
  }
}

export const AUTHORED_STAGES: Readonly<Record<AuthoredStageId, AuthoredStageDefinition>> = {
  tutorial: authoredStage('tutorial', '心爱的制卡姐姐初值班',
    ['cocoa-welcome', 'megu-ballet', 'natsume-friendship', 'chiya-garden', 'elulu-tea'],
    [0, 55, 130, 210, 325], [285, 345, 325, 375, 270], [30, 30, 25, 35, 35], 4, 3,
    0, { 4: { fine: 'sudoku' } }),
  beginner: authoredStage('beginner', '联合店铺宣传日',
    ['maya-friendship', 'rin-thanks', 'chiya-garden', 'fuyu-visit', 'aoyama-keepsake', 'moka-tea'],
    [0, 45, 105, 175, 265, 355], [270, 310, 285, 330, 240, 265], [25, 30, 25, 30, 20, 25], 5, 4,
    0.4, { 3: { fine: 'sudoku' }, 5: { fine: 'math' } }),
  story: authoredStage('story', '给智乃的秘密纪念册',
    ['cocoa-welcome', 'aoyama-keepsake', 'rize-event', 'chiya-garden', 'yura-gift', 'syaro-shift', 'chino-keepsake'],
    [0, 40, 90, 150, 220, 295, 375], [255, 295, 235, 325, 265, 235, 225], [25, 30, 20, 35, 25, 20, 20], 6, 5,
    0.8, { 2: { fine: 'math' }, 4: { fine: 'sudoku' } }),
}

const CORE_CHARACTER_IDS: readonly OfficialCharacterId[] = ['chino', 'cocoa', 'rize', 'chiya', 'syaro']
const PATIENCE_RANGES: Readonly<Record<OfficialCharacterId, readonly [number, number]>> = {
  chino: [260, 420], cocoa: [260, 420], rize: [260, 420], chiya: [260, 420], syaro: [260, 420],
  maya: [280, 400], rin: [260, 340], fuyu: [300, 420],
  moka: [320, 420], aoyama: [300, 420], yura: [260, 320],
  megu: [300, 420], natsume: [280, 400], elulu: [300, 420],
}

/** Accepts the survival run's root seed; the returned seed is qualified by day. */
export function generateSurvivalStage(day: number, seed: string | number): SurvivalStageDefinition {
  if (!Number.isSafeInteger(day) || day < 1) throw new RangeError('Survival day must be a positive integer')
  const root = forkRng(createRng(seed), `survival:${day}`)
  const count = 7 + Math.floor((day - 1) / 2)
  const horizon = Math.max(270, 450 - 6 * (day - 1))
  const complexProbability = Math.min(0.8, 0.3 + 0.02 * (day - 1))
  const hardPuzzleWeight = Math.min(0.75, 0.2 + 0.025 * (day - 1))
  const reduction = Math.min(70, Math.floor(2.25 * (day - 1)))
  const indices = Array.from({ length: count }, (_, index) => index)
  const coreSlots = shuffleRandom(forkRng(root, 'official-slots'), indices).value.slice(0, 2)
  const coreCharacters = shuffleRandom(forkRng(root, 'official-characters'), CORE_CHARACTER_IDS).value.slice(0, 2)
  const coreOrders = coreCharacters.map(characterId => pickRandom(forkRng(root, `official-order:${characterId}`),
    ORDER_TEMPLATES.filter(template => template.customer.characterId === characterId)).value)
  const supportingOrders = ORDER_TEMPLATES.filter(template => !CORE_CHARACTER_IDS.includes(template.customer.characterId))
  // Complete shuffled rounds keep each supporting character's count within one of the others.
  const supportingSchedule = Array.from({ length: Math.ceil((count - coreSlots.length) / supportingOrders.length) }, (_, cycle) =>
    shuffleRandom(forkRng(root, `supporting-orders:${cycle}`), supportingOrders).value).flat()
  let supportingIndex = 0
  let previousArrival = 0

  const customers: ScheduledCustomer[] = indices.map((index) => {
    const rng = forkRng(root, `customer:${index}`)
    const coreIndex = coreSlots.indexOf(index)
    const template = coreIndex < 0 ? supportingSchedule[supportingIndex++] : coreOrders[coreIndex]
    const complex = nextRandom(forkRng(rng, 'complexity')).value < complexProbability
    const finish = complex
      ? pickRandom(forkRng(rng, 'finish'), ['foil', 'emboss', 'wax'] as const).value
      : pickRandom(forkRng(rng, 'finish'), ['matte', 'gloss'] as const).value
    const crafts: CraftRequirement[] = []
    if (complex) {
      crafts.push(craft(finish === 'foil' ? 'foil' : finish === 'wax' ? 'wax' : 'stamp'))
      if (randomInt(forkRng(rng, 'extra-craft'), 0, 1).value === 1) crafts.push(craft('ribbon'))
    } else if (randomInt(forkRng(rng, 'handwork'), 0, 1).value === 1) {
      crafts.push(craft(pickRandom(forkRng(rng, 'handwork-kind'), ['stamp', 'trim', 'ribbon'] as const).value))
    }
    const customerOrder: OrderTemplate = {
      ...template,
      id: `survival:${day}:order:${index + 1}`,
      requirements: { ...template.requirements, surfaceFinishId: finish, crafts },
    }
    const arrivalBaseSeconds = Math.round(index * horizon / (count - 1))
    const arrivalJitterSeconds = index === 0 ? 0 : randomInt(forkRng(rng, 'arrival'), -12, 12).value
    const arrivalSeconds = index === 0 ? 0 : Math.max(previousArrival, Math.min(horizon, Math.max(0, arrivalBaseSeconds + arrivalJitterSeconds)))
    previousArrival = arrivalSeconds
    const range = PATIENCE_RANGES[template.customer.characterId]
    const unadjustedPatienceSeconds = randomInt(forkRng(rng, 'patience'), range[0], range[1]).value
    return {
      id: `survival:${day}:customer:${index + 1}`, order: customerOrder,
      arrivalSeconds, arrivalBaseSeconds, arrivalJitterSeconds, unadjustedPatienceSeconds,
      basePatienceSeconds: unadjustedPatienceSeconds - reduction,
      lastWaitSeconds: randomInt(forkRng(rng, 'last-wait'), 15, 35).value,
    }
  })

  // Required stock scales with actual generated orders; optional upgrades share a small surplus.
  const inventory = { ...requiredMaterialDemand(customers.map((customer) => customer.order)) }
  for (const material of MATERIALS) inventory[material.id] += material.id === 'premium-decoration' ? 1 : Math.max(1, Math.floor(count / 7))
  return {
    kind: 'survival', id: `survival:${day}`, label: `生存营业第 ${day} 日`, seed: root.seed, day,
    durationSeconds: 720, inspections: 3, freeDemoInspections: 0, customers, inventory,
    arrivalHorizonSeconds: horizon, complexProbability, hardPuzzleWeight, patienceReductionSeconds: reduction,
    thresholds: { kind: 'survival', minDeliveredRatio: 0.7, satisfiedRatioExclusive: 0.5, maxLeft: 2 },
  }
}
