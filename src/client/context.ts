/**
 * 浏览器侧用到的 Cordis 上下文最小面（与宿主侧 context.ts 同样的取舍：
 * 只声明真正调用的成员，不 import DSH 包，保持客户端产物零依赖）。
 */
import type { LocaleDict } from './locales.ts'

/** 插槽注册选项（只列本插件用到的字段）。 */
export interface SlotRegistration {
  name: string
  id?: string
  order?: number
  /** 声明字典命名空间后，组件会收到随语言切换更新的 `t` prop。 */
  locale?: string
  label?: () => string
}

/** `ctx.slots` 的可用面。 */
export interface SlotsLike {
  /** 在宿主插槽声明存活期间贡献注册。 */
  inject(key: string, contribute: () => () => void): () => void
  register(options: SlotRegistration, component: unknown): () => void
}

/** 翻译函数（`{name}` 模板参数插值）。 */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/** `ctx.locale` 的可用面。 */
export interface LocaleLike {
  register(namespace: string, dictionaries: { zh: LocaleDict; en: LocaleDict }): () => void
  bind(namespace: string): Translate
}

/** 浏览器侧上下文。 */
export interface ClientContext {
  slots: SlotsLike
  locale: LocaleLike
  effect<T>(setup: () => T | void, label?: string): T
  get<T = unknown>(name: string, strict?: boolean): T
}
