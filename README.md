# Cards_of_Rabbit_House

《请问您今天要来点兔子吗？》同人手作经营小游戏。接待熟悉的角色，读单、备料、组装卡片、完成手工和冲印，再亲手交付。支持剧情经营、生存天梯与自由工坊。

保留角色剧情、背景音乐与音效、StampBook 收藏、草稿续作，以及由 Node.js 提供的会话、存档、小游戏判题和冲印服务。

## 启动

在仓库根目录运行：

```bash
docker compose up --build -d game
```

打开 <http://localhost:8080>。修改代码后重新执行上述命令更新镜像；停止服务使用 `docker compose down`。可复制 `.env.example` 为 `.env` 调整端口。

本地开发需要 Node.js 24：

```bash
cd game
npm ci
npm run dev
```

打开 <http://localhost:5173>。生产构建使用 `npm run build`，随后 `npm start`，默认监听 8080 端口。

## 存档

每个浏览器会话独立保存剧情进度、班次、作品和冲印记录。存档位于服务端内存，刷新页面可以恢复，**重启服务会清空存档**；当前没有账号或跨设备同步。音乐与音效偏好保存在本机浏览器。

## 项目内容

- `game/`：React、TypeScript、Vite 前端与 Node.js 服务端，详细玩法和开发说明见 [game/README.md](game/README.md)。
- `materials/`：角色参考图、原始音乐和音效素材。
- `docs/bgm.md`：音频设计记录。
- `tools/`：离线美术辅助工具。
- `archive/`：旧页面与未启用美术，不参与构建。

游戏面向桌面浏览器，建议窗口至少为 1280 × 720。角色与音频来源分别见 [素材说明](game/public/assets/ASSET_NOTES.md) 和 [音频署名](game/public/assets/audio/SOURCES.md)。
