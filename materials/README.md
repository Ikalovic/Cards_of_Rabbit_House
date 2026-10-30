# 制作素材与参考原件

本目录位于 `game/` 之外，不参与 Vite 或 Docker 游戏构建。游戏实际使用的文件位于 `game/public/assets/`，运行时不读取这里。

| 当前位置 | 原位置 | 内容 |
| --- | --- | --- |
| [audio/bgm/](audio/bgm/) | 根目录 `bgm/` | 用户提供的 14 首原作音乐，保留 OGG / MP3 原件 |
| [audio/sfx/](audio/sfx/README.md) | 根目录 `audio-sources/` | 35 个原始 MP3、下载记录与署名 |
| [audio/candidates/](audio/candidates/README.md) | `game/public/assets/audio/` 的未启用条目 | 备选 BGM、转场曲及音效，保留处理记录 |
| [characters/references/](characters/references/) | 根目录 `人物参考图/` | 人物参考图片原件 |
| [characters/角色资料.md](characters/角色资料.md) | 根目录 `角色资料.md` | 角色设定与性格参考 |
| [math/数学题库_分类整理版.json](math/数学题库_分类整理版.json) | 根目录同名 JSON | 用户提供的题库原件 |

题库的服务端副本在 `game/server/数学题库_分类整理版.json`，只由服务器读取；题图仍在 `game/public/assets/math/questions/`。调整题库时需同步服务端副本；不要把原件目录或带答案的 JSON 作为浏览器读取路径。

未启用素材若要重新接入，先复制到游戏静态目录并登记内容清单，再为它增加实际使用位置。原始素材和参考图不作为独立素材包发布。
