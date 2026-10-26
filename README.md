# DSH 聊天室插件（dsh-chatroom）

基于 DeepSeek Harness（DSH）的多房间即时通讯插件：在 DSH Web 界面侧边栏提供完整聊天室，支持文件/图片附件、个人头像与昵称，全部数据保存在本地。

## 功能特性

- 💬 **多房间聊天** — 创建房间、6 位邀请码加入、刷新邀请码、未读角标、已读回执
- 📎 **文件与图片附件** — 多选、粘贴、拖拽上传；图片缩略图预览与灯箱；普通文件下载；上传进度与失败重试；支持纯附件消息（单文件 ≤ 20 MB，每条消息 ≤ 10 个）
- 👤 **个人设置** — 修改全局昵称与头像（PNG/JPEG/WebP/GIF ≤ 5 MB），对所有房间即时生效并实时广播
- 🔐 **安全** — 使用 DSH 登录账号身份（不可伪造）；图片按字节识别真实格式；WebSocket 一次性票据认证；附件仅成员可读、未发送附件仅上传者可删
- 💾 **本地存储** — SQLite（better-sqlite3）+ 本地文件目录，含旧库自动迁移

## 安装

本插件以 DSH **bundle** 方式挂载到 Web profile：

1. 将本仓库克隆/链接到 DSH 可访问的目录，安装依赖：

   ```bash
   npm install
   ```

2. 让 DSH 启动时叠加 `cordis.patch.yml`（其中声明了把 Chatroom 插入 Web profile 配置树），并按 DSH 的 profile 链接机制把本包链接进 `profiles/web`。

3. 启动（或重载）DSH 宿主，侧边栏出现 **Chatroom** 入口即可使用。

> 依赖 `better-sqlite3`（原生模块）：Windows 下若安装失败，需先装好 Node 对应的 C++ 构建工具，或使用与宿主一致的预编译版本。

## 开发

运行时代码是手维护的两份文件，直接编辑即可（DSH 支持热重载）：

| 文件 | 说明 |
|---|---|
| `lib/index.js` | Node 端：房间/消息/附件/资料 API、SQLite、WebSocket 服务 |
| `lib/client.js` | Web 端：React 面板（房间列表、聊天、成员、邀请、个人设置） |

```bash
npm run build   # 语法检查（不产物）
npm test        # 35 项回归：附件 17 + 前端 5 + 迁移 3 + 个人资料 10
```

测试全部使用临时目录与模拟 DSH 上下文，不触碰真实聊天数据；前端测试需要宿主 profile 里的 React 18（可用 `DSH_PLUGIN_HOST_ROOT` 环境变量指定宿主根目录）。

## 许可证

[MIT](LICENSE)
