/**
 * 产物验收（`pnpm verify` 的最后一步）。
 *
 * 这一步不看源码、只看**构建产物**，因为 DSH 实际加载的就是产物：
 * 1. package.json 的 bundle / client / exports 声明是否齐全，指向的文件是否存在；
 * 2. 宿主产物是否只依赖 Node 内置模块（可跨 DSH 版本安装），并真的导出 apply；
 * 3. 客户端产物是否是「无顶层 import/export 的普通脚本」，加载后是否用正确的
 *    id 登记了 factory；
 * 4. 宿主 `apply()` 在假 ctx 上能否注册出 `/dsh-balance` 路由并返回 JSON；
 * 5. 客户端 `apply()` 在假 ctx 上能否注册进 `sidebar.footer.action`。
 *
 * 4/5 用最小替身（假 ctx / 假 React），不启动 DSH、不联网，纯粹验证装配契约。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = async (path) => readFile(join(root, path), 'utf8')
const pkg = JSON.parse(await read('package.json'))

/** 一段检查通过。 */
function ok(message) {
  console.log(`  ✓ ${message}`)
}

console.log('检查清单 ……')

// ---- 1. 清单与文件 ----
assert.equal(pkg.name, 'dsh-balance', '包名必须是 dsh-balance')
assert.equal(pkg.type, 'module', 'package.json 必须是 ESM')
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', '缺少 dsh.bundle.patch')
assert.equal(pkg.dsh?.client?.platform, 'web', 'dsh.client.platform 必须是 web')
assert.equal(pkg.exports?.['.'], './lib/index.js', 'exports["."] 必须指向宿主产物')
assert.equal(pkg.exports?.['./client'], './lib/client.js', 'exports["./client"] 必须指向客户端产物')
for (const file of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
  assert.ok(existsSync(join(root, file)), `${file} 不存在（先跑 pnpm build）`)
}
ok('package.json 清单与产物文件齐全')

// ---- 2. patch 层：id 必须等于包名（profile 覆盖与商店契约都按它定位）----
const patch = await read('cordis.patch.yml')
assert.match(patch, new RegExp(`- id: ${pkg.name}\\b`, 'u'), 'patch 里缺少 id 行')
assert.match(patch, new RegExp(`name: '${pkg.name}'`, 'u'), 'patch 里的 name 必须解析到本包')
ok('cordis.patch.yml 的 insert 行指向本包')

