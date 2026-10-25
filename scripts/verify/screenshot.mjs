/**
 * 用 Chrome DevTools Protocol 给运行中的实例截图。
 *
 * 为什么不用 `chrome --screenshot`：这个页面 boot 后会保持一条 SSE 长连接，
 * 一次性 headless 截图会一直等网络静默而挂住。走 CDP 可以自己控制
 * 「load 之后再多等几秒」的时机，然后主动截屏。
 *
 * 前提：另一个终端里跑着一个开了调试端口的 Chrome/Edge，例如
 *   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<临时目录> about:blank
 *
 * 用法: node scripts/verify/screenshot.mjs "<url>" <out.png> [waitMs] [width] [height]
 */
import { writeFileSync } from 'node:fs'

const [url, outFile, waitArg, widthArg, heightArg] = process.argv.slice(2)
if (!url || !outFile) {
  console.error('用法: node scripts/verify/screenshot.mjs "<url>" <out.png> [waitMs] [width] [height]')
  process.exit(2)
}
const waitMs = Number(waitArg ?? 6_000)
const width = Number(widthArg ?? 1_440)
const height = Number(heightArg ?? 900)

/** 等 DevTools 端口就绪。 */
async function waitForDevtools(port, timeoutMs = 20_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('DevTools 端口未就绪')
}

/**
 * 打开一个 CDP 会话。
 * @param {string} wsUrl - target 的调试地址。
 */
function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  const pending = new Map()
  const listeners = new Map()
  let nextId = 1

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      if (entry) {
        pending.delete(message.id)
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
        else entry.resolve(message.result)
      }
      return
    }
    const queue = listeners.get(message.method)
    if (queue && queue.length > 0) queue.shift()(message.params)
  })

  return {
    on(method) {
      return new Promise((resolve) => {
        const queue = listeners.get(method) ?? []
        queue.push(resolve)
        listeners.set(method, queue)
      })
    },
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    ready() {
      return new Promise((resolve, reject) => {
        socket.addEventListener('open', () => resolve(undefined), { once: true })
        socket.addEventListener('error', (event) => reject(new Error(`WebSocket 失败: ${event.message ?? ''}`)), {
          once: true,
        })
      })
    },
    close() {
      socket.close()
    },
  }
}

const port = Number(process.env.CDP_PORT ?? 9222)
await waitForDevtools(port)

const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, {
  method: 'PUT',
})
const target = await targetResponse.json()
const client = connect(target.webSocketDebuggerUrl)
await client.ready()
await client.send('Page.enable')
await client.send('Runtime.enable')
await client.send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
})

const loaded = client.on('Page.loadEventFired')
await client.send('Page.navigate', { url })
await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 15_000))])

// load 之后插件才真正装配（客户端模块按需拉取 + 首次余额请求），多等一会儿再截。
await new Promise((resolve) => setTimeout(resolve, waitMs))

const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
writeFileSync(outFile, Buffer.from(shot.data, 'base64'))

// 顺手把页面里的诊断信息带出来：组件是否挂载、余额文本是什么。
const probe = await client.send('Runtime.evaluate', {
  expression: `JSON.stringify({
    sidebar: !!document.querySelector('.dshb-root'),
    rail: !!document.querySelector('.dshb-rail'),
    value: (document.querySelector('.dshb-value') || {}).textContent || null,
    triggerLabel: (document.querySelector('.dshb-trigger') || {}).getAttribute?.('aria-label') || null,
    dot: (document.querySelector('.dshb-dot') || {}).className || null
  })`,
  returnByValue: true,
})
console.log(`screenshot: ${outFile}`)
console.log(`probe: ${probe.result?.value ?? 'null'}`)

client.close()
process.exit(0)
