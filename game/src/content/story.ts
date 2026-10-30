import type { AuthoredStageId, ShiftResult } from '../domain/shift-types'
import type { BackgroundAssetId, CharacterPortrait } from './production-assets'

export type StorySpeaker = '心爱' | '智乃' | '理世' | '千夜' | '纱路'
export type StoryLine = Readonly<{ speaker: StorySpeaker; text: string; mood?: string }>
export type TriggeredStoryLine = StoryLine & Readonly<{ trigger: string }>
export type StoryEnding = 'great' | 'pass' | 'fail'
export type StoryCustomerCopy = Readonly<{
  /** The scheduled order template ID, not the run-specific customer ID. */
  id: string
  name: string
  role: string
  portrait: CharacterPortrait
  requestSummary: string
  greeting: string
  patienceWarning: string
  /** Only after a successful delivery whose evaluation is satisfied. */
  greatDelivery: string
  /** Receipt acknowledgement; does not assume satisfaction or required accuracy. */
  okayDelivery: string
  /** After delivery only. An unfulfilled departure uses leftWithoutCard or a generic notice. */
  departure: string
  /** Waiting/closing departure; must not imply that a card was received. */
  leftWithoutCard?: string
}>
export type StoryStage = Readonly<{
  id: AuthoredStageId
  title: string
  eyebrow: string
  backgroundAssetId: BackgroundAssetId
  sceneDescription: string
  opening: readonly StoryLine[]
  midShift: readonly TriggeredStoryLine[]
  endings: Readonly<Record<StoryEnding, readonly StoryLine[]>>
  /** Same template order and positions as the immutable authored schedule. */
  customers: readonly StoryCustomerCopy[]
}>

