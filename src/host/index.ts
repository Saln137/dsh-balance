/**
 * dsh-balance —— 宿主半侧。
 *
 * 职责边界（这也是「实时」的来源）：
 * 1. **唯一的取数点**：所有客户端共享本进程的这一份快照，避免每个窗口/标签页
 *    各拿一个定时器去打官方接口；
 * 2. **三种刷新触发**：
 *    - 装配时立刻读一次（用户打开就能看到数字）；
 *    - 后台定时器（默认 60s）；
 *    - 每个会话回合结束后（`session/event` 的 `turn/end`）防抖刷新一次——
 *      余额只会在发生计费调用时变化，所以「回合结束 + 一次刷新」比把定时器
 *      调快更准、也更省接口配额；
 * 3. **只读路由** `GET /dsh-balance/state` 把快照交给浏览器；`POST /refresh`
 *    是用户点「刷新」时的手动入口。
 *
 * 安全：凭据只在 `readBalance` 内部经 credentials 服务解析，返回值与日志里
 * 都不出现 key；路由也不回传任何账号身份信息。
 */
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeConfig } from './config.ts'
import type { HostContext } from './context.ts'
import { applyReading, dayOf, detectLow, loadLedger, saveLedger, toDailySpend } from './ledger.ts'
import { createBalanceStore } from './store.ts'
import { readBalance, type AccountLike } from './sources.ts'
import { PLUGIN_ID, ROUTE_PREFIX } from '../shared/types.ts'

/** Cordis 插件名（与包名一致，便于排查）。 */
export const name = PLUGIN_ID

/**
 * 装配前提：只有路由载体是必需的。
 * 账号服务（`deepseekAccount`）与凭据服务（`credentials`）按需软取——
 * 它们缺席时插件仍要能装配，并把「缺少凭据」如实显示给用户。
 */
export const inject = ['webServer']

/** 回合结束后等待多久再读余额：让平台侧账本先落账。 */
const TURN_SETTLE_MS = 1_200

/**
 * 读插件版本，作为账号服务要求的调用方身份。
 * @returns 版本号；读不到时回退 `0.0.0`（该字段只用于标识来源）。
 */
function readVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 版本号（模块加载时确定一次）。 */
const VERSION = readVersion()

/**
 * 发送 JSON 响应。
 * @param res - HTTP 响应。
 * @param status - 状态码。
 * @param body - JSON 可序列化响应体。
 * @param headers - 额外响应头。
 */
function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    // 余额是每用户数据：任何中间层都不许缓存。
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(payload)
}

/**
 * 把异常收敛成一句可展示的话。
 * @param error - 任意抛出物。
 * @returns 文本。
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 插件装配入口。
 * @param ctx - 宿主上下文。
 * @param rawConfig - Loader 行上的 `config`（可能缺省）。
 */
