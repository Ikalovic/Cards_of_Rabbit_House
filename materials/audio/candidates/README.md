# 未接入的音频候选

此目录保存整理前仅登记在音频清单、没有播放调用的备选素材：**5 首音乐、7 个音效，共 17 个文件**。文件从 `game/public/assets/audio/` 移出，未改动音频内容；它们不属于当前运行资源。

- [manifest.json](manifest.json) 保留每项来源、署名、原始文件、处理参数和试听状态。`path` / `fallback_path` 相对于本目录；`source_file` / `source_files` 相对于仓库根目录。`previous_url` / `previous_fallback_url` 仅记录原部署位置。
- 用户提供的音乐原件：[../bgm/](../bgm/)。原始下载音效：[../sfx/](../sfx/)。
- 在用资源与完整来源说明：[游戏音频 SOURCES.md](../../../game/public/assets/audio/SOURCES.md)；在用清单：[游戏音频 manifest](../../../game/public/assets/audio/manifest.json)。

## 音乐（5 首，10 个文件）

| ID | OGG | MP3 | 选择建议 |
| --- | --- | --- | --- |
| `workshop_active` | [OGG](bgm/bgm_workshop_active.ogg) | [MP3](bgm/bgm_workshop_active.mp3) | 元气制作备选 |
| `eyecatch_jump` | [OGG](jingle/eyecatch_jump.ogg) | [MP3](jingle/eyecatch_jump.mp3) | 班次开始或单次大转场 |
| `eyecatch_sweet` | [OGG](jingle/eyecatch_sweet.ogg) | [MP3](jingle/eyecatch_sweet.mp3) | 精美作品完成或卡册揭晓，低频使用 |
| `eyecatch_cafe` | [OGG](jingle/eyecatch_cafe.ogg) | [MP3](jingle/eyecatch_cafe.mp3) | 开门营业或收店转换 |
| `au_revoir` | [OGG](jingle/au_revoir.ogg) | [MP3](jingle/au_revoir.mp3) | 本次游玩或完整纪念展示结束 |

## 音效（7 个 OGG）

| ID | 文件 | 选择建议 |
| --- | --- | --- |
| `ui_click_alt` | [OGG](se/ui_click_alt.ogg) | 带较长余音的柔和确认备选 |
| `dialogue_next_alt` | [OGG](se/dialogue_next_alt.ogg) | 较长的对话显示提示备选；非人物语音 |
| `paper_pick_alt` | [OGG](se/paper_pick_alt.ogg) | 较完整的展开纸张备选 |
| `book_page_alt` | [OGG](se/book_page_alt.ogg) | 卡册翻页备选短片段 |
| `cafe_cup_place` | [OGG](ambient/cafe_cup_place.ogg) | 咖啡杯放到杯碟上 |
| `cafe_saucer_place` | [OGG](ambient/cafe_saucer_place.ogg) | 放下咖啡杯碟 |
| `cafe_water_pour` | [OGG](ambient/cafe_water_pour.ogg) | 倒水的完整环境点缀 |

候选音乐沿用项目所有者提供的来源与版权记录，官方专辑页面只用于核实曲名和轨号。候选音效来源为効果音ラボ / Sound Effect Lab，保留其[来源](https://soundeffect-lab.info/)和[使用条款](https://soundeffect-lab.info/agreement/)；完整元数据见 manifest。这些文件未做主观听审，重新接入前需确认用途与音量。
