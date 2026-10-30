# 音频素材、部署与使用记录

准备日期：2026-10-16。当前游戏保留 **9 首 BGM、31 个音效**，共 49 个音频文件（BGM 各有 OGG / MP3，音效为 OGG）。未调用的 **5 首音乐、7 个音效**已移到 [materials/audio/candidates/](../../../../materials/audio/candidates/)，共 17 个文件，不随游戏静态资源部署。

素材准备时共下载 **35 个原始 MP3**，导出 **38 个 OGG**（35 个交互音效、3 个环境音），导出文件合计约 **470 KiB**；另从用户提供的 14 首音乐制作了双格式副本。原始素材、处理参数、署名和既有验证记录均保留，原文件未删除或改动。

- 游戏用文件：[bgm/](bgm/) 与 [se/](se/)。
- 在用逐文件数据：[manifest.json](manifest.json)，包括资源 ID、本地 URL、来源、原始文件、裁切范围、增益和循环标记；候选记录另存于 [候选 manifest](../../../../materials/audio/candidates/manifest.json)。
- 原始下载：[materials/audio/sfx/](../../../../materials/audio/sfx/)，保留未加工 MP3 与各组下载记录。
- 用户提供的 14 首音乐原件保存在 [materials/audio/bgm/](../../../../materials/audio/bgm/)，未覆盖或转码；9 首在用 BGM 的部署副本位于 [bgm/](bgm/)，其余音乐副本保存在候选目录。
- 共享接口：[game/src/content/audio.ts](../../../src/content/audio.ts) 导出 `BGM_TRACKS` / `BgmId`、`SFX_TRACKS` / `SfxId` 与 `AudioTrackDefinition`。BGM 优先 OGG，MP3 为兼容回退；音效条目沿用已有 OGG。
- 清单条目的 `volume` 统一为 1，用户音量由播放器管理。常规界面提示冷却 50 ms，手作提示 70–120 ms，通知提示 300 ms。候选条目已移出此接口，保留在候选 manifest 中。

这批音效来自原作者素材站，**不是动画原版 SE，也不包含原作声优录音**。`dialogue_next` / `dialogue_open` 是通用界面提示，不是人物对白。原作官方旧站未取得可用的独立短语音，检索情况保存在原始下载的 details 记录中。

## 在用 BGM（9 首）