export function apply(ctx: HostContext, rawConfig?: unknown): void {
  const config = normalizeConfig(rawConfig)
  const pollMs = config.pollIntervalSeconds * 1000
  const store = createBalanceStore({
    pollMs,
    displayCurrency: config.displayCurrency,
    showInRail: config.showInRail,
  })

  // 今日账本：落在 $DSH_HOME/dsh-balance/ledger.json，重启后当天数据还在。
  const ledgerPath = join(process.env['DSH_HOME'] ?? join(homedir(), '.dsh'), 'dsh-balance', 'ledger.json')
  let ledger = loadLedger(ledgerPath)

  let disposed = false
  let inFlight: Promise<void> | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let intervalTimer: ReturnType<typeof setInterval> | undefined

  /**
   * 读账号服务里的充值页地址（`AccountView.links.topUpUrl`）。
   * 只对账号路由有意义；任何失败都不影响余额展示。
   * @returns 充值页地址，或 undefined。
   */
  const readTopUpUrl = async (source: string): Promise<string | undefined> => {
    if (source !== 'account') return undefined
    try {
      const account = ctx.get<{ getState?(): Promise<unknown> } | undefined>('deepseekAccount', false)
      if (account?.getState === undefined) return undefined
      const state = await account.getState()
      const links = (state as { links?: { topUpUrl?: unknown } } | null)?.links
      const url = links?.topUpUrl
      return typeof url === 'string' && /^https?:\/\//u.test(url) ? url : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 刷新一次余额（并发去重：同一时刻只允许一个请求在飞）。
   * @param reason - 触发来源，只用于调试日志。
   * @returns 本次刷新的 Promise。
   */
  const refresh = (reason: string): Promise<void> => {
    if (inFlight !== undefined) return inFlight
    inFlight = (async () => {
      const account = ctx.get<AccountLike | undefined>('deepseekAccount', false)
      const result = await readBalance({
        config,
        account,
        version: VERSION,
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        resolveKey: async (ref) => {
          const credentials = ctx.get<{ resolve(value: never): Promise<{ value: string } | undefined> } | undefined>(
            'credentials',
            false,
          )
          if (credentials === undefined) return undefined
          const resolved = await credentials.resolve(ref as never)
          return resolved?.value
        },
      })
      if (disposed) return
      const at = Date.now()
      if (result.ok) {
        // 今日消费靠「余额减少」推算：每次成功读数都记一笔，并落盘。
        const date = dayOf(new Date(at), config.dayTimeZone)
        ledger = applyReading(ledger, result.wallets, date)
        try {
          saveLedger(ledgerPath, ledger)
        } catch (error) {
          // 落盘失败只影响重启后的今日统计，不该让余额刷新失败。
          ctx.logger?.warn?.(`[${name}] 今日账本写入失败：${messageOf(error)}`)
        }
        const topUpUrl = await readTopUpUrl(result.source)
        store.succeed(result.wallets, result.source, at, {
          today: config.todaySpend ? toDailySpend(ledger, date) : null,
          low: detectLow(result.wallets, config.lowBalanceThresholds),
          ...(topUpUrl === undefined ? {} : { topUpUrl }),
        })
        ctx.logger?.debug?.(`[${name}] 余额已刷新（${reason}）：${result.source} / ${result.wallets.length} 个钱包`)
      } else {
        store.fail({ status: result.status, error: result.error, source: result.source }, at)
        ctx.logger?.debug?.(`[${name}] 余额刷新失败（${reason}）：${result.status} ${result.error}`)
      }
    })()
      .catch((error: unknown) => {
        // readBalance 内部已收口所有分支；这里只兜意外的编程错误。
        if (!disposed) store.fail({ status: 'failed', error: messageOf(error), source: 'none' }, Date.now())
        ctx.logger?.warn?.(`[${name}] 余额刷新异常：${messageOf(error)}`)
      })
      .finally(() => {
        inFlight = undefined
      })
    return inFlight
  }

  /** 快照超过刷新间隔时顺手补一次（浏览器轮询可自愈，不依赖定时器准时）。 */
  const refreshIfStale = (): void => {
    const checkedAt = store.read().checkedAt
    if (checkedAt === null || Date.now() - checkedAt > config.refreshIntervalSeconds * 1000) {
      void refresh('stale-read')
    }
  }

  /** 回合结束后防抖刷新：连续几个回合只算一次。 */
  const scheduleTurnRefresh = (): void => {
    if (settleTimer !== undefined) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = undefined
      void refresh('turn-end')
    }, TURN_SETTLE_MS)
    settleTimer.unref?.()
  }

  // 1) 装配即读一次：打开界面就有数字，而不是等第一个定时器。
  void refresh('startup')

  // 2) 后台定时刷新。
  ctx.effect(() => {
    intervalTimer = setInterval(() => void refresh('interval'), config.refreshIntervalSeconds * 1000)
    intervalTimer.unref?.()
    return () => {
      disposed = true
      if (intervalTimer !== undefined) clearInterval(intervalTimer)
      intervalTimer = undefined
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      settleTimer = undefined
    }
  }, `${name}: refresh timer`)

  // 3) 回合结束 → 账本落账后刷新一次（余额只在计费调用后变化）。
  ctx.effect(
    () =>
      ctx.on('session/event', (_session, event) => {
        const type = (event as { type?: unknown } | null)?.type
        if (type === 'turn/end') scheduleTurnRefresh()
      }),
    `${name}: turn refresh`,
  )

  // 4) 只读路由：浏览器侧的唯一数据入口。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          const method = (req.method ?? 'GET').toUpperCase()
          const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname

          if (path === `${ROUTE_PREFIX}/state`) {
            if (method !== 'GET') {
              sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
              return
            }
            refreshIfStale()
            sendJson(res, 200, store.read())
            return
          }

          if (path === `${ROUTE_PREFIX}/refresh`) {
            if (method !== 'POST') {
              sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
              return
            }
            await refresh('manual')
            sendJson(res, 200, store.read())
            return
          }

          sendJson(res, 404, { error: 'not found' })
        },
      }),
    `${name}: state route`,
  )
}
