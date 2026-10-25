/**
 * 余额取数：把「用户当前登录方式」映射到对应的余额接口。
 *
 * 两条路由：
 * 1. **账号路由**（`deepseekAccount.getBalance`）——DeepSeek 平台登录态持有的
 *    授权记录，桌面端默认的计费来源。它没有 API Key，只能经账号服务查询，
 *    因此账号服务是**可选**的：没装账号插件时静默跳过；
 * 2. **API Key 路由**（`GET {baseUrl}/user/balance`）——官方文档化接口，
 *    用 credentials 服务解析出的 key 做 Bearer。
 *
 * `auto` 的顺序是「账号优先、Key 兜底」：桌面端登录账号才是用户看到的那个
 * 计费主体；账号未登录/读取失败时再退到 Key，绝不在两者之间编造数字。
 * 凭据只在本进程内使用，返回值里不出现 key。
 */
import type { BalanceSource, WalletView } from '../shared/types.ts'
import type { BalanceConfig } from './config.ts'
import { parseAccountBalance, parseApiKeyBalance } from './parse.ts'

/** 账号服务对调用方身份的最小要求（`AccountClientMetadata`）。 */
export interface AccountClientMetadata {
  version: string
  locale: string
  timezoneOffsetSeconds: number
}

/** 账号服务的最小可用面（只用到 getBalance，避免依赖其实现包）。 */
export interface AccountLike {
  getBalance(client: AccountClientMetadata): Promise<unknown>
}

/** 取数所需的全部依赖，全部由调用方注入（便于单测，不碰全局）。 */
export interface ReadBalanceDeps {
  config: BalanceConfig
  /** 账号服务；`undefined` 表示本组合没有账号插件。 */
  account: AccountLike | undefined
  /** 凭据解析：引用名 → key（由 `ctx.credentials.resolve` 注入）。 */
  resolveKey: (ref: string) => Promise<string | undefined>
  /** 插件版本，作为账号服务的调用方身份。 */
  version: string
  /** 时区偏移（秒，东八区为 +28800）。 */
  timezoneOffsetSeconds: number
  /** 测试注入的 fetch。 */
  fetchImpl?: typeof fetch
  /** 测试注入的时钟。 */
  now?: () => number
}

/** 一次取数的结果。 */
export type ReadBalanceResult =
  | { ok: true; wallets: WalletView[]; source: BalanceSource }
  | { ok: false; status: 'signed-out' | 'no-credential' | 'failed'; error: string; source: BalanceSource }

/** 单次抓取失败后是否再试一次：网络抖动值得重试，鉴权失败不值得。 */
const RETRY_DELAY_MS = 400
const MAX_ATTEMPTS = 2

/** 把异常收敛成一句可展示的人话。 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 带 HTTP 状态码的失败，用于区分「重试也没用」的响应。 */
class HttpFailure extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpFailure'
    this.status = status
  }
}

/** 重试也不会变好的失败（鉴权被拒、响应结构非法、4xx）：立刻收口。 */
class FatalFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalFailure'
  }
}

/**
 * 4xx 里只有少数值得重试：限流与请求超时是暂时的，其余（404/400）是配置问题。
 * @param status - HTTP 状态码。
 * @returns 是否值得再试一次。
 */
function isRetryable(status: number): boolean {
  if (status === 408 || status === 429) return true
  return status >= 500
}

/**
 * 等一小会儿（重试退避）。
 * @param ms - 毫秒。
 * @returns 计时结束的 Promise。
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 走 API Key 路由抓余额。
 * @param deps - 依赖。
 * @param key - 已解析出的 API Key（只在本函数内使用）。
 * @returns 逐币种钱包。
 * @throws 当网络失败、鉴权失败或响应非法时。
 */