// ---- 3. 宿主产物：只依赖 node: 内置，导出 apply/inject/name ----
const hostSource = await read('lib/index.js')
const hostImports = [...hostSource.matchAll(/^import\s[^\n]*from\s+["']([^"']+)["']/gmu)].map((match) => match[1])
const nonBuiltin = hostImports.filter((specifier) => !specifier.startsWith('node:'))
assert.deepEqual(nonBuiltin, [], `宿主产物不应依赖 DSH 包：${nonBuiltin.join(', ')}`)
assert.doesNotMatch(hostSource, /@deepseek-ai\//u, '宿主产物里不应出现 @deepseek-ai/ 运行时引用')
ok(`宿主产物自包含（仅内置依赖：${hostImports.join(', ') || '无'}）`)

const hostModule = await import(pathToFileURL(join(root, 'lib/index.js')).href)
assert.equal(typeof hostModule.apply, 'function', '宿主必须导出 apply')
assert.equal(hostModule.name, pkg.name, '宿主插件名必须等于包名')
assert.ok(Array.isArray(hostModule.inject) && hostModule.inject.includes('webServer'), '宿主必须注入 webServer')
ok('宿主产物导出 apply / inject / name')

// 假 ctx：effect 立刻执行并收集 disposer；webServer.register 收集路由。
const disposers = []
const routes = []
const fakeHostCtx = {
  logger: { info() {}, warn() {}, debug() {} },
  get: () => undefined,
  effect: (setup) => {
    const disposer = setup()
    if (typeof disposer === 'function') disposers.push(disposer)
    return disposer
  },
  on: () => () => {},
  webServer: {
    register: (route) => {
      routes.push(route)
      return () => {}
    },
  },
}

hostModule.apply(fakeHostCtx, { source: 'account', refreshIntervalSeconds: 900 })
assert.equal(routes.length, 1, '宿主应注册一条路由')
assert.equal(routes[0].kind, 'prefix')
assert.equal(routes[0].path, '/dsh-balance')

/** 极简 ServerResponse 替身，收集状态码与响应体。 */
function fakeResponse() {
  const record = { status: 0, headers: {}, body: '' }
  record.writeHead = (status, headers) => {
    record.status = status
    record.headers = headers ?? {}
  }
  record.end = (chunk) => {
    record.body = chunk === undefined ? '' : String(chunk)
  }
  return record
}

const stateRes = fakeResponse()
await routes[0].handler({ method: 'GET', url: '/dsh-balance/state' }, stateRes)
assert.equal(stateRes.status, 200, 'GET /state 应返回 200')
assert.match(stateRes.headers['content-type'], /application\/json/u)
assert.equal(stateRes.headers['cache-control'], 'no-store', '余额不得被缓存')
const state = JSON.parse(stateRes.body)
assert.ok(typeof state.status === 'string', '快照必须带 status')
assert.equal(state.pollMs, 5_000, '快照必须下发轮询间隔')
assert.ok(Array.isArray(state.wallets), '快照必须带 wallets 数组')
// 新增的派生字段：今日账本与低余额告警（没有成功读数时是 null，但键必须在）。
assert.ok('today' in state, '快照必须带 today 字段')
assert.ok('low' in state, '快照必须带 low 字段')
assert.equal(state.today, null)
assert.equal(state.low, null)

const notFound = fakeResponse()
await routes[0].handler({ method: 'GET', url: '/dsh-balance/nope' }, notFound)
assert.equal(notFound.status, 404, '未知子路径应返回 404')

const wrongMethod = fakeResponse()
await routes[0].handler({ method: 'DELETE', url: '/dsh-balance/state' }, wrongMethod)
assert.equal(wrongMethod.status, 405, '非 GET 的 /state 应返回 405')
ok('宿主路由：/state 返回 JSON、未知路径 404、方法不匹配 405')

for (const dispose of disposers.splice(0)) dispose()

// ---- 4. 客户端产物：普通脚本 + 正确登记 ----
const clientSource = await read('lib/client.js')
const badTopLevel = [...clientSource.matchAll(/^\s*(?:import|export)\s/gmu)].map((match) => match[0])
assert.deepEqual(badTopLevel, [], '客户端产物不能有顶层 import/export')
assert.match(clientSource, /__ModuleLoader__/u, '客户端产物必须使用 __ModuleLoader__')

let registration
const sandbox = {
  __ModuleLoader__: {
    load: (value) => {
      registration = value
    },
  },
  console,
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(clientSource, sandbox, { filename: 'lib/client.js' })

assert.ok(registration !== undefined, '客户端脚本必须调用 __ModuleLoader__.load')
assert.equal(registration.id, pkg.name, '登记的 id 必须等于包名')

/** 最小 React 替身：只要工厂能建出组件，不需要真正渲染。 */
const ReactStub = {
  createElement: () => null,
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: () => ({ current: null }),
}

const pluginModule = registration.factory((specifier) => {
  if (specifier === 'react') return ReactStub
  throw new Error(`客户端产物请求了未预期的平台模块：${specifier}`)
})

assert.equal(typeof pluginModule.apply, 'function', '客户端必须导出 apply')
assert.ok(Array.isArray(pluginModule.inject) && pluginModule.inject.includes('slots'), '客户端必须注入 slots')
assert.ok(pluginModule.inject.includes('locale'), '客户端必须注入 locale')

const registrations = []
let localeRegistered = false
const fakeClientCtx = {
  effect: (setup) => setup(),
  get: () => undefined,
  locale: {
    register: () => {
      localeRegistered = true
      return () => {}
    },
    bind: () => (key) => key,
  },
  slots: {
    inject: (key, contribute) => contribute(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

pluginModule.apply(fakeClientCtx)
assert.ok(localeRegistered, '客户端应注册本地化字典')
assert.equal(registrations.length, 1, '客户端应注册一个插槽条目')
const entry = registrations[0]
assert.equal(entry.options.name, 'sidebar.footer.action', '注册目标是侧边栏底部动作区')
assert.equal(entry.options.id, 'balance', '列表条目 id 必须是 balance')
assert.equal(typeof entry.component, 'function', '注册的组件必须是函数组件')
ok('客户端产物：无顶层 import/export，登记 id 正确，注入 sidebar.footer.action')

console.log('\n全部产物检查通过。')
