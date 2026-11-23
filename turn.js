// 画布 → 真实模型的桥。
//
// 做法：每一轮问答都新建一个一次性 Agent（独占 session），把「上游上下文 + 本轮问题」
// 作为一条 user 消息交给它，订阅 agent 作用域的 assistant-stream 帧取增量文本，
// 答完即 dispose。这样画布节点的上下文完全由前端发来的 context 决定，
// 不会和用户在 DSH 里已有的会话互相污染。
//
// 依据的宿主接口（从 SDK 反推，未在真机验证前请当作假设）：
//   ctx.agents.create({ sessionId, agentOptions: { provider, model } }) → AgentHandle
//   handle.agent.followup(message) / whenIdle() / cancel(cause)
//   handle.agent.ctx.on('agent/assistant-stream', ({ frame }) => …)
//   handle.dispose()

import { randomUUID } from 'node:crypto'

const MAX_ANSWER_CHARS = 8_000
const MAX_CONTEXT_ITEMS = 20
const DEFAULT_TIMEOUT_MS = 300_000

/** 一轮画布提问的 SS​E 会话。 */
export class TurnStream {
  constructor(response, { nodeId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.response = response
    this.nodeId = nodeId
    this.closed = false
    this.finished = false
    this.answer = ''
    this.heartbeat = null
    this.timeoutMs = timeoutMs
    this.abort = undefined

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // 反向代理（如果有人挂在前面）不能缓冲，否则流式会变成一次性返回。
      'x-accel-buffering': 'no',
    })
    response.flushHeaders?.()
    // SSE 注释行心跳，防止中间层 60s 空闲断连。
    this.heartbeat = setInterval(() => this.writeRaw(': ping\n\n'), 15_000)
    this.heartbeat.unref?.()
  }

  writeRaw(chunk) {
    if (this.closed || this.finished) return
    try {
      this.response.write(chunk)
    } catch {
      this.closed = true
    }
  }

  /**
   * 写一帧 SSE。
   * 注意：这里只受 `closed` 约束，**不受 `finished` 约束**——done/error 这两个终态帧
   * 正是在 finished 即将置位的瞬间写出的，如果沿用 writeRaw 就会被自己拦掉。
   */
  event(name, data) {
    if (this.closed) return
    try {
      this.response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch {
      this.closed = true
    }
  }

  delta(text) {
    if (typeof text !== 'string' || text === '') return
    this.answer += text
    this.event('delta', { text })
  }

  finish(payload) {
    if (this.finished) return
    this.event('done', payload)
    this.finished = true
    this.cleanup()
    this.response.end()
  }

  fail(code, message) {
    if (this.finished) return
    this.event('error', { code, message })
    this.finished = true
    this.cleanup()
    this.response.end()
  }

  cleanup() {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
  }

  /** 客户端断开（关标签页 / AbortController）。 */
  onClose(callback) {
    this.response.on('close', () => {
      if (this.finished) return
      this.closed = true
      this.cleanup()
      callback?.()
    })
  }
}

/** 把前端发来的上游历史 + 本轮问题拼成一条消息。 */
export function buildPrompt(question, context) {
  const items = (Array.isArray(context) ? context : [])
    .filter(item => item !== null && typeof item === 'object')
    .filter(item => typeof item.answer === 'string' && item.answer.trim() !== '')
    .slice(0, MAX_CONTEXT_ITEMS)

  const sections = items.map((item, index) => {
    const answer = item.answer.length > MAX_ANSWER_CHARS ? `${item.answer.slice(0, MAX_ANSWER_CHARS)}……（上游内容过长，已截断）` : item.answer
    return `── ${index + 1}｜问：${String(item.question ?? '').trim()}\n答：${answer.trim()}`
  })

  return [
    '【画布上下文】',
    '下面是你这次回答可用的全部上游内容，按依赖顺序排列。',
    '未列出的历史不参与本次推理；不要假设你记得画布之外的内容。',
    '',
    ...(sections.length > 0 ? sections : ['（没有上游节点：这是一个起点节点）']),
    '',
    '【本次问题】',
    String(question ?? '').trim(),
    '',
    '（本轮只做回答：不要调用任何工具，不要读写文件，不要执行命令。）',
  ].join('\n')
}

