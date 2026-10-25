/**
 * 客户端半侧入口：`lib/client.js`。
 *
 * DSH 的客户端模块系统按「一个包 = 一个普通脚本」加载本文件，脚本必须
 * 立刻调用 `window.__ModuleLoader__.load({ id, factory })` 完成登记：
 * - 顶层**不能有 import/export**（不是 ESM，也不是 CommonJS）；
 * - `id` 必须等于包名，模块系统会校验「加载后是否登记了它」；
 * - react 等平台模块只能在 factory 里用 `require` 取。
 */
import { makeFactory } from './app.ts'
import { PLUGIN_ID } from '../shared/types.ts'

/** 模块系统的登记入口。 */
interface ModuleLoaderLike {
  load(registration: { id: string; factory: (require: (id: string) => unknown) => unknown }): void
}

const loader = (globalThis as { __ModuleLoader__?: ModuleLoaderLike }).__ModuleLoader__

if (loader === undefined || typeof loader.load !== 'function') {
  // 页面外壳过旧 / 不在 DSH 页面里：只告警，绝不抛错——启动阶段的异常会让整页 boot 失败。
  console.warn('[dsh-balance] 未找到 window.__ModuleLoader__，客户端半侧未注册')
} else {
  loader.load({ id: PLUGIN_ID, factory: makeFactory() })
}
