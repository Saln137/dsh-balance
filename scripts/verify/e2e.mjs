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
/** 实例把阈值调高到 5 时，用 `--expect-low` 打开「必须告警」的断言。 */
const expectLow = process.argv.includes('--expect-low')
/** 用假账号服务时，用 `--account` 打开账号路由相关断言。 */
const expectAccount = process.argv.includes('--account')

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
assert.equal(state.source, expectAccount ? 'account' : 'api-key', '数据源应与 profile 配置一致')
assert.equal(state.wallets.length, expectAccount ? 1 : 2, '钱包数量应与数据源一致')
assert.equal(state.wallets[0].currency, 'CNY')
assert.ok(Number.isFinite(Number(state.wallets[0].total)), '余额应是合法金额')
if (expectAccount) {
  // 账号路由提供的充值页：低余额横幅里的「去充值」靠它。
  assert.equal(state.topUpUrl, 'https://platform.example/top_up', '账号路由应带充值页')
} else {
  assert.equal(state.wallets[0].granted, '0.50', '宿主应原样保留赠送分项')
}

// 今日账本：date 必须是 YYYY-MM-DD，CNY 必须有条目（首次读数 spent=0）。
assert.ok(state.today !== null, '快照应带今日账本')
assert.match(state.today.date, /^\d{4}-\d{2}-\d{2}$/u)
const todayCny = state.today.byCurrency['CNY']
assert.ok(todayCny !== undefined, '今日账本应包含 CNY')
assert.ok(Number(todayCny.spent) >= 0, '今日消费不应为负')
if (!expectLow) assert.equal(state.low, null, '余额高于阈值时不应告警（默认 CNY 2）')

// 5) 手动刷新：必须真的再打一次上游，并且余额下降被记成今日消费。
const before = (await (await fetch(`${mockBase}/hits`)).json()).hits
const spentBefore = Number(todayCny.spent)
const refreshResponse = await fetch(`${base}/dsh-balance/refresh`, { method: 'POST', headers: { cookie } })
assert.equal(refreshResponse.status, 200, 'POST /refresh 应返回 200')
const refreshed = await refreshResponse.json()
assert.equal(refreshed.status, 'ready')

if (expectAccount) {
  // 假账号服务余额恒定：这一轮只验证「账号路由仍然可刷新」，以及充值页/告警没丢。
  assert.equal(refreshed.topUpUrl, 'https://platform.example/top_up', '刷新后充值页仍在')
  assert.equal(refreshed.low?.active, true, '刷新后告警仍在')
  console.log('✓ 账号路由刷新成功（余额恒定，充值页与告警保持）')
} else {
  const after = (await (await fetch(`${mockBase}/hits`)).json()).hits
  assert.ok(after > before, `刷新应触发上游请求（before=${before}, after=${after}）`)
  const spentAfter = Number(refreshed.today.byCurrency['CNY'].spent)
  assert.ok(spentAfter > spentBefore, `余额下降应累计为今日消费（${spentBefore} → ${spentAfter}）`)
  assert.ok(
    Number(refreshed.wallets[0].total) < Number(state.wallets[0].total),
    '假接口每次返回递减余额，刷新后应更低',
  )
  console.log(`✓ POST /refresh 触发上游刷新（hit ${before} → ${after}），今日消费 ${spentBefore} → ${spentAfter}`)
}

// 6) 低余额告警：阈值=5 的实例应该立刻告警（由 `--expect-low` 打开断言）。
if (expectLow) {
  assert.ok(refreshed.low !== null, '低于阈值时应带 low 告警')
  assert.equal(refreshed.low.active, true)
  assert.equal(refreshed.low.currency, 'CNY')
  assert.equal(refreshed.low.threshold, '5.00')
  console.log(`✓ 低余额告警生效（阈值 ${refreshed.low.threshold}，当前 ${refreshed.low.balance}）`)
}

// 7) 错误路径：未知子路径 404。
const missing = await fetch(`${base}/dsh-balance/unknown`, { headers: { cookie } })
assert.equal(missing.status, 404)
console.log('✓ 未知子路径返回 404')

console.log('\n端到端验证通过。')
