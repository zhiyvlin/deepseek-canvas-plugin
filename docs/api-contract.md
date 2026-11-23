# 后端接口契约 v0.1

供 Claude Code 实现后端时使用。前端已经按此契约封装在 `src/api.js`，切换 `CONFIG.MOCK = false` 并填 `BASE_URL` 即可对接。

## 0. 约定

- 所有接口返回 JSON，统一包：

```json
{ "ok": true, "data": {} }
```

```json
{ "ok": false, "error": { "code": "NODE_NOT_FOUND", "message": "节点不存在" } }
```

- 认证：`Authorization: Bearer <token>`，V1 可先留空。
- 时间统一 ISO 8601 字符串。
- ID 为字符串，服务端生成。
- 幂等：`POST /turns` 需支持 `Idempotency-Key` 头，避免重复扣费与重复落库。

## 1. 数据模型

```ts
interface Canvas {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  viewport: { x: number; y: number; scale: number };
  nodes: Node[];
  edges: Edge[];
}

interface Node {
  id: string;
  title: string;
  position: { x: number; y: number };
  status: "draft" | "streaming" | "done";
  turn: Turn | null;
  createdAt: string;
}

interface Turn {
  id: string;
  question: string;
  answerRaw: string;          // 模型原文，永不覆盖
  answerEdited: string | null; // 用户编辑后的文本
  editedAt: string | null;
  model?: string;
}

interface Edge {
  id: string;
  from: string; // 上游节点 id
  to: string;   // 下游节点 id
}
```

## 2. 端点

| 方法 | 路径 | 请求体 | 返回 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/canvases` | — | `Canvas[]`（不含 nodes/edges 的摘要亦可） | 对话列表 |
| POST | `/api/canvases` | `{ title?: string }` | `Canvas` | 新建对话 |
| PATCH | `/api/canvases/:id` | `{ title?, viewport? }` | `Canvas` | 改标题 / 视图 |
| DELETE | `/api/canvases/:id` | — | `{ deleted: true }` | 删除对话（级联） |
| GET | `/api/canvases/:id` | — | `Canvas` | 画布全量（含节点与边） |
| POST | `/api/canvases/:id/nodes` | `{ position: {x,y}, title?: string }` | `Node` | 新建标签 |
| PATCH | `/api/nodes/:id` | `{ title?, position?, status? }` | `Node` | 改标签 |
| DELETE | `/api/nodes/:id` | — | `{ deleted: true, removedEdges: string[] }` | 删标签并断边 |
| POST | `/api/canvases/:id/edges` | `{ from, to }` | `Edge` | 新建连线，成环返回 409 |
| DELETE | `/api/edges/:id` | — | `{ deleted: true }` | 删连线 |
| POST | `/api/nodes/:id/turns` | `{ question, context[] }` | `text/event-stream` | 提问并流式回答 |
| PATCH | `/api/turns/:id` | `{ answerEdited: string \| null }` | `Turn` | 保存编辑 |
| GET | `/api/nodes/:id/context` | — | `{ items: [{question, answer}] }` | 服务端回溯上下文（可选，用于审计） |

### 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | 参数缺失或格式错误 |
| `CANVAS_NOT_FOUND` | 404 | 对话不存在 |
| `NODE_NOT_FOUND` | 404 | 标签不存在 |
| `EDGE_CYCLE` | 409 | 连线会成环 |
| `EDGE_DUPLICATE` | 409 | 连线已存在 |
| `TURN_IN_PROGRESS` | 409 | 该标签已有生成中的回合 |
| `UPSTREAM_TIMEOUT` | 502 | 模型侧超时 |
| `RATE_LIMITED` | 429 | 触发限流 |

## 3. 流式接口（重点）

```
POST /api/nodes/:id/turns
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "question": "这里的缓存应该怎么设计？",
  "context": [
    { "nodeId": "nd_a", "question": "先讲讲整体架构", "answer": "……" }
  ]
}
```

响应 `200 text/event-stream`：

```
event: delta
data: {"text":"增量"}

event: done
data: {"turnId":"turn_x","answerRaw":"完整回答","model":"deepseek-chat"}

event: error
data: {"code":"UPSTREAM_TIMEOUT","message":"模型响应超时"}
```

约束：

- 每个事件以空行结尾（`\n\n`）。
- `delta` 必须是可拼接的纯文本增量，不要重复发送已发内容。
- `done` 必须带完整 `answerRaw`，服务端同时落库。
- 客户端断开（`AbortController`）时，服务端应中止上游请求，不要把半截回答写库；已产生 token 的费用按实际计。

**不要改成 EventSource**：EventSource 只支持 GET、不能带请求体和自定义头。前端用 `fetch` + `ReadableStream` 解析 SSE，见 `src/api.js` 的 `askReal`。

## 4. 上下文组装

V1 由前端组装后随请求发送（`context` 字段），后端只做校验、限流、转发、落库。

规则：

1. 取目标节点的全部上游祖先（沿 `edges.from → edges.to` 反向可达）。
2. 按拓扑序排列，同层按 `position.y` 再 `position.x` 排序。
3. 每条历史用 `answerEdited ?? answerRaw`。
4. 回答为空的条目跳过。
5. 最后追加本轮 `question`。

后端如自行组装（`GET /context`），必须与上面规则一致，否则前后端行为会分裂。建议 V2 统一收归后端，并把组装结果写进请求日志。

## 5. 并发与限流（V1 建议）

- 单节点同时只允许一个进行中的回合，重复请求返回 409。
- 单用户并发流上限 3，超出排队或 429。
- SSE 心跳：每 15 秒发送 `: ping\n\n` 注释行，避免中间层断连。

## 6. 落库建议

- `canvas`、`node`、`edge`、`turn` 四张表，`edge` 加 `(from,to)` 唯一索引。
- 删除节点用硬删 + 级联删边；如需审计改为软删（`deleted_at`），但查询侧必须过滤。
- `turn.answer_raw` 与 `answer_edited` 分列存储，编辑不覆盖原文。

---

内容由 AI 生成