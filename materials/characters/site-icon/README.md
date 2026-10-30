# 提比网站图标

2026-10-17，内置 `image_gen` 因网络错误未成功，随后使用项目所有者此前授权的生图 API（`gpt-image-2.5-sunburst`），通过 imagegen 技能随附 CLI 生成。配置仅从本机请求示例读取，不写入图片或发布文件。参考原作提比图及项目已有贴纸：

- `../references/提比.png`：角色身份、短耳及毛团轮廓参考。
- `../../../game/public/assets/v2/stickers/tippy.png`：现有游戏的颜色参考。

`tippy-source.png` 保存服务返回的 `1254 × 1254` RGBA 原图（提示词请求为 1024，服务返回实际尺寸为 1254）；发布版本只做等比缩放和格式转换，保留透明通道。下表路径均相对仓库根目录：

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `game/public/favicon.ico` | 16 / 32 / 48 / 64 | 浏览器网站图标 |
| `game/public/icons/tippy-32.png` | 32 × 32 | PNG 网站图标 |
| `game/public/icons/tippy-512.png` | 512 × 512 | 大尺寸图标 |
| `game/public/apple-touch-icon.png` | 180 × 180 | Apple 触屏图标 |

## 生成提示词

```text
Use case: logo-brand. Asset type: one square website favicon / app icon for the existing Rabbit House fan game, 1024 by 1024 pixels. Input image 1 is the identity and silhouette reference for Tippy (ティッピー) from Is the Order a Rabbit?, not an edit target. Input image 2 is supporting reference for the existing game's soft white and pale blue-gray coloring, not an edit target. Generate a NEW clean and highly legible icon featuring ONLY Tippy, facing straight forward. Faithfully keep the recognizable squat, almost circular, fluffy white ball silhouette, two TINY rounded triangular ears that barely protrude from the fluff (ear height only 10–12% of the body, NEVER long upright rabbit ears), small pink ear interiors, widely spaced dark round dot eyes and the tiny gentle rabbit nose and W-shaped mouth. The head/body is a single fluffy ball, no separate torso, paws, clothes or accessories. Use a soft warm-white body, subtle pale blue-gray shading only along the bottom, and a clean moderately thick dark cocoa-brown outline. Simplified polished Japanese anime mascot icon, nearly flat colors, large uncomplicated shapes, sparse rounded fur scallops rather than many fine hair strokes, readable at 16 and 32 pixels. Enlarge the simple eyes and mouth just enough to stay recognizable at favicon size while retaining Tippy's quiet expression. Center the complete silhouette inside a square with 6–8% transparent padding on all sides; do not crop the tiny ears or bottom. GENUINELY TRANSPARENT background, clean alpha edges, no colored square, no badge, no border frame, no drop shadow outside the silhouette. No text, no letters, no coffee cup, no other character, no watermarks. Return ONE finished icon, not a contact sheet or multiple alternatives.
```