// Reviewed copy is authored here as static data. No runtime content loading.
const CUSTOMERS = {
  cocoa: {
    id: 'cocoa-welcome', name: '心爱', role: '指导兼一号客人',
    portrait: { assetId: 'cocoa-chino-tippy', cropId: 'cocoa' },
    requestSummary: '樱花粉横式欢迎卡，兔兔与欢迎字章，喜欢温暖热闹的构图',
    greeting: '客人一号心爱登场！想要一张像小兔子一样可爱的欢迎卡！',
    patienceWarning: '时间过去不少了呢，别着急，姐姐会陪着你一步步做！',
    greatDelivery: '哇！这份心意我完完全全感受到了，超开心！',
    okayDelivery: '做好了！姐姐收下啦，我们再接着练习！',
    departure: '第一单已经交到我手上啦！保持这个步调，接下来也加油！',
  },
  chino: {
    id: 'chino-coffee', name: '智乃', role: '冷静的品鉴者',
    portrait: { assetId: 'cocoa-chino-tippy', cropId: 'chino' },
    requestSummary: '奶油白横式感谢卡，咖啡杯与感谢字章，请保留舒适的留白',
    greeting: '打扰了。我想订一张放进咖啡袋的感谢卡，用奶油白卡纸和咖啡杯图案就好，请多关照。',
    patienceWarning: '台面停住了吗？请按顺序核对好凹槽与备料，一步一步来就可以。',
    greatDelivery: '咖啡杯让我想到刚冲好的那一壶。留白很舒服，我很喜欢。',
    okayDelivery: '卡片我收下了，谢谢您。',
    departure: '法压壶里的咖啡刚好可以倒出来了，我先回吧台，接下来也拜托了。',
  },
  rize: {
    id: 'rize-event', name: '理世', role: '活动组织委员',
    portrait: { assetId: 'rize', cropId: 'rize' },
    requestSummary: '天空蓝横式活动卡，星星、今日推荐字章与蓝缎带，构图要稳定有层次',
    greeting: '下午好！学校活动需要一张整齐的宣传卡，星星和蓝缎带的位置也拜托了！',
    patienceWarning: '活动布置时间快到了，请先确认这张卡还差哪一步。',
    greatDelivery: '做得很好，而且……星星和缎带搭在一起其实挺可爱的，很合我心意！',
    okayDelivery: '卡片收到了，辛苦你们了。接下来继续稳住步调吧。',
    departure: '我先去布置会场。台面记得整理好，改天见！',
  },
  chiya: {
    id: 'chiya-garden', name: '千夜', role: '甘兔庵看板娘',
    portrait: { assetId: 'chiya-syaro', cropId: 'chiya' },
    requestSummary: '薄荷绿方形花园茶会卡，茶杯、茶会字章与蕾丝边框，压纹并盖章',
    greeting: '午安呀。晚上店里要办茶会，想请你们做一张像小花园一样的和风卡片。',
    patienceWarning: '水壶里的水快要滚开了呢，茶汤放久了可就不香了喔？',
    greatDelivery: '真美呀……看着纸页就像推开清晨的竹篱小门，纹样雅致得可以配一首和歌呢。',
    okayDelivery: '这张卡片我先收下了，多谢两位费心呢。',
    departure: '那我先回甘兔庵备茶了，晚点给你们端自制的点心过来哦。',
  },
  syaro: {
    id: 'syaro-shift', name: '纱路', role: 'Fleur de Lapin 兼职店员',
    portrait: { assetId: 'chiya-syaro', cropId: 'syaro' },
    requestSummary: '奶油白直式赶班卡，茶壶与祝你愉快字章，细节精致但装饰克制',
    greeting: '打扰了！换班前想取一张清爽的卡片，茶壶图案和字章要看得清楚，装饰别太拥挤就好！',
    patienceWarning: '快到换班时间了……再拿不到卡片的话，我就得先回店里了呀！',
    greatDelivery: '太好了！精致又清爽，真的帮大忙了！',
    okayDelivery: '卡片收到了，谢谢大家。我现在得赶紧回店里了！',
    departure: '谢谢大家！等晚上下班换好衣服，我再过来好好坐坐！',
  },
  maya: {
    id: 'maya-friendship', name: '麻耶', role: '爽朗的智麻惠队伙伴',
    portrait: { assetId: 'maya', cropId: 'maya' },
    requestSummary: '樱花粉折叠友谊卡，双兔与友谊字章，保留温暖的配色，不放咖啡图案',
    greeting: '智乃、心爱，我来啦！想做张送给朋友的小卡，等会儿就把大家约出来！',
    patienceWarning: '嘿，约好的时间快到啦！还差哪一步？需要腾地方的话，我来帮忙！',
    greatDelivery: '哇，一看就想赶快拿给大家！这张小卡我可要好好留着！',
    okayDelivery: '做好啦，那我先收下！谢谢你们忙这一趟！',
    departure: '我去找惠和智乃一起看！下次缺帮手也叫上我啊！',
    leftWithoutCard: '集合的时间到啦，我得先走了！卡片下次再说，你们也别忙乱了啊！',
  },
  megu: {
    id: 'megu-ballet', name: '惠', role: '温和的舞蹈伙伴',
    portrait: { assetId: 'megu', cropId: 'megu' },
    requestSummary: '樱花粉直式舞蹈回忆卡，蝴蝶结、祝你愉快字章与奶油缎带饰片，哑光表面，配色温暖',
    greeting: '打扰了，心爱。我想把跳舞时的心情留在卡片上，能请你们帮忙吗？',
    patienceWarning: '我和麻耶约好的时间快到了……能告诉我还需要多久吗？',
    greatDelivery: '好漂亮，像记起了跟着音乐转圈的心情。妈妈看到了，也一定会很高兴。',
    okayDelivery: '谢谢你们，卡片我收好了。能为我花这些心思，我很开心。',
    departure: '那我去找麻耶了。下次让我也来帮忙吧，我会先认真听好步骤的。',
    leftWithoutCard: '对不起，约好的时间到了，我得先去找麻耶。卡片下次再来拜托你们。',
  },
  aoyama: {
    id: 'aoyama-keepsake', name: '青山', role: '寻找灵感的小说家',
    portrait: { assetId: 'aoyama', cropId: 'aoyama' },
    requestSummary: '丁香紫折叠纪念卡，书本、周年纪念字章与珍珠饰片，烫金表面并完成烫金工艺',
    greeting: '午安。看着你们裁纸，我好像又想到一个新故事了。也请替我留下一份小小的纪念吧。',
    patienceWarning: '哎呀，凛小姐大概已经在找我了。请问，我还能在这里躲多久呢？',
    greatDelivery: '像给故事添上了一句温柔的结尾呢。这份细致，我会好好收藏的。',
    okayDelivery: '卡片我收下了，谢谢。今天在这里看见的忙碌，也能写进笔记里呢。',
    departure: '那我带着卡片去找个地方写作吧……这次真的会动笔哦。',
    leftWithoutCard: '再留在这里，凛小姐就要来请我回去写稿了。卡片的事，我们下次再慢慢聊吧。',
  },
  rin: {
    id: 'rin-thanks', name: '凛', role: '认真核对安排的责任编辑',
    portrait: { assetId: 'rin', cropId: 'rin' },
    requestSummary: '牛皮纸横式感谢卡，信封与感谢字章，希望一眼就能读清',
    greeting: '打扰了。想请你们做一张感谢卡，我还得去找青山老师，先把要求写清楚了。',
    patienceWarning: '约定的时间快到了，请告诉我现在做到哪一步，我好重新安排。',
    greatDelivery: '字面清楚，心意也表达得很妥当。这回可以放心交给对方了，谢谢你们。',
    okayDelivery: '卡片收到了，谢谢。我先收好，接下来还有几件事要处理。',
    departure: '那我去找青山老师了。要是老师又回到店里，请替我留意一下。',
    leftWithoutCard: '抱歉，我得先去确认青山老师的进度。今天来不及取卡了，下次再联系。',
  },
  moka: {
    id: 'moka-tea', name: '摩卡', role: '带着面包香的可靠姐姐',
    portrait: { assetId: 'moka', cropId: 'moka' },
    requestSummary: '薄荷绿方形茶会邀请卡，茶壶与邀请字章，带一点植物与花园气氛',
    greeting: '心爱，姐姐来看你们啦！想做张邀请大家喝茶的卡，和面包一起送过去。',
    patienceWarning: '和大家约好分面包的时间快到了。先看看还差哪一步，姐姐也会等你们安排好。',
    greatDelivery: '做得真用心！心爱和大家都能独当一面了，姐姐看着也很高兴呢。',
    okayDelivery: '谢谢，姐姐收好啦。你们忙了这么久，手边的事做完也要歇一歇。',
    departure: '我去把面包分给大家。心爱，照顾客人的时候也要记得照顾自己哦。',
    leftWithoutCard: '姐姐得先把面包送过去了，今天就先不取卡啦。把台面整理好，下一次慢慢来。',
  },
  yura: {
    id: 'yura-gift', name: '结良', role: '想给理世惊喜的好友',
    portrait: { assetId: 'yura', cropId: 'yura' },
    requestSummary: '奶油白礼物吊牌，信封与祝福字章，装饰克制，字迹清晰',
    greeting: '午安，理世在这里吗？想在见她之前备好一张心意小卡，先别替我说出去哦。',
    patienceWarning: '等会儿和理世还有约呢，可不能让护卫反而迟到了。我的这张还差多少？',
    greatDelivery: '嗯，这份心意放上去正合适。理世看到时的表情，真让人期待呢。',
    okayDelivery: '卡片收到了，谢谢。接下来该由我去把礼物准备好了。',
    departure: '我去找理世了。要是她问起，就当刚才没见过我吧，呵呵。',
    leftWithoutCard: '看来要先去赴约了呢。今天就不等这张卡了，别让理世担心她的护卫呀。',
  },
  fuyu: {
    id: 'fuyu-visit', name: '冬优', role: '慢慢熟悉小镇的新朋友',
    portrait: { assetId: 'fuyu', cropId: 'fuyu' },
    requestSummary: '咖啡棕票券卡，相机与 Rabbit House 字章，票面规整',
    greeting: '那个……想做一张记下小镇风景的卡。先让我看看订单上的样式，可以吗？',
    patienceWarning: '人好像越来越多了……我等会儿还有事，可以问一下还要多久吗？',
    greatDelivery: '这张……我很喜欢。带在身边的话，好像也能记得今天和大家说的话。',
    okayDelivery: '卡片我收下了。谢谢你们……我会放好的。',
    departure: '那我先走了。下次……想和智乃一起再来。',
    leftWithoutCard: '对不起，我得先走了。卡片今天先不等了……下次人少一点的时候，我再来。',
  },
  natsume: {
    id: 'natsume-friendship', name: '夏明', role: '珍惜友情却不太坦率的同学',
    portrait: { assetId: 'natsume', cropId: 'natsume' },
    requestSummary: '天空蓝折叠友谊卡，信封、友谊字章与双花饰片，哑光表面，构图稳定且装饰呼应',
    greeting: '午安，想请你们帮忙做一张给朋友的小卡。只是普通的问候……也不用太郑重。',
    patienceWarning: '不好意思，映月还在等我。我想确认一下，现在还需要多少时间？',
    greatDelivery: '做得很好……谢谢。这种收到后会想留在身边的东西，我会认真收好的。',
    okayDelivery: '谢谢，卡片我收到了。麻烦你们了，我会亲手交给朋友的。',
    departure: '我去找映月了。下次和大家见面时……也请多关照。',
    leftWithoutCard: '抱歉，不能再让映月等下去了。我先告辞，卡片的事改天再来拜托。',
  },
  elulu: {
    id: 'elulu-tea', name: '映月', role: '期待和朋友一起喝茶的同学',
    portrait: { assetId: 'elulu', cropId: 'elulu' },
    requestSummary: '薄荷绿方形茶会邀请卡，茶杯、邀请字章与双花饰片，哑光表面，带一点花园气氛',
    greeting: '下午好。我想请朋友们一起喝茶，邀请卡也可以请你们做吗？这次我记得来店里的路哦。',
    patienceWarning: '诶，已经过了这么久吗？和夏明约好的时间快到了，卡片还来得及吗？',
    greatDelivery: '真好呀。想到朋友们会拿着这张卡来见面，就已经有点期待了。谢谢你们。',
    okayDelivery: '谢谢，卡片已经收好了。接下来我得先想好，要怎么亲手递给大家呢。',
    departure: '我去找夏明，一起把卡片送出去。下次也想和朋友们来这里坐坐呢。',
    leftWithoutCard: '夏明在等我了，我得先过去。卡片下次再做吧，下次也想自己找到这里。',
  },
  keepsake: {
    id: 'chino-keepsake', name: '智乃', role: '纪念卡的收件人',
    portrait: { assetId: 'cocoa-chino-tippy', cropId: 'chino' },
    requestSummary: '奶油白折叠纪念卡，咖啡杯、纪念字章、兔爪、小星星与叶藤边框，请留一点空白',
    greeting: '最后一张也请正式记在订单上吧。咖啡杯、兔爪、星星和叶藤……大家的心意，我想收进纪念册。',
    patienceWarning: '计时器快要响了，请先看清订单。手稳下来，一步一步做就好。',
    greatDelivery: '咖啡杯和小星星放在一起很可爱。谢谢大家，有了这张纪念卡，我也想调配出更美味的咖啡。',
    okayDelivery: '卡片我收下了。大家的努力，我都看在眼里。',
    departure: '我先把卡片收好。忙完后，请大家一起尝尝刚冲好的咖啡。',
  },
} as const satisfies Readonly<Record<string, StoryCustomerCopy>>

