# CLAUDE.md

## 项目

DeepSeek Harness 插件的前端骨架：把线性 AI 对话变成节点画布。一次问答 = 一个节点，节点连线 = 上下文依赖。

- 交互方案：`docs/交互方案.md`
- 接口契约：`docs/api-contract.md`
- 前端入口：`index.html`（无构建步骤，双击即可运行）

## 技术栈

原生 HTML + CSS + JavaScript，无框架、无打包器、无依赖。脚本以经典 `<script>` 顺序加载，模块挂在 `window.App` 上。

**不要引入 npm、React、Vue、TypeScript、构建工具或任何第三方运行时依赖**，除非用户明确要求。

## 目录

```
index.js        Host：路由 + SSE 接口（/canvas/ 与 /canvas/api/*）
turn.js         Host：一次性 Agent 桥（真实模型，流式）
client.js       Client：lazy-CJS 工厂，注入会话头部「画布」按钮
cordis.patch.yml  bundle 补丁层（插件行 + provider/model/timeout）
locale/*.json   插件显示元数据（en/zh）
icon.svg        插件图标
index.html      前端入口（无构建步骤，双击即可运行）
src/state.js    数据、撤销栈、localStorage、上下文组装
src/canvas.js   视图变换、节点渲染、平移缩放、拖动、连线、右键删除
src/sidebar.js  对话列表与两个新建按钮
src/panel.js    右栏三态、流式渲染、回答编辑
src/api.js      唯一后端接入层（CONFIG.MOCK 开关）
src/mock.js     本地模拟流式回答
src/main.js     装配、全局键位、确认弹窗、Toast
```

## 你的任务（后端）

1. 按 `docs/api-contract.md` 实现服务端。
2. 如需前端联调：把 `src/api.js` 的 `CONFIG.MOCK` 改为 `false`，填写 `BASE_URL`。
3. 除 `src/api.js` 的请求函数外，**不要修改前端结构**。

## 必须遵守

- 不要引入 PRD 与契约之外的第三方依赖；需要时先说明理由并等待确认。
- 不要修改三栏比例（2:4:3）、键位映射、节点数据结构字段名。
- 不要在前端硬编码密钥；`BASE_URL` 通过 `CONFIG` 配置。
- 不要把 SSE 改成 `EventSource`：本接口是 POST，必须用 `fetch` + `ReadableStream`。
- 关键写入接口（创建回合）必须支持 `Idempotency-Key`。
- 日志不得输出完整对话正文、密钥、用户标识。
- 上下文组装规则在前后端必须一致：全部上游祖先 + 拓扑序 + `answerEdited ?? answerRaw` + 空回答跳过。
- 删除节点必须级联删除相连的边；删除对话必须级联删除节点与边。
- 数据库变更走迁移文件，不要手改线上表结构。
- `ctx.webServer.register({ kind: 'prefix', path })` 的 `path` 不能带尾斜杠：宿主的匹配是 `pathname === prefix || pathname.startsWith(prefix + '/')`，写成 `/canvas/` 会匹配不到任何子路径。

## 前端约定（避免踩坑）

- 节点位置是世界坐标；节点用 `transform: translate()` 定位，不要改成 `left/top`（会破坏连线计算）。
- 节点宽 320、高 92、端口纵向偏移 46，`canvas.js` 顶部的常量是唯一来源。
- 任何会重建 DOM 的渲染都会丢失输入焦点：标题输入请走 `App.canvas.syncTitle` / `App.panel.syncTitle`，不要用全量重渲染同步标题。
- 撤销快照在 `App.store.snapshot()`，只在真正变更前调用，避免一次点击塞进多条历史。

## 验收

- 双击 `index.html`，`file://` 下能完整跑通：新建对话、新建标签、拖动、连线、右键删除、右栏提问、流式回答、编辑回答、刷新后数据仍在。
- 断网状态下 mock 仍可用（`MOCK=true`）。

---

内容由 AI 生成