/**
 * 跑一整轮：建 Agent → 提问 → 转发增量 → 收尾 → 销毁。
 * 任何一步失败都以 SSE `error` 帧告知前端，不抛出到 HTTP 层。
 */
export async function runTurn(ctx, { nodeId, question, context, stream, provider, model }) {
  const agents = ctx.agents
  if (agents === undefined || typeof agents.create !== 'function') {
    stream.fail('AGENTS_UNAVAILABLE', '宿主没有提供 agents 服务，无法调用模型')
    return
  }

  const sessionId = `canvas-${randomUUID()}`
  const prompt = buildPrompt(question, context)
  let handle
  let off = null
  let timer = null

  try {
    handle = await agents.create({
      sessionId,
      agentOptions: { provider, model },
    })
  } catch (error) {
    stream.fail('AGENT_CREATE_FAILED', `无法创建对话：${error instanceof Error ? error.message : String(error)}`)
    return
  }

  try {
    // 只订阅这个 agent 作用域的流：agent/* 事件带 scope carrier，
    // 订阅在这里才不会串到用户在 DSH 里自己的会话。
    const agentCtx = handle?.agent?.ctx
    if (agentCtx !== undefined && typeof agentCtx.on === 'function') {
      off = agentCtx.on('agent/assistant-stream', payload => {
        const frame = payload?.frame
        if (frame?.type !== 'chunk') return
        const chunk = frame.chunk
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') stream.delta(chunk.text)
      })
    }

    timer = setTimeout(() => {
      try {
        handle.agent?.cancel?.({ kind: 'hook', reason: 'canvas-timeout' })
      } catch { /* 已结束 */ }
      stream.fail('UPSTREAM_TIMEOUT', '模型响应超时，已中止本次生成')
    }, stream.timeoutMs)
    timer.unref?.()

    stream.onClose(() => {
      try {
        handle.agent?.cancel?.({ kind: 'hook', reason: 'canvas-client-closed' })
      } catch { /* 已结束 */ }
    })

    handle.agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    })

    await handle.agent.whenIdle()

    if (stream.finished) return
    let answer = stream.answer
    if (answer.trim() === '') {
      // 没有增量（例如模型直接返回了工具调用或空回答）时，从会话事件里捞最终文本。
      answer = finalAnswerText(handle?.agent?.session)
    }
    if (answer.trim() === '') {
      stream.fail('EMPTY_ANSWER', '模型没有返回任何文本')
      return
    }
    stream.finish({
      turnId: `turn-${randomUUID()}`,
      answerRaw: answer,
      model,
    })
  } catch (error) {
    ctx.logger?.error?.(error instanceof Error ? error : new Error(String(error)))
    stream.fail('TURN_FAILED', `生成失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (timer !== null) clearTimeout(timer)
    try {
      off?.()
    } catch { /* disposer 已失效 */ }
    try {
      await handle?.dispose?.()
    } catch (disposeError) {
      ctx.logger?.warn?.(disposeError instanceof Error ? disposeError : new Error(String(disposeError)))
    }
    stream.cleanup()
    void nodeId
  }
}

/** 从会话事件里取最后一条非空 assistant 文本。 */
function finalAnswerText(session) {
  try {
    const events = session?.snapshotEvents?.() ?? []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type !== 'assistant/message') continue
      const content = event.data?.message?.content
      if (!Array.isArray(content)) continue
      const text = content
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('')
      if (text.trim() !== '') return text
    }
  } catch { /* 会话不可读 */ }
  return ''
}