/** Shared by authored schedules and generated orders; keys are immutable template IDs. */
export const CUSTOMER_COPY: Readonly<Record<string, StoryCustomerCopy>> = Object.fromEntries(
  Object.values(CUSTOMERS).map(customer => [customer.id, customer]),
)

/** These greetings describe the person, without prescribing a generated card's materials or crafts. */
export const SUPPORTING_CUSTOMER_COPY: Readonly<Record<string, StoryCustomerCopy>> = {
  maya: CUSTOMERS.maya, megu: CUSTOMERS.megu, aoyama: CUSTOMERS.aoyama,
  rin: CUSTOMERS.rin, moka: CUSTOMERS.moka, yura: CUSTOMERS.yura,
  fuyu: CUSTOMERS.fuyu, natsume: CUSTOMERS.natsume, elulu: CUSTOMERS.elulu,
}

export const TUTORIAL_INTERVENTIONS: readonly TriggeredStoryLine[] = [
  { trigger: 'read_order', speaker: '心爱', text: '先在桌角读单确认要求，也看一眼客人不喜欢的图案和配色吧！' },
  { trigger: 'choose_materials', speaker: '智乃', text: '按单选好卡纸、形状和版式，再裁好卡坯。需要的材料请先留足。' },
  { trigger: 'place_elements', speaker: '心爱', text: '到组装台放好订单要求的配件，大小、朝向和前后顺序也要看清喔！' },
  { trigger: 'complete_craft', speaker: '智乃', text: '按订单要求完成手工作业；没有要求的工艺，可以先不做。' },
  { trigger: 'inspect_card', speaker: '心爱', text: '教学先免费示范一次，这班另有三次检查；问题要由你亲手修改。' },
  { trigger: 'archive_card', speaker: '智乃', text: '做完先收入卡册，再前往冲印台。' },
  { trigger: 'choose_printer', speaker: '心爱', text: '挑好机器确认，解开校准小谜题。这次先练快印找数和精印迷你数独！' },
  { trigger: 'handover', speaker: '智乃', text: '等冲印结束，再亲手交给仍在等候的客人。放在卡册里还不算交付。' },
]

