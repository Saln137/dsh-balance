/**
 * 控件级检查：在运行中的页面上量出余额胶囊的实际盒模型，并截「底部一行」的放大图。
 *
 * 用法: node scripts/verify/inspect-widget.mjs "<authenticated url>" <outPrefix>
 * 前提: 同 screenshot.mjs —— 已有一个开着 CDP 端口的 Chrome。
 */
import { writeFileSync } from 'node:fs'

const [url, outPrefix] = process.argv.slice(2)
const port = Number(process.env.CDP_PORT ?? 9222)

for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break
  } catch {
    /* 还没起来 */
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
}

const target = await (
  await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
).json()
const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
const events = new Map()
let nextId = 1

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id !== undefined) {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
    return
  }
  const queue = events.get(message.method)
  if (queue?.length > 0) queue.shift()(message.params)
})

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const once = (method) =>
  new Promise((resolve) => {
    const queue = events.get(method) ?? []
    queue.push(resolve)
    events.set(method, queue)
  })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true })
  return result.result?.value ?? null
}
const shot = async (file, clip) => {
  const image = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })
  writeFileSync(file, Buffer.from(image.data, 'base64'))
  console.log(`screenshot: ${file}`)
}

await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
const loaded = once('Page.loadEventFired')
await send('Page.navigate', { url })
await Promise.race([loaded, sleep(15_000)])
await sleep(7_000)

// 关掉可能的引导弹窗（遮罩会挡住截图）。
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '继续')?.click()`)
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '稍后配置')?.click()`)
await sleep(500)

for (let attempt = 0; attempt < 60; attempt += 1) {
  const ready = await evaluate(`(() => {
    const value = document.querySelector('.dshb-value')
    return !!(value && value.textContent && value.textContent.trim())
  })()`)
  if (ready) break
  await sleep(500)
}

console.log(
  `geometry: ${await evaluate(`(() => {
    const pick = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        x: Math.round(rect.x), y: Math.round(rect.y),
        w: Math.round(rect.width), h: Math.round(rect.height),
        cy: Math.round(rect.y + rect.height / 2),
        text: (element.textContent || '').trim().slice(0, 24),
      }
    }
    return JSON.stringify({
      trigger: pick('.dshb-trigger'),
      icon: pick('.dshb-icon'),
      label: pick('.dshb-label'),
      value: pick('.dshb-value'),
      sub: pick('.dshb-sub'),
      low: !!document.querySelector('.dshb-low'),
      valueFont: getComputedStyle(document.querySelector('.dshb-value')).fontSize,
    }, null, 2)
  })()`)}`,
)

await shot(`${outPrefix}-footer.png`, { x: 0, y: 750, width: 300, height: 150, scale: 3 })

// 扫光是动画：截图前把所有动画暂停在同一相位，否则会截到「光带在行外」的瞬间。
const frozen = await evaluate(`(() => {
  const animations = document.getAnimations()
  animations.forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.()
    const duration = typeof timing?.duration === 'number' ? timing.duration : 2000
    animation.pause()
    animation.currentTime = duration * 0.42
  })
  return animations.length
})()`)
console.log(`frozen animations: ${frozen}`)

await shot(`${outPrefix}-sheen.png`, { x: 0, y: 750, width: 300, height: 150, scale: 3 })
await evaluate(`document.querySelector('.dshb-trigger')?.click()`)
await sleep(900)
await shot(`${outPrefix}-popover.png`, { x: 0, y: 470, width: 320, height: 380, scale: 3 })
console.log(`popover: ${await evaluate(`document.querySelector('.dshb-pop')?.innerText ?? 'missing'`)}`)

// 减少动态偏好下不应再有扫光动画。
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await sleep(300)
console.log(
  `reduced-motion animations: ${await evaluate(`document.getAnimations().filter((a) => a.animationName?.startsWith('dshb-sheen')).length`)}`,
)

socket.close()
process.exit(0)
