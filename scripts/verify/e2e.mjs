/**
 * 端到端验证：跑在一个真实的 DSH 进程上，检查四件事——
 * 1. 浏览器半侧是否被客户端模块系统发现（boot graph 里有 dsh-balance）；
 * 2. `/plugins/.../client.js` 是否可下载且内容正确；
 * 3. 宿主路由 `GET /dsh-balance/state` 是否返回模拟接口里的数字；
 * 4. `POST /dsh-balance/refresh` 是否真的去打了上游接口。
 *
 * 用法: node scripts/verify/e2e.mjs "<authenticated url>" <mock base url>
 * 前提: 已用临时 profile 启动实例，且实例的 baseUrl 指向 mock-balance.mjs。
 */
import assert from 'node:assert/strict'

const launchUrl = process.argv[2]
const mockBase = process.argv[3] ?? 'http://127.0.0.1:6398'
if (!launchUrl) {
  console.error('用法: node scripts/verify/e2e.mjs "<authenticated url>" [mockBase]')
  process.exit(2)
}

const base = new URL(launchUrl).origin

// 1) 用带令牌的启动 URL 换 Cookie（DSH 只在该 URL 上接受进程令牌）。
const login = await fetch(launchUrl, { redirect: 'manual' })
const cookies = login.headers.getSetCookie?.() ?? []
const cookie = cookies.map((value) => value.split(';')[0]).join('; ')
assert.ok(cookie.length > 0, '启动 URL 应下发会话 Cookie')
console.log(`✓ 用启动令牌换到会话 Cookie（HTTP ${login.status}）`)

// 2) 首页：客户端插件必须出现在 boot graph 里。
const indexResponse = await fetch(`${base}/`, { headers: { cookie } })
assert.equal(indexResponse.status, 200, '首页应返回 200')
const html = await indexResponse.text()
assert.ok(html.includes('dsh-balance'), 'boot graph 应包含 dsh-balance 客户端条目')
// 首页用 <base href="./">，combo 地址是文档相对路径（不带前导 /），且 HTML 里 & 被转义。
const bundleMatch = html.match(/(?:\.\/)?plugins\/\?\?[^"'\\\s]*dsh-balance\/client\.js[^"'\\\s]*/u)
assert.ok(bundleMatch !== null, '首页应包含 dsh-balance 的 /plugins 资源地址')
const bundleUrl = new URL(bundleMatch[0].replaceAll('&amp;', '&'), `${base}/`).href
console.log(`✓ 客户端条目已被发现：${bundleMatch[0].slice(0, 96)}…`)

// 3) 客户端产物：可下载、是普通脚本、登记了自己的 id。
const bundleResponse = await fetch(bundleUrl, { headers: { cookie } })
assert.equal(bundleResponse.status, 200, '客户端产物应返回 200')
const bundle = await bundleResponse.text()
assert.ok(bundle.includes('__ModuleLoader__'), '客户端产物应使用 __ModuleLoader__')
assert.ok(bundle.includes('"dsh-balance"') || bundle.includes("'dsh-balance'"), '客户端产物应登记 dsh-balance')
console.log(`✓ 客户端产物可下载（${bundle.length} 字节）`)

// 4) 宿主快照：应为 ready，且数字来自假接口。
const stateResponse = await fetch(`${base}/dsh-balance/state`, { headers: { cookie, accept: 'application/json' } })
assert.equal(stateResponse.status, 200, 'GET /dsh-balance/state 应返回 200')
assert.equal(stateResponse.headers.get('cache-control'), 'no-store')
const state = await stateResponse.json()
console.log(`✓ GET /state → ${JSON.stringify(state)}`)
assert.equal(state.status, 'ready', '快照应为 ready')
assert.equal(state.source, 'api-key', '数据源应为 api-key')
assert.equal(state.wallets.length, 2, '应有两个币种钱包')
assert.equal(state.wallets[0].currency, 'CNY')
assert.equal(state.wallets[0].total, '128.4500', '宿主应原样保留服务端金额')
assert.equal(state.wallets[0].granted, '18.45')
assert.equal(state.wallets[0].toppedUp, '110.00')

// 5) 手动刷新：必须真的再打一次上游。
const before = (await (await fetch(`${mockBase}/hits`)).json()).hits
const refreshResponse = await fetch(`${base}/dsh-balance/refresh`, { method: 'POST', headers: { cookie } })
assert.equal(refreshResponse.status, 200, 'POST /refresh 应返回 200')
const refreshed = await refreshResponse.json()
assert.equal(refreshed.status, 'ready')
const after = (await (await fetch(`${mockBase}/hits`)).json()).hits
assert.ok(after > before, `刷新应触发上游请求（before=${before}, after=${after}）`)
console.log(`✓ POST /refresh 触发上游刷新（hit ${before} → ${after}）`)

// 6) 错误路径：未知子路径 404。
const missing = await fetch(`${base}/dsh-balance/unknown`, { headers: { cookie } })
assert.equal(missing.status, 404)
console.log('✓ 未知子路径返回 404')

console.log('\n端到端验证通过。')