这些音乐由项目所有者提供，原作名称和轨号按[一期官方 OST](https://gochiusa.com/series_cd/1_ost.html)与[二期官方 OST](https://gochiusa.com/series_cd/2_ost.html)核实。它们与下方的免费素材站音效来源分开记录；官方曲目页本身不是音乐的开放使用许可。本次只复制、改稳定文件名，没有重编码或改动响度，也未制作或听审精确循环点。

| BGM ID | 本地 OGG / MP3 | 原作曲目 | 唱片与轨号 |
| --- | --- | --- | --- |
| `title` | [bgm_title.ogg](bgm/bgm_title.ogg) / [MP3](bgm/bgm_title.mp3) | Daydream café〜solo piano ver.〜 | GNCA-1389，CD1/15 |
| `dialogue` | [bgm_dialogue.ogg](bgm/bgm_dialogue.ogg) / [MP3](bgm/bgm_dialogue.mp3) | おはなしをしよう | GNCA-1389，CD1/16 |
| `shift_normal` | [bgm_shift_normal.ogg](bgm/bgm_shift_normal.ogg) / [MP3](bgm/bgm_shift_normal.mp3) | Rabbit's Time | GNCA-1476，CD1/03 |
| `workshop` | [bgm_workshop.ogg](bgm/bgm_workshop.ogg) / [MP3](bgm/bgm_workshop.mp3) | おやすみ前のラテアート | GNCA-1476，CD1/15 |
| `stampbook` | [bgm_stampbook.ogg](bgm/bgm_stampbook.ogg) / [MP3](bgm/bgm_stampbook.mp3) | ぽかぽかうさぎ日和 | GNCA-1389，CD1/10 |
| `result_clear` | [bgm_result_clear.ogg](bgm/bgm_result_clear.ogg) / [MP3](bgm/bgm_result_clear.mp3) | 陽だまりの優しさ | GNCA-1476，CD1/33 |
| `result_retry` | [bgm_result_retry.ogg](bgm/bgm_result_retry.ogg) / [MP3](bgm/bgm_result_retry.mp3) | そんな日もあるよね | GNCA-1389，CD1/09 |
| `keepsake` | [bgm_keepsake.ogg](bgm/bgm_keepsake.ogg) / [MP3](bgm/bgm_keepsake.mp3) | 大切な宝物 | GNCA-1389，CD2/22 |
| `shift_busy` | [bgm_shift_busy.ogg](bgm/bgm_shift_busy.ogg) / [MP3](bgm/bgm_shift_busy.mp3) | 〆切は苦手です〜 | GNCA-1476，CD1/07 |

场景映射遵循 [docs/bgm.md](../../../../docs/bgm.md)：标题、开场对白、常态营业、自由工坊、卡册、达标结算、休息重试和秘密纪念册重点分别使用对应 ID。`shift_busy` 用于联合宣传和生存天梯；频繁切换工位不重启营业曲。

## 未接入音乐备选（5 首）

以下 1 首长 BGM 和 4 首短转场曲没有播放调用，已移出 `game/`；它们的完整来源与处理记录保存在 [候选 manifest](../../../../materials/audio/candidates/manifest.json)。短转场曲的用途只是待选建议。

| BGM ID | 候选 OGG / MP3 | 原作曲目 | 唱片与轨号 |
| --- | --- | --- | --- |
| `workshop_active` | [bgm_workshop_active.ogg](../../../../materials/audio/candidates/bgm/bgm_workshop_active.ogg) / [MP3](../../../../materials/audio/candidates/bgm/bgm_workshop_active.mp3) | やってみよう | GNCA-1389，CD1/07 |

`workshop_active` 保留作元气制作备选。

| Jingle ID | 本地 OGG / MP3 | 原作曲目 | 可选用途 |
| --- | --- | --- | --- |
| `eyecatch_jump` | [eyecatch_jump.ogg](../../../../materials/audio/candidates/jingle/eyecatch_jump.ogg) / [MP3](../../../../materials/audio/candidates/jingle/eyecatch_jump.mp3) | Eyecatch〜jump！〜 | 班次开始或单次大转场 |
| `eyecatch_sweet` | [eyecatch_sweet.ogg](../../../../materials/audio/candidates/jingle/eyecatch_sweet.ogg) / [MP3](../../../../materials/audio/candidates/jingle/eyecatch_sweet.mp3) | Eyecatch〜sweet〜 | 精美作品完成或卡册揭晓，低频使用 |
| `eyecatch_cafe` | [eyecatch_cafe.ogg](../../../../materials/audio/candidates/jingle/eyecatch_cafe.ogg) / [MP3](../../../../materials/audio/candidates/jingle/eyecatch_cafe.mp3) | Eyecatch〜café〜 | 开门营业或收店转换 |
| `au_revoir` | [au_revoir.ogg](../../../../materials/audio/candidates/jingle/au_revoir.ogg) / [MP3](../../../../materials/audio/candidates/jingle/au_revoir.mp3) | Au revoir！ | 本次游玩或完整纪念展示结束 |

## 音效来源与署名

- **効果音ラボ / Sound Effect Lab**：[网站](https://soundeffect-lab.info/)、[使用条款](https://soundeffect-lab.info/agreement/)、[FAQ](https://soundeffect-lab.info/faq/)。可用于游戏操作音并允许加工，署名自愿；本项目保留出处。素材文件不可作为独立音效包再分发，游戏应播放本地文件。
- **On-Jin ～音人～**：[网站](https://on-jin.com/)、[使用条款](https://on-jin.com/kiyaku.php)。本项目按个人同人作品嵌入使用；由于静态音源可直接访问，随文件保留其要求的署名和音源使用提示：

> 効果音：On-Jin ～音人～（https://on-jin.com/）／音源の二次配布・無断利用禁止

On-Jin 来源用于 `order_arrive`、`stamp_press`、`stamp_lift`。本文件与 manifest 应随这几个音效保留。`download_url` 只是下载溯源记录，不是运行时播放地址；On-Jin 下载路径会变化，重新取得文件时应从素材页面定位。

## 已做的处理

下面的 38 个音效与环境声全部导出为 **44.1 kHz、单声道、Ogg Vorbis**；BGM 与短转场曲保留用户所供格式，不适用本段处理参数。按事件用途调整峰值、去除多余首尾静音，并加约 2 ms / 20 ms 的短淡入淡出。原始下载留在 [materials/audio/sfx/](../../../../materials/audio/sfx/)，未覆盖。

- 普通点击默认使用较短的柔和音；较长版本 `ui_click_alt` 保存在候选目录。
- 剪纸从连续原音中截出一次动作；机器启动、运行、出片从同一打印机录音分段。
- `printer_loop` 做了 64 ms 交叉拼接，标记 `loop: true`，在游戏中还需根据画面试听确认循环效果。
- 缎带使用布料摩擦替代，烫金使用铝箔声替代，轻刷使用擦拭声替代。`wax_pour` 是倒水片段的候选替代，**不是蜡封实录**。
- 抬章复用较轻的盖章片段，检查报告与卡册复用翻纸声。这解释了 35 个原始下载对应 38 个语义音效。
- 本次未做主观听审；最终音色、与 BGM 的平衡和环境声使用频率需在接入后试听。所有文件均保留该状态，避免把转码完成等同于混音定稿。

## 在用音效清单（31 个）

下表时长是实际导出长度。较长的成功、交付音用于整个事件，不应在每个小按钮或题目格子上反复触发。

| ID / 文件 | 实际时长 | 建议用途 | 原始素材 / 来源页 |
| --- | ---: | --- | --- |
| [ui_click](se/ui_click.ogg) | 0.231 s | 普通按钮柔和确认短音 | [決定ボタンを押す34](https://soundeffect-lab.info/sound/button/) |
| [ui_back](se/ui_back.ogg) | 0.189 s | 返回、关闭、取消 | [キャンセル6](https://soundeffect-lab.info/sound/button/) |
| [ui_unavailable](se/ui_unavailable.ogg) | 0.221 s | 无法完成的主动操作 | [ビープ音5](https://soundeffect-lab.info/sound/button/) |
| [dialogue_next](se/dialogue_next.ogg) | 0.081 s | 翻到下一句的短提示；非人物语音 | [カーソル移動7](https://soundeffect-lab.info/sound/button/) |
| [dialogue_open](se/dialogue_open.ogg) | 0.231 s | 对白面板出现的柔和短提示；非人物语音 | [決定ボタンを押す34](https://soundeffect-lab.info/sound/button/) |
| [piece_place](se/piece_place.ogg) | 0.242 s | 配件成功落位的木琴轻音 | [決定ボタンを押す29](https://soundeffect-lab.info/sound/button/) |
| [archive_success](se/archive_success.ogg) | 1.597 s | 保存成功、收入卡册 | [決定ボタンを押す4](https://soundeffect-lab.info/sound/button/) |
| [patience_warning](se/patience_warning.ogg) | 1.215 s | 顾客进入最后等待阶段 | [警告音1](https://soundeffect-lab.info/sound/button/) |
| [puzzle_success](se/puzzle_success.ogg) | 2.427 s | 校准整体成功 | [成功音](https://soundeffect-lab.info/sound/button/) |
| [puzzle_failure](se/puzzle_failure.ogg) | 0.320 s | 校准失败或超时 | [ビープ音1](https://soundeffect-lab.info/sound/button/) |
| [machine_ready](se/machine_ready.ogg) | 1.809 s | 冲印完成，可以取片 | [決定ボタンを押す8](https://soundeffect-lab.info/sound/button/) |
| [delivery_good](se/delivery_good.ogg) | 2.017 s | 已交付且顾客满意 | [決定ボタンを押す30](https://soundeffect-lab.info/sound/button/) |
| [delivery_okay](se/delivery_okay.ogg) | 0.897 s | 一般交付确认 | [決定ボタンを押す23](https://soundeffect-lab.info/sound/button/) |
| [result_clear](se/result_clear.ogg) | 1.184 s | 营业达标结算 | [決定ボタンを押す24](https://soundeffect-lab.info/sound/button/) |
| [result_retry](se/result_retry.ogg) | 0.514 s | 休息与再次尝试 | [決定ボタンを押す22](https://soundeffect-lab.info/sound/button/) |
| [customer_leave](se/customer_leave.ogg) | 0.189 s | 离店的轻提示，复用较轻的返回音 | [キャンセル6](https://soundeffect-lab.info/sound/button/) |
| [order_arrive](se/order_arrive.ogg) | 2.695 s | 顾客进店的机械门铃 | [カウベル（カランコロン）](https://on-jin.com/sound/listshow.php?bunr=%E3%83%99%E3%83%AB%E3%83%BB%E9%90%98%E3%83%BB%E9%88%B4&janl=%E7%94%9F%E6%B4%BB%E7%B3%BB%E9%9F%B3&kate=%E9%81%93%E5%85%B7&pagename=sei&title=%E3%82%AB%E3%82%A6%E3%83%99%E3%83%AB%EF%BC%88%E3%82%AB%E3%83%A9%E3%83%B3%E3%82%B3%E3%83%AD%E3%83%B3%EF%BC%89) |
| [paper_pick](se/paper_pick.ogg) | 0.276 s | 接单、选卡纸、拿起材料的短纸声 | [紙を広げる2](https://soundeffect-lab.info/sound/various/various2.html) |
| [paper_cut](se/paper_cut.ogg) | 0.290 s | 剪纸或落刀的单次短反馈 | [ハサミで紙を切る](https://soundeffect-lab.info/sound/various/various2.html) |
| [stamp_press](se/stamp_press.ogg) | 0.183 s | 按下印章 | [はんこ](https://on-jin.com/sound/sei.php?bunr=%E3%81%AF%E3%82%93%E3%81%93&kate=%E6%96%87%E5%85%B7) |
| [stamp_lift](se/stamp_lift.ogg) | 0.183 s | 抬章的较轻触感替代 | [はんこ](https://on-jin.com/sound/sei.php?bunr=%E3%81%AF%E3%82%93%E3%81%93&kate=%E6%96%87%E5%85%B7) |
| [foil_brush](se/foil_brush.ogg) | 0.280 s | 烫金轻擦的短动作候选 | [アルミホイルで包む](https://soundeffect-lab.info/sound/various/various2.html) |
| [foil_peel](se/foil_peel.ogg) | 0.569 s | 揭箔的短摩擦替代 | [アルミホイルをちぎる](https://soundeffect-lab.info/sound/various/various2.html) |
| [inspection_open](se/inspection_open.ogg) | 0.795 s | 检查报告出现的轻翻纸 | [ページをめくる1](https://soundeffect-lab.info/sound/various/various2.html) |
| [book_page](se/book_page.ogg) | 0.795 s | 卡册翻页 | [ページをめくる1](https://soundeffect-lab.info/sound/various/various2.html) |
| [printer_start](se/printer_start.ogg) | 0.650 s | 机器启动的短纸辊声 | [プリンタで印刷](https://soundeffect-lab.info/sound/machine/) |
| [printer_loop](se/printer_loop.ogg) | 3.536 s | 冲印机运行的循环候选 | [プリンタで印刷](https://soundeffect-lab.info/sound/machine/) |
| [printer_output](se/printer_output.ogg) | 0.916 s | 出片时的短纸辊声 | [プリンタで印刷](https://soundeffect-lab.info/sound/machine/) |
| [ribbon_fix](se/ribbon_fix.ogg) | 0.427 s | 固定缎带的短布料声 | [衣擦れ2](https://soundeffect-lab.info/sound/various/various3.html) |
| [brush_stroke](se/brush_stroke.ogg) | 0.250 s | 画笔或轻刷动作的摩擦替代 | [キュッキュッと拭く1](https://soundeffect-lab.info/sound/various/various2.html) |
| [wax_pour](se/wax_pour.ogg) | 0.400 s | 倒蜡动作的轻液体声候选 | [グラスに水を注ぐ](https://soundeffect-lab.info/sound/various/various2.html) |

## 未接入音效备选（7 个）

这 4 个替代提示音和 3 个环境点缀没有播放调用，已移出运行清单；处理参数与来源记录保存在 [候选 manifest](../../../../materials/audio/candidates/manifest.json)。

| ID / 文件 | 实际时长 | 建议用途 | 原始素材 / 来源页 |
| --- | ---: | --- | --- |
| [ui_click_alt](../../../../materials/audio/candidates/se/ui_click_alt.ogg) | 0.847 s | 带较长余音的柔和确认备选 | [決定ボタンを押す3](https://soundeffect-lab.info/sound/button/) |
| [dialogue_next_alt](../../../../materials/audio/candidates/se/dialogue_next_alt.ogg) | 0.976 s | 较长的对话显示提示备选；非人物语音 | [メッセージ表示音3](https://soundeffect-lab.info/sound/button/) |
| [paper_pick_alt](../../../../materials/audio/candidates/se/paper_pick_alt.ogg) | 0.923 s | 较完整的展开纸张备选 | [紙を広げる1](https://soundeffect-lab.info/sound/various/various2.html) |
| [book_page_alt](../../../../materials/audio/candidates/se/book_page_alt.ogg) | 0.913 s | 卡册翻页备选短片段 | [ページをめくる2](https://soundeffect-lab.info/sound/various/various2.html) |
| [cafe_cup_place](../../../../materials/audio/candidates/ambient/cafe_cup_place.ogg) | 0.320 s | 咖啡杯放到杯碟上 | [ソーサーにコーヒーカップを置く](https://soundeffect-lab.info/sound/various/various2.html) |
| [cafe_saucer_place](../../../../materials/audio/candidates/ambient/cafe_saucer_place.ogg) | 0.296 s | 放下咖啡杯碟 | [コーヒーのソーサーを置く](https://soundeffect-lab.info/sound/various/various2.html) |
| [cafe_water_pour](../../../../materials/audio/candidates/ambient/cafe_water_pour.ogg) | 3.523 s | 倒水的完整环境点缀 | [グラスに水を注ぐ](https://soundeffect-lab.info/sound/various/various2.html) |

## 游戏中的声音设置

右下角“声音”提供音乐音量、音效音量和全部静音，偏好保存本地。首次交互后启用；音乐按大场景切换并淡变，后台暂停声音，返回不补播旧通知。对白与教学出现时降低音乐音量。经营与工坊的保存成功、机器状态和手作反馈依据真实操作或状态增量触发。没有新增人声配音。
