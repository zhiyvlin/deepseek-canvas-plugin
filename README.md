# DeepSeek Harness · 画布式对话

把一条线性 AI 对话拆成画布上的一串节点：一次问答 = 一个标签，标签之间的连线 = 上下文依赖。

这是一个标准的 DeepSeek Harness **bundle 插件**：Host 半边（`index.js` + `turn.js`）托管整页画布并把提问接到真实模型；Client 半边（`client.js`）在对话会话头部注入一个「画布」按钮，点一下就能进画布。

## 安装

前提：Node ≥ 22.19，已安装 `dsh` 与 `pnpm`。

```sh
npm install -g @deepseek-ai/dsh pnpm
# 把本目录装进 web 配置（首次会自动初始化 web profile）
dsh plugin --profile web add .
# 启动
dsh web
```

打开后，在对话会话头部会多出一个「画布」按钮，点击即在浏览器新标签页打开画布（等价于访问 `/canvas/`）。卸载：

```sh
dsh plugin --profile web remove deepseek-canvas-plugin
```

## 现在能做什么

- 左栏：新建对话（画布）、新建对话标签、切换/重命名/删除对话
- 画布：滚轮缩放（指针锚定）、中键或空格拖动平移、左键或 Ctrl+中键拖动节点、拖端口连线、成环拒绝、右键删除（带确认）
- 右栏：未选择 / 空白标签 / 生成中 / 已完成四态；流式回答；回答可编辑、可删除、可恢复原文
- 上下文：目标节点的全部上游祖先，按拓扑序拼接，使用编辑后的回答
- 会话头部：「画布」按钮一键进入画布

## 插件结构

| 文件 | 半边 | 作用 |
| --- | --- | --- |
| `index.js` | Host | 把静态前端挂到 `/canvas/`，并把 `/canvas/api/*` 接到真实模型 |
| `turn.js` | Host | 每轮问答新建一次性 Agent，流式转发增量，答完销毁 |
| `client.js` | Client | 客户端模块系统的 lazy-CJS 工厂：注入「画布」按钮 |
| `cordis.patch.yml` | 元数据 | bundle 的补丁层，声明插件行与模型/超时配置 |
| `locale/*.json` | 元数据 | 插件管理器里显示的标题与描述 |
| `src/` | 前端 | 画布前端（原生 HTML/CSS/JS，无构建步骤） |

### 接口

- 页面地址：`/canvas/`
- 接口：`POST /canvas/api/nodes/:id/turns`（SSE，`event: delta` / `done` / `error`）
- 每轮问答新建一个一次性 Agent，上下文完全来自前端发来的 `context`，答完即销毁
- 模型与超时在 `cordis.patch.yml` 里配置（默认 `deepseek-account` / `deepseek-flash` / 300s）

> 想回到纯本地模拟：把 `src/api.js` 的 `CONFIG.MOCK` 改回 `true` 即可（断网也能跑）。

接口契约见 `docs/api-contract.md`，交接约束见 `CLAUDE.md`。

## 键位

| 按键 | 作用 |
| --- | --- |
| Ctrl/⌘ + N | 新建对话 |
| Ctrl/⌘ + Shift + N | 新建对话标签 |
| Ctrl/⌘ + Z / Shift+Z | 撤销 / 重做 |
| Ctrl/⌘ + S | 导出当前画布 JSON |
| Tab / Shift+Tab | 三栏焦点循环 |
| 空格 + 拖动 / 中键拖动 | 平移画布 |
| 滚轮 | 缩放 |
| 方向键 | 按空间顺序在节点间移动选中 |
| Enter / F2 | 重命名选中节点 |
| Delete | 删除选中节点或连线 |
| 0 / 1 | 100% / 适配视图 |
| Esc | 退出编辑 → 取消选中 |
| 右栏 Enter | 发送 |
| 右栏 Ctrl+Enter | 保存回答编辑 |

## 开发

```sh
npm run build   # node --check 三份入口的语法
npm test        # node --test test/*.test.js
```

一个容易踩的坑：宿主的 Web 路由前缀匹配是 `pathname === prefix || pathname.startsWith(prefix + '/')`，所以 `ctx.webServer.register({ kind: 'prefix', path })` 的 `path` **不能带尾斜杠**——写成 `/canvas/` 会让 `/canvas/api/...` 命中 `prefix + '/'` = `/canvas//`，永远匹配不到子路径。

## 目录

```
index.js       Host：路由 + SSE 接口
turn.js        Host：一次性 Agent 桥
client.js      Client：会话头部「画布」按钮
cordis.patch.yml
locale/        插件显示元数据（en/zh）
icon.svg
index.html     前端入口
src/           画布前端
docs/          交互方案、接口契约
test/          端到端测试
```
## 致谢
本项目基于 dsh-synapse 重构，原项目以 MIT 许可证发布。