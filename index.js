// 画布式对话 · Host 侧
//
// 只做一件事：把插件目录里的静态前端（index.html + src/）挂到 DSH 现有的
// Web Server 上，路径 /canvas/。
//
// 刻意不做的事：
//   · 不注入 Client 插件，不往界面里塞按钮或浮层——它就是一个普通整页；
//   · 不代理模型请求，前端此刻是 MOCK 模式，回答由 src/mock.js 本地模拟；
//   · 不改前端任何文件，前后端接口契约见 docs/api-contract.md（尚未实现）。
//
// 这样即使这份前端有 bug，最坏情况也只是这一页白屏，关掉标签页即可，
// 不会像全屏浮层那样把人锁在应用里。

import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TurnStream, runTurn } from './turn.js'

export const name = 'canvas'
export const inject = ['webServer', 'agents']

const MAX_BODY_BYTES = 512 * 1024
const DEFAULT_PROVIDER = 'deepseek-account'
const DEFAULT_MODEL = 'deepseek-flash'
const TURN_PATH = /^\/canvas\/api\/nodes\/([\w.-]+)\/turns$/

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.woff2', 'font/woff2'],
])

export function apply(ctx, config) {
  // 默认静态根 = 本文件所在目录；config.root 可指向别处（比如把前端单独部署）。
  const root = resolve(
    typeof config?.root === 'string' && config.root !== ''
      ? config.root
      : fileURLToPath(new URL('.', import.meta.url)),
  )
  const trustedHosts = new Set([
    'localhost',
    '127.0.0.1',
    ...[...(config?.trustedHosts ?? [])].map(host => String(host).trim().toLowerCase()).filter(Boolean),
  ])

  const provider = typeof config?.provider === 'string' && config.provider !== '' ? config.provider : DEFAULT_PROVIDER
  const model = typeof config?.model === 'string' && config.model !== '' ? config.model : DEFAULT_MODEL
  const timeoutMs = Number.isFinite(config?.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : undefined
  // 单节点同时只允许一轮：前端重复点发送时直接拒，避免双倍扣费。
  const inFlight = new Set()

  const readJsonBody = async request => {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
      chunks.push(chunk)
    }
    if (size === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  const handleApi = async (request, response, pathname) => {
    const turn = TURN_PATH.exec(pathname)
    if (turn === null) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } }))
      return
    }
    const nodeId = turn[1]
    if (request.method !== 'POST') {
      response.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'POST' })
      response.end(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 POST' } }))
      return
    }

    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: { code: 'VALIDATION_FAILED', message: `请求体不合法：${error instanceof Error ? error.message : String(error)}` } }))
      return
    }

    const question = typeof body?.question === 'string' ? body.question.trim() : ''
    if (question === '') {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'question 不能为空' } }))
      return
    }
    if (inFlight.has(nodeId)) {
      response.writeHead(409, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, error: { code: 'TURN_IN_PROGRESS', message: '这个标签还在生成中，请等它结束' } }))
      return
    }

    inFlight.add(nodeId)
    const stream = new TurnStream(response, { nodeId, timeoutMs: timeoutMs ?? undefined })
    try {
      await runTurn(ctx, {
        nodeId,
        question,
        context: body?.context,
        stream,
        provider,
        model,
      })
    } finally {
      inFlight.delete(nodeId)
    }
  }

  const serve = async (request, response) => {
    const hostname = (typeof request.headers.host === 'string' ? request.headers.host : '')
      .replace(/:\d+$/, '')
      .toLowerCase()
    if (!trustedHosts.has(hostname)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('不被信任的 Host')
      return
    }

    let pathname
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://canvas.local').pathname)
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('路径编码不合法')
      return
    }

    // 接口与静态资源共用同一个前缀：先判定 /canvas/api，避免被静态处理器抢走。
    if (pathname === '/canvas/api' || pathname.startsWith('/canvas/api/')) {
      await handleApi(request, response, pathname)
      return
    }

    const relative = pathname.replace(/^\/canvas\/?/, '')
    const requested = relative === '' ? 'index.html' : relative
    const target = resolve(root, requested)

    // 目录穿越防线：必须真的落在 root 里面。
    if (target !== root && !target.startsWith(root + sep)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('越界访问')
      return
    }
    // 点文件（.env / .git 之类）不对外。
    if (requested.split(/[\\/]/).some(segment => segment.startsWith('.'))) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('未找到')
      return
    }

    let file = target
    const info = await stat(file).catch(() => null)
    if (info === null) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(`未找到：${requested}`)
      return
    }
    if (info.isDirectory()) {
      file = resolve(file, 'index.html')
      const nested = await stat(file).catch(() => null)
      if (nested === null || !nested.isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('未找到 index.html')
        return
      }
    }

    const contentType = MIME.get(extname(file).toLowerCase()) ?? 'application/octet-stream'
    try {
      const body = await readFile(file)
      response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' })
      response.end(body)
    } catch (error) {
      ctx.logger.error(error instanceof Error ? error : new Error(String(error)))
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('读取文件失败')
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/canvas',
    handler: (_request, response) => {
      response.writeHead(302, { location: '/canvas/' })
      response.end()
    },
  }), 'canvas: redirect')

  // 注意：前缀路由的 path 不能带尾斜杠。宿主的匹配规则是
  //   pathname === prefix || pathname.startsWith(prefix + '/')
  // 若写成 '/canvas/'，则 '/canvas/api/...' 会命中 prefix + '/' = '/canvas//'，
  // 永远匹配不到任何子路径。这里必须用 '/canvas'。
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/canvas',
    handler: serve,
  }), 'canvas: static')
}