export const STORY_STAGES: Readonly<Record<AuthoredStageId, StoryStage>> = {
  tutorial: {
    id: 'tutorial', title: '心爱的“制卡姐姐”初值班', eyebrow: '木香与卡纸的午后工坊',
    backgroundAssetId: 'card-workbench',
    sceneDescription: '暖金色的午后阳光斜照在Rabbit House擦得锃亮的木长桌上。研磨咖啡豆的醇苦、刚出炉面包的麦香与清整的卡纸气味融在一起。长台前整齐摆好六处操作用具，等待着今天第一道推门铃声响起。',
    opening: [
      { speaker: '心爱', mood: '元气挺胸', text: '当当！今天由可靠的制卡姐姐带队，带你一起做心意满满的卡片！' },
      { speaker: '智乃', mood: '冷静平淡', text: '心爱小姐，马上就要开门了，请先说明步骤。' },
      { speaker: '心爱', mood: '自信挥手', text: '好！先在桌角读单确认要求，接着按单去备料选纸，避开客人不喜欢的图案和配色。' },
      { speaker: '智乃', mood: '认真指点', text: '选好后去组装台放好配件，再按订单要求去工艺台完成手工作业。' },
      { speaker: '心爱', mood: '闪闪发光', text: '教学先免费示范一次，这班另有三次检查；问题要由你亲手修改。' },
      { speaker: '智乃', mood: '冷静平淡', text: '做完收入卡册，挑好机器确认并解开小谜题，等冲印结束再亲手交给客人。' },
      { speaker: '心爱', mood: '得意叉腰', text: '这次会示范快印找数和精印迷你数独，之后还会遇到别的题目！' },
      { speaker: '智乃', mood: '轻声叹息', text: '最后，客人的耐心在一点点减少，请看着沙漏，别让大家等太久。' },
      { speaker: '心爱', mood: '认真挺身', text: '嗯！姐姐会认真照顾每一位客人，全都交给姐姐吧！深呼吸，我们要开门啰！' },
    ],
    midShift: [
      { trigger: 'slot_empty', speaker: '心爱', text: '订单要求的配件还没放齐呢，再对照单子看一眼吧！' },
      { trigger: 'slot_mismatch', speaker: '智乃', text: '这个配件与订单要求还不一致，请核对位置、大小、朝向和前后顺序。' },
      { trigger: 'taboo_placed', speaker: '智乃', text: '心爱小姐，那个图案或配色客人好像不希望用到，趁现在换下来吧。' },
      { trigger: 'rush_trigger', speaker: '心爱', text: '有特别紧急的订单进来了！别慌，按着平时的节奏一张张做！' },
      { trigger: 'print_fast_math', speaker: '心爱', text: '快印要看清上面标出的目标数字，仔细在方框里找出来喔！' },
      { trigger: 'print_grid_stuck', speaker: '智乃', text: '精印的迷你数独，先看看哪一行或哪一列剩下的空格最少吧。' },
      { trigger: 'inspect_border_miss', speaker: '智乃', text: '订单要求的边框还没放好，请对照纸签补上，再检查前后顺序。' },
      { trigger: 'patience_half', speaker: '心爱', text: '沙漏漏掉一半了，手头的动作稍微加快一点点，我们能赶上的！' },
      { trigger: 'station_clogged', speaker: '心爱', text: '台面堆得有点满了，做好的卡片先收进卡册，台面就清爽啦！' },
    ],
    endings: {
      great: [
        { speaker: '心爱', text: '太棒了！所有卡片都顺利送出去了，大家拿到的表情都好开心！' },
        { speaker: '智乃', text: '每位客人都满意了。心爱小姐和搭档今天确实做得很好。' },
        { speaker: '心爱', text: '嘿嘿，被智乃酱夸奖了！今晚的面包我来多烤一盘当庆祝夜宵！' },
        { speaker: '理世', text: '一张张认真做到了最后，这场并肩作战相当漂亮！' },
        { speaker: '千夜', text: '屋子里都是刚印好的纸香与木头香气呢，真是令人安心的午后。来吃点饼干吧，里面有一个加了芥末呢。' },
      ],
      pass: [
        { speaker: '智乃', text: '这次已经达到值班要求。步骤记住了，下一班肯定可以更好。' },
        { speaker: '心爱', text: '呼……刚才心跳得好快！不过总算是合格了，小智乃和大家都很努力呢！' },
        { speaker: '纱路', text: '下次我会更加努力。' },
        { speaker: '理世', text: '接下来只要放平心态，手上的动作就会越来越熟练。' },
      ],
      fail: [
        { speaker: '心爱', text: '呜……今天还没达到约定的目标，作为姐姐我也有责任！' },
        { speaker: '智乃', text: '不要这么骄傲地说出没有达到目标啊。' },
        { speaker: '智乃', text: '吧台里有刚温好的咖啡，先喝一口休息一下吧。' },
        { speaker: '心爱', text: '嗯！智乃酱地咖啡可是非常美味，姐姐最喜欢了。' },
      ],
    },
    customers: [CUSTOMERS.cocoa, CUSTOMERS.megu, CUSTOMERS.natsume, CUSTOMERS.chiya, CUSTOMERS.elulu],
  },
  beginner: {
    id: 'beginner', title: '联合店铺宣传日', eyebrow: '三街联动工坊初启',
    backgroundAssetId: 'production-floor',
    sceneDescription: '午后的木质长台上整齐码放着各色纹理纸与雕花印章。冲印机的黄铜把手擦得锃亮，门外风铃轻响，吧台另一侧正腾起烘焙咖啡与温热纸浆交融的醇厚香气。',
    opening: [
      { speaker: '心爱', mood: '元气满满', text: '放心交给姐姐吧！今天三家店的联合特制卡，一定会像刚出炉的面包一样漂漂亮亮地送到大家手上！' },
      { speaker: '智乃', mood: '冷静提示', text: '心爱小姐，请不要把卡纸像法棍一样抱在胸口，门外第一位客人已经在挑印样了。' },
      { speaker: '理世', mood: '抱臂交代', text: '先看清订单再安排工序。冬优的票卡要规整，青山小姐的折叠卡也要留心前后层次。' },
      { speaker: '纱路', mood: '焦急看表', text: '今天有麻耶和摩卡小姐来订卡，别只顾着聊起来，等会我还要去打工！' },
      { speaker: '千夜', mood: '温和微笑', text: '甘兔庵的茶会卡，我想起名叫“细雪初融月下苔庭落樱小憩”，放在手里一定很雅致呢。' },
      { speaker: '纱路', mood: '现实吐槽', text: '千夜，那串名字一口气根本念不完，小小的卡片也会挤不下的！' },
      { speaker: '心爱', mood: '挺起胸膛', text: '包在姐姐身上！无论是长长的诗名还是小星星，我都会一张张灌注最饱满的元气！' },
      { speaker: '智乃', mood: '眼睛微亮', text: '这支中烘豆比预想的更甜，有蜜桃和坚果香。忙完后，请大家也来尝尝。' },
      { speaker: '理世', mood: '认真提醒', text: '让我们一起击溃汹涌而来的顾客吧。' },
      { speaker: '智乃', mood: '轻声叹息', text: '理世小姐，顾客不是敌人。' },
      { speaker: '纱路', mood: '双手合十', text: '卡上的字章如果能一眼看清，客人就能少些犹疑，拜托大家啦。' },
      { speaker: '千夜', mood: '掩口轻笑', text: '若是在纸角留下一枚小巧的花影，捧在手里也会泛起阵阵暖意呢。' },
      { speaker: '心爱', mood: '高举滚筒', text: '好！三店联合制卡姐姐工坊，现在正式运转啰！' },
    ],
    midShift: [
      { trigger: 'queue-grow', speaker: '智乃', text: '排队的客人明显变多了，心爱小姐，请不要在上班时间对我拍照。' },
      { trigger: 'switch-press', speaker: '理世', text: '快印更省时间，精印能保留复杂工艺。先看订单，再决定用哪台。' },
      { trigger: 'foil-low', speaker: '纱路', text: '烫金箔只剩薄薄几张了，心爱，你又忘记买材料了！' },
      { trigger: 'rush-order', speaker: '心爱', text: '这些小小的意外可阻止不了姐姐！' },
      { trigger: 'client-wait', speaker: '千夜', text: '有人等得有些急了，可以用一次说明进度，多争取一点时间。' },
      { trigger: 'machine-hot', speaker: '理世', text: '压合的声音很清脆，就像射击一样，看准就能完成。' },
      { trigger: 'flavor-boost', speaker: '智乃', text: '这支豆子的甜味真的很有意思……心爱小姐，请松开我。' },
    ],
    endings: {
      great: [
        { speaker: '心爱', text: '成功啦！每位客人都捧着漂亮的卡片满意离开，姐姐作战大圆满！' },
        { speaker: '智乃', text: '这到底跟姐姐大作战有什么关系！' },
        { speaker: '心爱', text: '嘿嘿！全靠可靠的前辈心爱手把手带着，姐姐的新手教学可是满分呢！对吧，智乃酱！' },
        { speaker: '智乃', text: '心爱小姐，这份功劳明显是搭档自己用心领悟出来的。' },
        { speaker: '理世', text: '大家都收到了满意的卡片，这次的联名准备得非常出色！' },
        { speaker: '千夜', text: '诗意与花纹悄悄连成了一片，整条小街的温情都收拢在纸页里了呢。' },
      ],
      pass: [
        { speaker: '理世', text: '这一班达标了。接下来再核对一遍工序，下次会更从容。' },
        { speaker: '智乃', text: '今天已经很努力了呢。' },
        { speaker: '心爱', text: '那当然！都是我把当姐姐的心得传授到位了嘛！' },
        { speaker: '智乃', text: '……心爱小姐，也请把搭档的努力算进去。' },
        { speaker: '纱路', text: '呼……今天的目标总算守住了。我也得赶回店里换围裙啦！' },
      ],
      fail: [
        { speaker: '理世', text: '这次还没达到值班要求，先把订单和工序重新核对一遍吧。' },
        { speaker: '纱路', text: '时间已经到了……我得先快步赶回店里向店长说明情况了。' },
        { speaker: '智乃', text: '今天先到这里吧。' },
        { speaker: '心爱', text: '呜呜……姐姐保证下一次一定会完美完成的！' },
      ],
    },
    customers: [
      CUSTOMERS.maya,
      CUSTOMERS.rin,
      { ...CUSTOMERS.chiya, greeting: '两位好呀。甘兔庵的联名茶会卡，想做出带着水汽与苔香的小花园呢。' },
      CUSTOMERS.fuyu,
      CUSTOMERS.aoyama,
      CUSTOMERS.moka,
    ],
  },
  story: {
    id: 'story', title: '给智乃的秘密纪念册', eyebrow: '木制工作台的暗号',
    backgroundAssetId: 'rabbit-house-interior',
    sceneDescription: '晨光斜斜照进偏厅，烘焙香气混着纸浆与油墨的味道。工作台上摆好裁切板与压痕机，提比趴在纸筐里，眯着眼睛打盹。',
    opening: [
      { speaker: '心爱', mood: '干劲满满', text: '包在可靠的姐姐身上吧！今天一定要把送给智乃的纪念卡漂漂亮亮地做出来！' },
      { speaker: '理世', mood: '确认工序', text: '青山小姐和大家今天也会来呢。让我们准备好武器。' },
      { speaker: '千夜', mood: '优雅微笑', text: '今天我想试着做一款“晨光与落樱相拥的石板路”，感觉很适合放进纪念册呢。' },
      { speaker: '纱路', mood: '扶额轻叹', text: '千夜，先把名字收短一点啦。咖啡杯、兔爪、星星和叶藤，卡上已经要放不少心意了。' },
      { speaker: '心爱', mood: '慌张捂嘴', text: '小声一点！智乃就在吧台后边挑豆子，可不能被她听见！' },
      { speaker: '智乃', mood: '端茶走近', text: '心爱小姐，隔着走廊都能听到“纪念卡”三个字，想装作没听见都很困难。' },
      { speaker: '心爱', mood: '慌忙摆手', text: '呜哇！那个……还没准备好！智乃酱先回去好不好？' },
      { speaker: '理世', mood: '轻咳提醒', text: '咳……先把工序排好吧，折叠卡的边角也要认真核对。' },
      { speaker: '智乃', mood: '平静审视', text: '奶油白的折叠卡，旁边还摆着兔爪和小星星。大家的心意，我已经看到了。' },
      { speaker: '纱路', mood: '实际提醒', text: '心爱，先把订单排好，别让大家白忙一场吧。' },
      { speaker: '智乃', mood: '眼睛微亮', text: '今天的豆子有很柔和的果酸，我想让大家都尝尝。忙完一起喝杯咖啡吧。' },
      { speaker: '心爱', mood: '拍胸振作', text: '智乃酱专注泡咖啡的样子真可爱！我们赶快开工，还是要把这份惊喜认真完成！' },
    ],
    midShift: [
      { trigger: 'rush_start', speaker: '理世', text: '外头钟声响了，按照订购顺序一张一张来吧。' },
      { trigger: 'order_split', speaker: '千夜', text: '这几份是大家的日常寄托呢，按各自的订单，把心意一张张安放好吧。' },
      { trigger: 'tight_budget', speaker: '纱路', text: '心爱又忘记买材料了！没办法，部分材料不多，要好好考虑怎么分配！' },
      { trigger: 'chino_glance', speaker: '智乃', text: '这支危地马拉的果酸很柔和，我想让大家都尝尝。' },
      { trigger: 'cocoa_recover', speaker: '心爱', text: '智乃酱！我来尝尝！' },
      { trigger: 'precision_pass', speaker: '理世', text: '这一步完成了，再对照一次订单，保持这个认真的劲头吧。' },
      { trigger: 'final_card_prep', speaker: '心爱', text: '最后一张也要正式排进来了！这是送给智乃酱的纪念卡，拜托你来完成它！' },
    ],
    endings: {
      great: [
        { speaker: '心爱', text: '做好了！智乃酱你看，这是大家和姐姐一起为你做的纪念卡，上面的咖啡杯和小星星超可爱！' },
        { speaker: '智乃', text: '其实我早就隐约猜到了……不过，还是谢谢大家，真的很让人开心。' },
        { speaker: '千夜', text: '底色像洒满朝阳的石板路，正好能衬托智乃一路以来的温柔与努力呢。' },
        { speaker: '纱路', text: '青山小姐、结良和大家的订单，连同最后这份心意，都送到手里了，努力没有白费呢。' },
        { speaker: '理世', text: '看到智乃露出这样的笑容，刚才大家那么努力赶工就完全值得了。' },
        { speaker: '智乃', text: '谢谢姐姐们。有了这张纪念卡，今后我也想调配出更美味的咖啡。' },
      ],
      pass: [
        { speaker: '心爱', text: '呼……这班总算守住了！姐姐很努力了，下次一定做得更好！' },
        { speaker: '纱路', text: '虽然过程有些惊险，但至少我们守住了这一班的目标。' },
        { speaker: '智乃', text: '来喝杯咖啡吧。' },
        { speaker: '理世', text: '还有可以做得更好的地方，今晚一起把流程重新理顺吧。' },
        { speaker: '千夜', text: '今天留下的忙乱和笑声，也会变成一段难忘的回忆呢。' },
      ],
      fail: [
        { speaker: '心爱', text: '营业结束了，今天没达到约定的目标……呜呜呜，姐姐失败了。' },
        { speaker: '理世', text: '先停下来休息。今晚把流程重新排好，下次我们会更从容。' },
        { speaker: '纱路', text: '我先去打工了。' },
        { speaker: '智乃', text: '心爱小姐，先来尝尝刚冲好的咖啡吧。' },
        { speaker: '心爱', text: '智乃酱泡的咖啡好温暖！' },
      ],
    },
    customers: [
      { ...CUSTOMERS.cocoa, greeting: '客人一号心爱登场！先把今天的兔兔欢迎卡做好，再一起准备那份特别的心意！' },
      CUSTOMERS.aoyama,
      CUSTOMERS.rize,
      CUSTOMERS.chiya,
      CUSTOMERS.yura,
      CUSTOMERS.syaro,
      CUSTOMERS.keepsake,
    ],
  },
}

