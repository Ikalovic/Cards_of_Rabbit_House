# 智乃头顶提比的短耳修正

2026-10-16，使用内置 image_gen 对现有立绘做局部修图。原图作为编辑目标，`references/提比.png` 只作为提比耳朵形状的参考。

输出覆盖游戏原有的五张 PNG，继续使用原文件名和 1024 × 1536 RGBA 格式：

- `game/public/assets/v2/characters/chino.png`
- `game/public/assets/v2/characters/chino-calm.png`
- `game/public/assets/v2/characters/chino-deadpan.png`
- `game/public/assets/v2/characters/chino-shy.png`
- `game/public/assets/v2/characters/chino-smile.png`

五张图的共同提示要求：仅把智乃头顶提比的长立耳改成小而宽、尖端圆润的短三角耳，粉色内耳较小，白色绒毛包边，耳尖露出高度约为提比毛球身体高度的 10–15%。保留提比的圆身体、五官、爪子、位置与大小；保留智乃的原表情、眼睛、发型、服装、姿势、手势、裙摆、腿鞋、配色、线条、光影、完整人物构图和画布尺寸；保留透明背景，不增加文字、水印或背景。

基础图保留原有轻微微笑；四张表情图分别强调保留 calm、deadpan、shy、smile 的原始表情和手势。每张图独立使用其自身原图编辑，避免用同一基础表情覆盖其他表情。

合照 `cocoa-chino-tippy-api.png` 和提比贴纸本来就是短耳，继续沿用。开发生成脚本已加入短耳约束。替换前的立绘可从 Git 历史恢复，游戏目录中不额外保存备份。
