/**
 * 宿主侧用到的 Cordis 上下文最小面。
 *
 * 为什么不直接 `import type { Context } from '@deepseek-ai/cordis'`：
 * 本项目是**独立仓库**，运行时靠 DSH 安装目录提供依赖；如果源码也去 import
 * 这些包，`tsc` 就必须先装齐整个 DSH 工作区。这里只声明我们真正调用的成员，
 * 既是类型约束也是文档——插件对宿主的要求一目了然，产物也不含任何 DSH 运行时依赖。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 一条 HTTP 路由（与 dsh-host-webserver 的 WebRoute 同形）。 */
export interface WebRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** `ctx.webServer` 的可用面。 */
export interface WebServerLike {
  register(route: WebRouteLike): () => void
}

/** `ctx.credentials.resolve` 的返回值（只关心 value）。 */
export interface ResolvedCredentialLike {
  value: string
  source: string
}

/** `ctx.credentials` 的可用面。 */
export interface CredentialsLike {
  resolve(ref: never): Promise<ResolvedCredentialLike | undefined>
}

/** 宿主日志面。 */
export interface LoggerLike {
  info?(message: string): void
  warn?(message: string): void
  debug?(message: string): void
}

/** 宿主上下文（只列插件实际用到的成员）。 */
export interface HostContext {
  logger?: LoggerLike
  /**
   * 软取一个服务：不存在时返回 undefined，不阻塞插件装配。
   * 账号 / 凭据服务都走这条路——它们是可选能力，不是本插件的装配前提。
   */
  get<T = unknown>(name: string, strict?: boolean): T
  /** 注册随插件生命周期回收的副作用。 */
  effect<T>(setup: () => T | void, label?: string): T
  /** 监听会话事件（turn/end 用来触发一次刷新）。 */
  on(event: 'session/event', listener: (session: unknown, event: unknown) => void): () => void
  webServer: WebServerLike
}