export type StoryEndingFacts = Pick<ShiftResult, 'stageId' | 'passed' | 'delivered' | 'satisfied' | 'averageScore'>

/**
 * Use the settled result's authored stage and count all scheduled customers,
 * including those who left; the great branch promises universal satisfaction.
 * The keepsake story also needs an S-level average (90), without rounding.
 * This only selects dialogue; it does not calculate pass/fail or unlocks.
 */
export function selectStoryEnding(result: StoryEndingFacts): StoryEnding {
  const { stageId } = result
  if (stageId !== 'tutorial' && stageId !== 'beginner' && stageId !== 'story') {
    throw new Error('Story endings require an authored stage')
  }
  if (!result.passed) return 'fail'
  const scheduled = STORY_STAGES[stageId].customers.length
  const qualityMet = stageId !== 'story' || result.averageScore >= 90
  return result.delivered === scheduled && result.satisfied === scheduled && qualityMet ? 'great' : 'pass'
}

export type OperationalCopy = Readonly<{
  patienceWarnings: readonly string[]
  machineReady: readonly string[]
  puzzleSuccess: readonly string[]
  puzzleFailure: Readonly<Record<'incorrect' | 'timeout' | 'interrupted' | 'stationChanged' | 'locked', readonly string[]>>
  inspection: readonly string[]
  delivery: readonly string[]
  worldErrors: Readonly<Record<'queueFull' | 'machineLocked' | 'materialsShort' | 'notArchived' | 'notReady' | 'customerLeft', string>>
  survival: Readonly<Record<'openings' | 'dayCleared' | 'runEnded', readonly string[]>>
}>

