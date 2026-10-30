# Rabbit House 手作值班：BGM 与音效准备清单

方案整理日期：2026-10-15；素材接入更新：2026-10-16。依据当前实际页面、剧情和交互整理，面向本项目的非公开、非盈利同人制作。

**推荐主方案：直接以《请问您今天要来点兔子吗？》一、二期 OST 为音乐主体；按钮使用柔和短音，制卡使用纸张、印章、裁刀等实物声；人物说话可加入少量原作短语气片段。** 第一批先准备 8 首 BGM 与核心 SE，再补角色声音和环境层。

下文已核实原声专辑、日文曲名与版本；场景适配属于选曲建议，尚未逐首听审。BGM 的精确循环点与最终混音需接入时确定；音效已有导出版本与处理记录，状态如下。

## 0. 素材落地状态（2026-10-16）

- **BGM 已整理部署：** [materials/audio/bgm/](../materials/audio/bgm/) 保存 14 首音乐原件；游戏保留实际使用的 9 首 BGM，另 1 首长曲与 4 首短转场曲移至 [候选素材](../materials/audio/candidates/README.md)，均保留 OGG / MP3 双格式。
- **音效已下载：** [materials/audio/sfx/](../materials/audio/sfx/README.md) 内保存 35 个原始 MP3，来自効果音ラボ与 On-Jin。
- **游戏用版本已导出：** [game/public/assets/audio/](../game/public/assets/audio/SOURCES.md) 内保留 31 个实际接入的 OGG；另 7 个备选音效与环境声保存在候选目录。全部 38 个导出版本均保留处理记录。
- **来源与参数：** [SOURCES.md](../game/public/assets/audio/SOURCES.md) 提供用途、时长、来源与署名；[manifest.json](../game/public/assets/audio/manifest.json) 记录资源 ID、本地 URL、原始文件、裁切范围、增益及循环标记。
- **已接入游戏播放：** 标题、对白、营业、自由工坊、卡册和结算分别选曲；主要按钮、手作、保存、校准、出片与交付接入对应音效。右下角“声音”提供音乐 / 音效音量和全部静音；首次交互后启用，偏好保存本地。短转场曲与环境点缀保存在游戏目录外，不随构建发布。
- **人物声音状态：** 本批 SE 是原作者素材站的风格替代，未取得原作角色短语音；通用对话提示不标作人物配音。缎带、倒蜡等替代关系也已逐项注明。

## 1. 项目里实际需要声音的地方

当前作品是“Rabbit House 手作值班”，主要做卡片，不是冲泡饮品的操作模拟。咖啡声适合放在环境层，制作反馈应围绕手作。

| 实际场景 | 当前内容 | 声音安排 |
| --- | --- | --- |
| 标题 / 店门 | 剧情经营、继续值班、生存天梯、自由工坊 | 一首有原作辨识度的标题循环，轻菜单音 |
| 开店前对白 | 三班开场，心爱、智乃等交谈 | 日常对白 BGM，翻句音，可选句首短语音 |
| 教学、联合宣传、秘密纪念册 | 每班 12 分钟，分别 5 / 6 / 7 位客人 | 持续营业曲；剧情重点再换温柔曲 |
| 六工位制作 | 接单 → 备料 → 组装 → 工艺 → 检查 → 冲印 | 同一首营业曲贯穿，具体动作配 SE |
| 冲印校准 | 找数、连线、辨认、扫雷、数独、数学题 | 简短操作音、校准成功 / 失败音、出片提醒 |
| 营业闲话、教学弹层 | 角色提醒、吐槽、教程 | 降低 BGM，轻提示或角色语气片段 |
| 打烊结算 | `great` / `pass` / `fail`，有结算对白 | 收工短提示，再接温暖或安慰曲 |
| 生存天梯 | 直接进入营业，日复一日提高难度 | 稳定的营业循环，可选忙碌曲 |
| 自由工坊 / 卡册 / 独立冲印 | 不限时编辑、保存、收藏、打印 | 舒缓音乐，纸张、落位、翻页与机器声 |

**六个工位不要各自从头播放一首歌。** 玩家会频繁切台，BGM 应保持连贯，换工位用一次轻音反馈即可。教学暂停也不需要换曲。

