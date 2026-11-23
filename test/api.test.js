// 画布接入层的端到端测试：假 agents 服务 + 真 HTTP，验证 SSE 帧、单飞、错误兜底。
// 不需要真实模型，也不会消耗 token。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { apply } from '../index.js'
import { buildPrompt } from '../turn.js'

/** 造一个会按脚本吐帧的假 Agent。hold=true 时永不结束，用于并发场景。 */
function fakeAgents(script, { failCreate = false, hold = false } = {}) {
  const state = { created: [], disposed: 0 }
  state.create = async options => {
      if (failCreate) throw new Error('provider missing')
      const listeners = new Map()
      const prompts = []
      let settle
      const idle = new Promise(resolve => { settle = resolve })
      const emit = (name, payload) => {
        for (const callback of listeners.get(name) ?? []) callback(payload)
      }
      const agent = {
        ctx: {
          on(name, callback) {
            const list = listeners.get(name) ?? []
            list.push(callback)
            listeners.set(name, list)
            return () => {
              listeners.set(name, (listeners.get(name) ?? []).filter(fn => fn !== callback))
            }
          },
        },
        followup(message) {
          prompts.push(message)
          queueMicrotask(() => {
            if (hold) return
            try {
              script({ emit, agent })
            } finally {
              settle()
            }
          })
        },
        whenIdle: () => idle,
        cancel() {},
        session: { snapshotEvents: () => [] },
      }
      state.created.push({ options })
      return { agent, dispose: async () => { state.disposed += 1 } }
  }
  return state
}

async function withServer(agents, run) {
  const routes = []
  const ctx = {
    agents,
    logger: { error: () => {}, warn: () => {} },
    effect: factory => factory(),
    webServer: { register: spec => { routes.push(spec); return () => {} } },
  }
  apply(ctx, { provider: 'test-provider', model: 'test-model', timeoutMs: 5_000 })
  const handler = (request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname
    const exact = routes.find(route => route.kind === 'exact' && route.path === path)
    // 复刻宿主 webServer 的前缀匹配规则：
    //   pathname === prefix || pathname.startsWith(prefix + '/')
    // 否则带尾斜杠的前缀（如 '/canvas/'）永远匹配不到子路径，会漏掉回归。
    const prefix = routes.find(route =>
      route.kind === 'prefix' && (path === route.path || path.startsWith(route.path + '/')))
    const chosen = exact ?? prefix
    if (chosen === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    return chosen.handler(request, response)
  }
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await run({ base: `http://127.0.0.1:${server.address().port}` })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

const post = (base, nodeId, body) => fetch(`${base}/canvas/api/nodes/${nodeId}/turns`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('buildPrompt：带上游按序拼接，空回答跳过，无上游时给出起点说明', () => {
  const prompt = buildPrompt('第三步怎么理解？', [
    { nodeId: 'a', question: '大纲', answer: '五步大纲' },
    { nodeId: 'b', question: '空的', answer: '   ' },
    { nodeId: 'c', question: '细节', answer: '细节内容' },
  ])
  assert.ok(prompt.includes('【画布上下文】'))
  assert.ok(prompt.indexOf('五步大纲') < prompt.indexOf('细节内容'), '顺序必须跟着上游顺序')
  assert.ok(!prompt.includes('空的'))
  assert.ok(prompt.includes('【本次问题】\n第三步怎么理解？'))
  assert.ok(buildPrompt('起点', []).includes('这是一个起点节点'))
})

test('buildPrompt：超长上游被截断，条目数量有上限', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ nodeId: `n${index}`, question: `q${index}`, answer: 'x'.repeat(20_000) }))
  const prompt = buildPrompt('问题', many)
  assert.ok(prompt.includes('上游内容过长，已截断'))
  assert.ok(!prompt.includes('q25'), '超过 20 条的应被丢掉')
})

test('POST /turns：把 text-delta 转成 SSE delta，收尾发 done 并销毁 Agent', async () => {
  const agents = fakeAgents(({ emit }) => {
    emit('agent/assistant-stream', { frame: { type: 'start', attemptId: 'a1' } })
    emit('agent/assistant-stream', { frame: { type: 'chunk', chunk: { type: 'text-delta', text: '把调用画成' } } })
    emit('agent/assistant-stream', { frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: '不该出现' } } })
    emit('agent/assistant-stream', { frame: { type: 'chunk', chunk: { type: 'text-delta', text: '一棵树' } } })
    emit('agent/assistant-stream', { frame: { type: 'end', attemptId: 'a1' } })
  })
  await withServer(agents, async ({ base }) => {
    const response = await post(base, 'nd_1', { question: '怎么理解展开？', context: [{ nodeId: 'a', question: '大纲', answer: '五步' }] })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/event-stream/)
    const body = await response.text()

    const deltas = [...body.matchAll(/event: delta\ndata: (\{.*\})/g)].map(match => JSON.parse(match[1]).text)
    assert.deepEqual(deltas, ['把调用画成', '一棵树'], '只转发 text-delta，推理增量不混进来')

    const done = JSON.parse(/event: done\ndata: (\{.*\})/.exec(body)[1])
    assert.equal(done.answerRaw, '把调用画成一棵树')
    assert.equal(done.model, 'test-model')
    assert.ok(done.turnId.startsWith('turn-'))
    assert.equal(agents.created.length, 1, '每轮创建且只创建一个 Agent')
    assert.equal(agents.disposed, 1, 'Agent 必须被销毁')
  })
})

test('POST /turns：同一节点并发第二轮返回 409', async () => {
  const agents = fakeAgents(() => { /* 永不结束 */ }, { hold: true })
  await withServer(agents, async ({ base }) => {
    const first = post(base, 'nd_same', { question: '第一轮' })
    await new Promise(resolve => setTimeout(resolve, 60))
    const second = await post(base, 'nd_same', { question: '第二轮' })
    assert.equal(second.status, 409)
    const payload = await second.json()
    assert.equal(payload.error.code, 'TURN_IN_PROGRESS')
    void first.catch(() => {})
  })
})

test('POST /turns：空问题 400，建 Agent 失败走 SSE error', async () => {
  await withServer(fakeAgents(() => {}), async ({ base }) => {
    const empty = await post(base, 'nd_x', { question: '   ' })
    assert.equal(empty.status, 400)
    assert.equal((await empty.json()).error.code, 'VALIDATION_FAILED')
  })
  await withServer(fakeAgents(() => {}, { failCreate: true }), async ({ base }) => {
    const response = await post(base, 'nd_y', { question: '你好' })
    assert.equal(response.status, 200, 'SSE 已经在流里，错误用事件通知')
    const body = await response.text()
    assert.match(body, /event: error/)
    assert.equal(JSON.parse(/event: error\ndata: (\{.*\})/.exec(body)[1]).code, 'AGENT_CREATE_FAILED')
  })
})

test('静态资源仍然可达，且 /canvas 会重定向', async () => {
  await withServer(fakeAgents(() => {}), async ({ base }) => {
    const redirect = await fetch(`${base}/canvas`, { redirect: 'manual' })
    assert.equal(redirect.status, 302)
    const page = await fetch(`${base}/canvas/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /画布式对话/)
    assert.equal((await fetch(`${base}/canvas/api/nope`)).status, 404)
  })
})