/** Pools may vary wording only within the matching event/cause. */
export const OPERATIONAL_COPY: OperationalCopy = {
  patienceWarnings: [
    '那位客人不时低头看表，神情显得越来越焦急了。',
    '等待的客人已经看了好几次时间，频频望向柜台。',
    '排队的客人脚步有些焦躁，一直在看制作台的方向。',
    '那位客人等了太久，看起来随时可能会转身离开。',
    '客人开始在原地来回踱步，眼神里满是不耐烦。',
    '等候的客人眉头微皱，已经朝柜台这边张望好几次。',
    '那位客人收起手机叹了口气，似乎已经快没耐心了。',
    '客人看了眼墙上的挂钟，转身准备往门外走去。',
  ],
  machineReady: [
    '这台冲印机有空位，可以为下一张卡开始校准。',
    '当前机器还有空位，可以安排下一张订单做准备。',
    '这台机器现在有空位，可以开始下一张卡的校准。',
    '冲印机还有空位，下一张订单可以开始准备。',
    '这台机器当前有空位，可以接下一张订单的校准。',
  ],
  puzzleSuccess: [
    '校准通过，机位已为这张卡保留，正在确认冲印。',
    '校准通过，这张卡已选好机器，正在确认冲印。',
    '调整完成，机器位置已保留，请稍候确认。',
    '校准成功，原来的机位会为这张卡保留。',
    '校准完成，正在为这张卡确认冲印。',
  ],
  puzzleFailure: {
    incorrect: ['校准没有通过，该订单在本机需等30秒后再试。'],
    timeout: ['倒计时结束超时，该订单在这台机器需等待30秒。'],
    interrupted: ['主动中断了调整，当前订单在这台机器需等30秒。'],
    stationChanged: ['离开并切换了台面，这张订单在这台机器暂锁30秒。'],
    locked: ['此单在本机暂时不能再试，其他订单不受影响；也可以查看另一台机器。'],
  },
  inspection: [
    '迎光翻动卡片，检查结果已经逐项写在纸签上。',
    '仔细核对卡面，发现的问题已经全部列出来了。',
    '检查完成，请按纸签上的问题决定是否修改。',
    '这次检查发现的情况，已经一并写在清单上。',
    '卡片检查完毕，当前版本的问题都列在纸签上。',
  ],
  delivery: [
    '制作好的卡片已经亲手递上，顺利交到了客人手里。',
    '把完成的定制卡片交到客人手中，顺利结清此单。',
    '完成的卡片已当面交付给客人，完成了这张订单。',
  ],
  worldErrors: {
    queueFull: '这台机器的机位已经排满，请稍等或试试另一台。',
    machineLocked: '此单在这台机器暂时不能再试，可查看另一台，其他订单正常。',
    materialsShort: '吧台备用的卡纸或装饰物料不够用了，暂时无法完成这一步。',
    notArchived: '这张卡片需要先收进卡册，之后才能进行下一步。',
    notReady: '卡片尚未完成冲印，请查看机器的等候与制作进度。',
    customerLeft: '客人已经离店，不能再交付；已收入卡册的卡片会继续保留。',
  },
  survival: {
    openings: [
      '门铃轻响，研磨机开始转动，今天的第一批客人进店了。',
      '窗外晨雾还未散去，咖啡香气中迎来了新一天的营业。',
      '翻过门牌挂上营业中，系好围裙准备迎接新一天的挑战。',
      '暖黄的吧台灯亮起，第一波客人的订单陆续送达柜台。',
      '托盘与台面擦拭干净，深烘豆的香气正吸引着过路客人。',
      '蒸汽机喷出第一缕白雾，今天的繁忙营业正式开始了。',
    ],
    dayCleared: [
      '夕阳染红了吧台，今日营业达标，可以准备打烊了。',
      '擦干净吧台台面，今天的经营顺利结束，看看今日的成绩吧。',
      '暖光渐暗，今日营业目标已顺利达成，可以安心收工了。',
      '门牌翻回休息中，店里只剩咖啡余香，今晚平安过关。',
      '账本记下今日最后一笔单，当天的营业目标顺利达成。',
      '整理好工位上的工具，今天的营业时间结束，平稳收尾。',
    ],
    runEnded: [
      '今天的营业成果还不够，本轮就先在这里打烊吧。',
      '这次没能达到继续营业的条件，本轮到这里结束。',
      '今天留下了一些遗憾，这一轮营业就先结束了。',
      '门牌翻回休息中，本轮营业在这里告一段落。',
      '今天没能守住营业目标，本轮就先收拾工位吧。',
      '店里的灯慢慢暗下，本轮经营在这里结束了。',
    ],
  },
}