依据：[当前路由](../game/src/app/App.tsx)、[剧情与人物语气](../game/src/content/story.ts)、[工艺台](../game/src/components/stations/CraftStation.tsx)、[打烊结算](../game/src/screens/ShiftResult.tsx)。当前路由没有制作人员名单页；后文对此仅给未来备选。

## 2. 优先准备哪些原作音乐

### 2.1 专辑索引与获取入口

| 编号 | 专辑 / 单曲 | 用于定位的唱片编号 | 核实来源 |
| --- | --- | --- | --- |
| A | 一期《ご注文はうさぎですか？ ORIGINAL SOUNDTRACK》 | GNCA-1389，2014-12-25，2 CD | [原作官方完整曲目](https://gochiusa.com/series_cd/1_ost.html) |
| B | 二期《ご注文はうさぎですか？？ ORIGINAL SOUNDTRACK》 | GNCA-1476，2015-12-25，39 曲 | [原作官方完整曲目](https://gochiusa.com/series_cd/2_ost.html) |
| C | 一期 OP 单曲《Daydream café》／Petit Rabbit’s | 通常盘 GNCA-0331；初回盘 GNCA-0330 | [原作官方曲目与版本](https://gochiusa.com/series_cd/1_op.html) |

另有 [一期 Apple Music 发行专辑页](https://music.apple.com/jp/album/is-the-order-a-rabbit-original-soundtrack/1822994128) 与 [二期 Apple Music 发行专辑页](https://music.apple.com/jp/album/is-the-order-a-rabbit-original-soundtrack/1823191657)，可用于预览、收听与定位购买入口；具体可用性以所在地区页面为准。实体盘可按唱片编号定位，不要把搬运视频的标题当作正式曲名。

**编号约定：** `A-46` 指一期官网连续曲目表的第 46 首。该表第二张 CD 从 25 接着编号；因此 `A-46 = CD2 第 22 轨`，`A-48 = CD2 第 24 轨`。`B-03` 则是二期第 3 轨。

### 2.2 主选曲表

P0：第一批准备；P1：丰富场景；P2：以后扩展。下列文件名为建议导出名。

| 优先级 | 场景 / 音乐 ID | 首选原作曲目 | 出处 | 建议用途与播放方式 |
| --- | --- | --- | --- | --- |
| P0 | 标题 `title` | **Daydream café〜solo piano ver.〜** | [A-15](https://gochiusa.com/series_cd/1_ost.html) | 默认标题曲，保留主题辨识度。导出 `bgm_title.ogg`，试听后制作循环 |
| P0 | 开场 / 教学对白 `dialogue` | **おはなしをしよう** | [A-16](https://gochiusa.com/series_cd/1_ost.html) | 三班开场可先共用；以文字和人物为主。`bgm_dialogue.ogg` |
| P0 | 教学 / 常态营业 `shift_normal` | **Rabbit's Time** | [B-03](https://gochiusa.com/series_cd/2_ost.html) | 营业主循环，贯穿六工位；生存前期也可共用。`bgm_shift_normal.ogg` |
| P0 | 自由工坊 `workshop` | **おやすみ前のラテアート** | [B-15](https://gochiusa.com/series_cd/2_ost.html) | 作为长时间慢慢做卡的候选，优先听审其循环舒适度。`bgm_workshop.ogg` |
| P0 | 翻阅卡册 `stampbook` | **ぽかぽかうさぎ日和** | [A-10](https://gochiusa.com/series_cd/1_ost.html) | 收藏浏览与展示；频繁开关卡册时可沿用工坊曲。`bgm_stampbook.ogg` |
| P0 | 优秀 / 达标结算 `result_clear` | **陽だまりの優しさ** | [B-33](https://gochiusa.com/series_cd/2_ost.html) | `great`、`pass` 先共用这首，通过短提示区分喜悦程度。`bgm_result_clear.ogg` |
| P0 | 未达标 / 休息 `result_retry` | **そんな日もあるよね** | [A-09](https://gochiusa.com/series_cd/1_ost.html) | 对应“今天先歇一歇”的安慰与重试，不做沉重惩罚。`bgm_result_retry.ogg` |
| P0 | 秘密纪念册情感重点 `keepsake` | **大切な宝物** | [A-46，CD2/22](https://gochiusa.com/series_cd/1_ost.html) | 第三班成功后的对白首选；营业中的计时阶段仍用营业曲。`bgm_keepsake.ogg` |
| P1 | 繁忙营业 `shift_busy` | **〆切は苦手です〜** | [B-07](https://gochiusa.com/series_cd/2_ost.html) | 联合宣传、生存高压阶段的候选，先试听确认不会压迫玩家。`bgm_shift_busy.ogg` |
| P1 | 元气制作备选 `workshop_active` | **やってみよう** | [A-07](https://gochiusa.com/series_cd/1_ost.html) | 想让教学或自由工坊更有“开始动手”感时，与常态曲二选一 |
| P2 | 夜晚卡册 / 收店后 `after_hours` | **Rabbit House〜BAR TIME** | [B-29](https://gochiusa.com/series_cd/2_ost.html) | 未来夜间场景候选；当前没有独立夜晚模式，不必先做 |
| P2 | 未来制作名单 / 回忆展示 `credits` | **ずっと一緒に** | [A-14](https://gochiusa.com/series_cd/1_ost.html) | 未来增加长时间回忆展示时考虑；当前不新增页面 |

这里的“适合”是本项目的配乐安排，不表示已核实这首曲子在动画中对应某一集、某一句台词或某种具体镜头。

### 2.3 标题想更接近 OP 时怎么选

《Daydream café》有两种容易混淆的正式版本：

- **一期 OST A-15：`Daydream café〜solo piano ver.〜`。** 本方案默认选它，适合玩家停留在标题。
- **OP 单曲 C-03：`Daydream café (Instrumental)`。** 官方确实收录了完整伴奏版，可以作为更活泼的标题备选；这不是钢琴版，也不需要从人声版消音。[官方版本说明](https://gochiusa.com/series_cd/1_op.html)

有人声的 OP / ED 可以留给一次性开场、通关纪念或未来片尾；持续制卡和阅读对白先选无主唱配乐。第一批不必把所有主题曲、角色歌都收进来。

### 2.4 原作短曲 / 场景转场

| 原作候选 | 出处 | 可用位置 | 准备方式 |
| --- | --- | --- | --- |
| Eyecatch〜jump！〜 | [A-25，CD2/01](https://gochiusa.com/series_cd/1_ost.html) | 班次开始、单次大转场 | 约 9 秒，取得原音后保留完整尾音；[时长核对](https://tower.jp/item/3731846) |
| Eyecatch〜sweet〜 | [A-33，CD2/09](https://gochiusa.com/series_cd/1_ost.html) | 精美作品完成、卡册揭晓 | 约 10 秒，低频使用，不给每一次普通保存都播；[时长核对](https://tower.jp/item/3731846) |
| Eyecatch〜café〜 | [B-28](https://gochiusa.com/series_cd/2_ost.html) | 开门营业、收店转换 | 播一次后接营业 / 结算 BGM |
| Au revoir！ | [A-48，CD2/24](https://gochiusa.com/series_cd/1_ost.html) | 本次游玩结束、完整纪念展示结束 | **约 14 秒的结束短曲，不能当作长片尾循环**；[时长核对](https://tower.jp/item/3731846) |

这些应归入 `jingle/`，不要与长 BGM 混用。普通按钮、翻句、每张订单交付仍使用更短的 SE，避免不断响起一段音乐。

## 3. 音效清单：按钮、手作、营业与冲印

原作音乐已有明确 OST；本次没有核实到可直接作为创作素材使用的原作独立 SE 包。门铃、纸张、机器等先按原作日常氛围寻找干净声源；无法取得干净原作声时，用同类实录或自录补齐。**下面的素材站音效是风格替代，不标成“动画原版音效”。**

本节表中的时长是设计目标；已导出文件的实际长度以 [素材清单](../game/public/assets/audio/SOURCES.md) 为准。`printer_loop` 已准备循环候选，仍需接入后试听。

### 3.1 核心交互与营业反馈

| 优先级 | 建议文件名 | 实际触发 | 声音方向 / 建议长度 |
| --- | --- | --- | --- |
| P0 | `ui_click` | 普通确认、选择菜单 | 软木 / 木琴式短音，50–120 ms；高频操作不要有长尾 |
| P0 | `ui_back` | 返回、关闭、取消操作 | 比确认更低或更短的一声，60–150 ms |
| P0 | `ui_unavailable` | 无法完成的主动操作 | 柔和低短音，100–200 ms；真正禁用的按钮不强行响应 |
| P0 | `dialogue_next` | 点击“下一句” | 轻纸声或更轻的确认音，40–100 ms；可复用 `ui_click` |
| P0 | `order_arrive` | 新顾客真正到达 | 咖啡店机械门铃“叮铃”，0.6–1.5 s；优先保留原作店铺感 |
| P0 | `patience_warning` | 顾客进入最后等待阶段 | 清楚但柔和的两声提醒，0.2–0.5 s；每位客人一次 |
| P0 | `archive_success` | 实际保存成功、收入 StampBook | 纸页合拢加轻亮音，0.2–0.5 s；不能点击后立即假报成功 |
| P0 | `puzzle_success` | 整个校准成功 | 两到三音的清亮短句，0.3–0.7 s |
| P0 | `puzzle_failure` | 整个校准失败 / 超时 | 柔和下行短句，0.2–0.6 s；避免刺耳蜂鸣 |
| P0 | `machine_ready` | **冲印完成、可以取片** | 与耐心提醒不同的明亮双音，0.3–0.6 s |
| P0 | `delivery_good` | 已交付，且评价满意 | 轻快确认 / 小铃音，0.3–0.7 s；不必每次播角色语音 |
| P1 | `delivery_okay` | 已交付，但仅一般评价 | 中性收件音，0.2–0.4 s；与保存成功区分 |
| P1 | `customer_leave` | 等待超时或闭店离开 | 一次较轻提示，0.2–0.5 s，不用大失败号角 |
| P1 | `result_clear` / `result_retry` | 结算首次进入 | 各一声收工 / 安慰短提示；长情绪交给 BGM |

`machine_ready`、`patience_warning`、`puzzle_success`、`puzzle_failure` 对应现有四类合成提示，第一版也可以保留，不必为了换音源阻塞其他素材准备。鼠标与快捷键应得到同样反馈。

### 3.2 制卡与冲印的实物声

| 优先级 | 建议文件名 | 对应动作 | 声音方向 / 触发限制 |
| --- | --- | --- | --- |
| P0 | `paper_pick` | 接单读纸签、选卡纸、拿起材料 | 很轻的纸张摩擦，0.1–0.4 s |
| P0 | `paper_cut` | 裁卡坯、工艺台真正落刀 | 干净“咔嚓 / 唰”，0.15–0.5 s；启动裁边尺时不提前播放 |
| P0 | `piece_place` | 素材成功落在槽位、自由工坊放下贴纸 | 轻触纸面“啪 / 嗒”，0.06–0.18 s；不是拖动每一帧都响 |
| P0 | `stamp_press` / `stamp_lift` | 盖章按下 / 松开 | 软木闷响与轻抬起，按住期间不连播；蜡封按章可复用 |
| P1 | `ribbon_fix` | 缎带固定左端 / 收好右端 | 布带摩擦或轻结扣，0.1–0.4 s |
| P1 | `foil_brush` / `foil_peel` | 接触烫金面 / 揭下烫金纸 | 轻刷与薄膜揭离；刷动按间隔触发，避免 36 格逐格叠响 |
| P1 | `wax_pour` | 开始倒蜡并按章 | 极短稠液落点声，0.2–0.6 s；不做持续火焰轰鸣 |
| P1 | `inspection_open` | 实际完成一次检查、出现报告 | 翻纸 / 铅笔勾记，0.15–0.4 s |
| P1 | `book_page` | 翻开卡册、切换收藏页 | 纸页翻动，0.2–0.6 s；不要给每个缩略图加载都播 |
| P1 | `printer_start` / `printer_loop` | 真正提交冲印 / 机器运行 | 起动咔嗒 + 低音量纸辊；`loop` 可选，两台机器同时工作应控制总量 |
| P1 | `printer_output` | 机器完成时出纸 | 纸辊退出，0.4–1.0 s；与 `machine_ready` 合成一次完整提示，避免两声抢响 |
| P2 | `brush_stroke` | 自由工坊画笔 | 极轻纸面擦动；只在落笔与有效移动时出现 |

表格是事件清单，不要求每行都录一套独立素材。例如 `paper_pick`、`book_page` 可以从同次录纸声中剪出；普通落位和缎带固定也可以共用两三个轻触变体。

### 3.3 已核实的替代音效入口

| 用途 | 素材页 / 检索项 | 使用建议 |
| --- | --- | --- |
| 普通点击 | [効果音ラボ：ボタン・システム音](https://soundeffect-lab.info/sound/button/) → `決定ボタンを押す3`、`決定ボタンを押す34` | 官网分别描述为偏柔和的决定音；试听后只选一套作为全局基础 |
| 手作感点击 | [同一按钮素材页](https://soundeffect-lab.info/sound/button/) → `決定ボタンを押す29` | 木琴实录候选，可作素材选中 / 完成轻提示 |
| 对话出现提示 | [同一按钮素材页](https://soundeffect-lab.info/sound/button/) → `メッセージ表示音3` | 可选的可爱提示音；这是通用素材，不是人物语音 |
| 店铺门铃 | [On-Jin：ベル・鐘・鈴](https://on-jin.com/sound/sei.php?bunr=%E3%83%99%E3%83%AB%E3%83%BB%E9%90%98%E3%83%BB%E9%88%B4&kate=%E9%81%93%E5%85%B7) → `カウベル（カランコロン）` | 咖啡店机械铃候选，按实际试听决定是否需要加轻门声 |
| 翻纸 / 剪纸 | [効果音ラボ：生活 2](https://soundeffect-lab.info/sound/various/various2.html) → `ページをめくる1`、`ハサミで紙を切る` | 分别对应卡册翻页与真实裁切；不要把撕裂声当整齐裁边 |
| 印章 | [On-Jin：はんこ](https://on-jin.com/sound/sei.php?bunr=%E3%81%AF%E3%82%93%E3%81%93&kate=%E6%96%87%E5%85%B7) | 明确的盖章素材入口，配合按下 / 松开动作裁切 |
| 打印机 | [効果音ラボ：機械](https://soundeffect-lab.info/sound/machine/) → `プリンタで印刷` | 机器起动 / 纸辊备选；原条目注明机器偏大，需试听确认是否适合小店 |
| 翻书备选 | [OtoLogic：本](https://otologic.jp/free/se/books01.html) → `本03-1(めくる)` 等 | 卡册翻页的另一组候选，优先选轻、短、不抢提示的版本 |
| 门、步行、一般生活声 | [効果音ラボ：生活](https://soundeffect-lab.info/sound/various/) | 背景事件备选，当前不必大批加入 |
| 其他铃音 / 成功失败提示 | [OtoLogic 素材主页](https://otologic.jp/) | 找统一音色作为补充，使用时按 [官方条款](https://otologic.jp/free/license.html) 标注 OtoLogic |

印章、剪纸、缎带、揭膜最贴合本项目的做法是直接录自己的工具：近距离录数个干净变体，剪掉底噪与长空白，再与菜单音统一响度。这样也不会为了“像原作”把动画里叠着对白和音乐的杂音一起放进游戏。

## 4. 对话音与人物说话：分开准备

### 4.1 当前界面适合“每句开头一次”

当前 [开场对白](../game/src/screens/ShiftDialogue.tsx) 是整句显示并点击“下一句”，没有逐字打字机；[营业闲话](../game/src/components/ShiftChatter.tsx) 是短时提示，同一触发在一班中只显示一次，生存模式不显示这些剧情闲话。

因此第一版建议：

1. 每句出现时，在通用轻提示与角色短语气片段之间选一种，不要同时响三四层声音。
2. 原作语音只放在登场、欣喜、惊讶、温柔收尾等重点句；教学的每一条操作说明都发声会很吵。
3. 连点下一句立即停止上一句语音；跳过已读不补播；恢复存档不重播已经出现的闲话。
4. 若以后增加逐字文本，再单独准备很轻的短打字音，约每 2–3 字触发并设最小间隔。它是新增效果，不是当前已有功能。

### 4.2 五位角色的声音准备表

CV 名单可在 [原作官方 OP 页面](https://gochiusa.com/series_cd/1_op.html) 核实。以下是希望寻找的语气类型，不是声称动画中存在某句可直接对应的台词。

| 角色 | 日文名 / 原作声优 | 优先找的短声音 | 本项目合适触发 |
| --- | --- | --- | --- |
| 心爱 | ココア / 佐倉綾音 | 元气应答、轻笑、短惊呼 | 教学登场、开门营业、优秀交付 |
| 智乃 | チノ / 水瀬いのり | 轻声应答、轻叹、克制的高兴 | 工序提醒、温柔吐槽、纪念册结尾 |
| 理世 | リゼ / 種田梨沙 | 干脆确认、肯定、略害羞 | 检查完成、稳定工序、夸奖作品 |
| 千夜 | 千夜 / 佐藤聡美 | 温柔应答、掩口轻笑、柔和感叹 | 茶会订单、作品欣赏、打烊闲谈 |
| 纱路 | シャロ / 内田真礼 | 短促应答、惊讶、松口气 | 赶班订单、材料提醒、完成交付 |

第一批可以每人只收 **2–3 个约 0.25–1.2 秒的短片段**，按 `voice/cocoa/agree_01`、`voice/chino/happy_01` 等归档。这里的时长是剪辑目标，不是已找到的音频规格。普通顾客使用通用轻提示，不套主角的声音。

### 4.3 想用原作声音，具体怎么准备

- 原声候选来自你有权使用的动画、官方音声内容或角色对白音轨，优先找没有配乐、没有其他人叠话的应答、轻笑、吸气等片段。每个片段记录作品、集数 / 轨号、时间码、角色与语气，听不到干净原声就先留用通用提示。
- 项目里是“制卡姐姐”“联合店铺宣传”“秘密纪念册”等原创中文对白；原作日文片段用于传达情绪，不能假装是这些新句子的完整配音。要做逐句配音需要另行制作与文本对应的录音。
- 不要把主题歌的人声分离结果当成可用角色对白。也不要为了所有句子都有声音，反复塞同一个辨识度很强的口头禅。
- 暂时没有合适角色片段时，可以保留文本，只加轻翻句音；或准备五种很短的提示音色。后者应标为角色提示音，不能标为原作声优录音。

原作演绎参考可看 [官方《Wonderful party!》角色介绍视频页](https://game.mages.co.jp/gochiusa/special/)。该游戏旧站也保留历史倒计时语音公告，但本次未验证音频仍可播放；这些都不能当成已经取得的五人语音素材包。

## 5. 环境声：少量即可

| 可选素材 | 适用位置 | 建议 |
| --- | --- | --- |
| 轻微室内底声、偶尔杯碟声 | 营业、自由工坊 | 低于主要操作音，不需要一直有可辨认的人声 |
| 远处研磨、倒咖啡、放杯 | 开场背景或收店后的单次演出 | 只在画面 / 文案有相应动作时点缀，不给每次制卡播放 |
| 翻纸与整理桌面 | 开场、结算 | 短事件即可，可复用手作 SE |

先用 BGM + 核心 SE 做出干净体验，再决定是否加底声。门铃、机器出片和耐心提醒必须能被听清。

## 6. 第一批素材包怎么落地

### 6.1 先做的最小一版

1. **8 首 P0 BGM：** 标题、对白、常态营业、自由工坊、卡册、达标结算、未达标结算、秘密纪念册重点。
2. **核心 SE：** 点击 / 返回、门铃、纸张、裁切、落位、印章、保存成功、满意交付。现有四类合成提示先保留；翻句可复用轻点击。
3. **角色声音后加：** 有干净原作片段再加，没有也能完成第一版。之后补忙碌曲、转场短曲和细分工艺声。

如果素材处理时间更紧，卡册直接沿用工坊曲，第三班结尾直接沿用达标曲，第一版只准备 6 首也能覆盖全部流程。

### 6.2 建议目录与素材记录

实际接入的音源放在 `game/public/assets/audio/`，候选音源保存在 `materials/audio/candidates/`：

```text
audio/
  bgm/       bgm_title.ogg, bgm_dialogue.ogg, bgm_shift_normal.ogg, ...
  se/        ui_click.ogg, paper_cut.ogg, stamp_press.ogg, ...
  SOURCES.md
  manifest.json
```

当前发布目录只保留实际使用的 `bgm/`、`se/`、来源说明和 manifest。BGM 原件在 `materials/audio/bgm/`，原始音效下载在 `materials/audio/sfx/`；备选 BGM、短转场曲、备选 SE 与环境声在 `materials/audio/candidates/`，未创建空的角色语音目录。短 SE 优先保留瞬态和清晰度，不要只追求文件小。

为每个音源记录：**资源 ID、导出文件名、原始日文名称、来源链接 / 唱片与轨号、使用依据、剪辑时间范围、循环起止、增益、是否已听审。** 比如 `bgm_title → A-15 → 一期 OST CD1/15`；角色片段必须能回到具体原始时间码。

### 6.3 播放与混音要求

以下规则已用于本轮接入；精确音乐循环点和最终混音仍需实际试听：

- **按大场景换曲：** 标题 → 开场对白 → 营业 → 结算；自由工坊独立一条。切台、切订单、进入校准不重新播放营业曲。
- **曲目切换做约 0.6–1.2 秒淡入淡出。** 不要每次开关卡册就重启一首歌。循环边界以实际听审为准，不默认整首首尾硬接。
- **联合宣传与生存天梯采用繁忙曲。** 同一班内不按订单数频繁来回切歌，切换工位也不改曲。
- **音乐与音效分开调节并保存偏好。** 教学、开场对白与营业闲话出现时降低音乐音量；目前没有独立人声轨。
- **首次有效点击 / 按键后解锁声音。** 标题自动播放失败不能影响游戏；标题默认曲也要有可触达的声音开关。
- **后台标签页静音或暂停声音。** 游戏本身的营业计时仍按现有规则推进；恢复时不追补积压通知。
- **提示只在事件发生时播放一次。** 保存失败不播保存成功；恢复机器状态不补播出片；重复渲染不重播；高频拖动、烫金和画笔要节流。
- **重要提醒优先于装饰声。** 两台机器完成、顾客预警同时发生时避免叠加过响；语音只保留一条，不积压长队列。

## 7. 当前音频实现与后续接入位置

播放逻辑已统一为 [game-audio.ts](../game/src/infrastructure/game-audio.ts) 与 [AudioProvider.tsx](../game/src/app/AudioProvider.tsx)，从 [audio.ts](../game/src/content/audio.ts) 读取本地资源；[AudioControls.tsx](../game/src/components/AudioControls.tsx) 提供全局设置。旧正弦波实现已移除，[ShiftSoundFeedback.tsx](../game/src/components/ShiftSoundFeedback.tsx) 保留经营事件去重，并改播素材文件。没有原作角色录音。

当前接入位置：

| 位置 | 对应工作 |
| --- | --- |
| [App.tsx](../game/src/app/App.tsx) / 全局音频层 | 维护跨页面播放器、场景 BGM、全局声音设置 |
| [TitleScreen.tsx](../game/src/screens/TitleScreen.tsx) | 标题曲、首次声音解锁、菜单反馈 |
| [ShiftDialogue.tsx](../game/src/screens/ShiftDialogue.tsx)、[ShiftChatter.tsx](../game/src/components/ShiftChatter.tsx) | 对白曲、翻句音、角色短片段与 BGM 降音量 |
| [工位组件目录](../game/src/components/stations) | 根据真实成功动作触发纸张、裁切、盖章、烫金与冲印声 |
| [ShiftSoundFeedback.tsx](../game/src/components/ShiftSoundFeedback.tsx) | 延续四类重要提醒的去重与恢复语义，再替换 / 保留音色 |
| [ShiftResult.tsx](../game/src/screens/ShiftResult.tsx) | 根据实际结算分支选择曲目，第三班成功对白使用纪念册曲 |
| [WorkbenchScreen.tsx](../game/src/screens/WorkbenchScreen.tsx)、[StampBookScreen.tsx](../game/src/screens/StampBookScreen.tsx)、[PrintShopScreen.tsx](../game/src/screens/PrintShopScreen.tsx) | 自由工坊、卡册和独立冲印的音效 |

素材与使用记录应区分原作商业录音、自录和素材站音效；官方收听 / 购买页面只用来确认作品与获取渠道，不当作游戏嵌入授权。素材站按各自条款记录署名与使用条件，例如 [OtoLogic 的 CC BY 4.0 说明](https://otologic.jp/free/license.html)。