async function fetchApiKeyWallets(deps: ReadBalanceDeps, key: string): Promise<WalletView[]> {
  const doFetch = deps.fetchImpl ?? fetch
  const url = `${deps.config.baseUrl}/user/balance`
  let lastError: unknown

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(RETRY_DELAY_MS)
    try {
      const response = await doFetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${key}`,
          accept: 'application/json',
          // 标识来源；不携带任何用户标识。
          'user-agent': 'dsh-balance',
        },
        signal: AbortSignal.timeout(deps.config.requestTimeoutMs),
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new FatalFailure(`API Key 被拒绝（HTTP ${response.status}），请检查凭据`)
        }
        const failure = new HttpFailure(response.status, `余额接口返回 HTTP ${response.status}`)
        if (!isRetryable(response.status)) throw new FatalFailure(failure.message)
        throw failure
      }

      // 响应结构/金额校验失败是「数据不对」，重试没有意义：包成 FatalFailure 让循环收口。
      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new FatalFailure('余额接口返回的不是合法 JSON')
      }
      try {
        return parseApiKeyBalance(body)
      } catch (error) {
        throw new FatalFailure(messageOf(error))
      }
    } catch (error) {
      lastError = error
      if (error instanceof FatalFailure) throw error
      // 只有网络层异常（超时、连接被重置）会走到这里，值得再试一次。
      if (error instanceof Error && error.name === 'TimeoutError') {
        lastError = new Error(`请求超时（>${deps.config.requestTimeoutMs}ms）`)
      }
    }
  }

  // 网络层异常（DNS / 连接被重置）在 undici 里是 `TypeError: fetch failed`：
  // 这种技术细节对用户没有意义，换成一句能行动的提示（其余异常保留原文便于排查）。
  const finalError = lastError instanceof Error ? lastError : new Error(String(lastError))
  if (finalError instanceof TypeError || /fetch failed/iu.test(finalError.message)) {
    throw new Error('网络请求失败（无法连接余额接口，请检查网络或代理）')
  }
  throw finalError
}

/**
 * 按配置读取一次余额。
 * @param deps - 依赖。
 * @returns 成功钱包列表，或带原因、可直接展示的失败。
 */
export async function readBalance(deps: ReadBalanceDeps): Promise<ReadBalanceResult> {
  const { config } = deps
  let accountFailure: { status: 'signed-out' | 'failed'; error: string } | undefined

  if (config.source !== 'api-key') {
    if (deps.account === undefined) {
      accountFailure = { status: 'signed-out', error: '账号服务不可用（未安装 DeepSeek 账号插件）' }
    } else {
      try {
        const raw = await deps.account.getBalance({
          version: deps.version,
          locale: config.locale,
          timezoneOffsetSeconds: deps.timezoneOffsetSeconds,
        })
        const parsed = parseAccountBalance(raw)
        if (parsed.ok) return { ok: true, wallets: parsed.wallets, source: 'account' }
        accountFailure = { status: parsed.status, error: parsed.message }
      } catch (error) {
        accountFailure = { status: 'failed', error: `账号服务异常：${messageOf(error)}` }
      }
    }
  }

  if (config.source === 'account') {
    const failure = accountFailure ?? { status: 'signed-out' as const, error: '账号服务不可用' }
    return { ok: false, status: failure.status, error: failure.error, source: 'account' }
  }

  // 到这里是 api-key 模式，或 auto 模式的兜底段。
  let key: string | undefined
  try {
    key = await deps.resolveKey(config.apiKeyRef)
  } catch (error) {
    return { ok: false, status: 'failed', error: `读取凭据失败：${messageOf(error)}`, source: 'api-key' }
  }

  if (key === undefined || key.length === 0) {
    // 账号那条已经试过了：把它的原因原样报出来，比「没有凭据」更准确。
    if (accountFailure !== undefined && config.source === 'auto') {
      return { ok: false, status: accountFailure.status, error: accountFailure.error, source: 'account' }
    }
    return {
      ok: false,
      status: 'no-credential',
      error: `未登录 DeepSeek 账号，且没有配置 ${config.apiKeyRef}`,
      source: 'none',
    }
  }

  try {
    return { ok: true, wallets: await fetchApiKeyWallets(deps, key), source: 'api-key' }
  } catch (error) {
    return { ok: false, status: 'failed', error: messageOf(error), source: 'api-key' }
  }
}
