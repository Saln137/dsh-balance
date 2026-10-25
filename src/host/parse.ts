/**
 * 两条余额接口的响应解析（纯函数，可单测）。
 *
 * 统一铁律：**字段缺失或非法一律抛错/返回失败，绝不静默当 0**。
 * 余额显示 0 和余额读取失败是两件事：前者会让用户以为钱没了，
 * 后者至少还能给出「读取失败」并保留上一次成功的数据（见 store.ts）。
 */
import type { WalletView } from '../shared/types.ts'

/** 账号路由（DeepSeekAccount.getBalance）的解析结果。 */
export type AccountParseResult =
  | { ok: true; wallets: WalletView[] }
  | { ok: false; status: 'signed-out' | 'failed'; message: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 取必填的非空字符串。
 * @param value - 原始值。
 * @param what - 字段名（进错误信息）。
 * @returns 原字符串。
 * @throws 当值不是非空字符串时。
 */
function requiredString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`响应缺少字段 ${what}`)
  }
  return value
}

/**
 * 取可选的金额字符串：缺失/空 → undefined，出现但非法 → 抛错。
 * @param value - 原始值。
 * @param what - 字段名。
 * @returns 金额字符串或 undefined。
 * @throws 当值存在但不是有限数值字符串时。
 */
function optionalAmount(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`字段 ${what} 不是字符串`)
  if (!Number.isFinite(Number(value))) throw new Error(`字段 ${what} 不是合法金额`)
  return value
}

/**
 * 解析 API Key 路由（`GET /user/balance`）的响应。
 * @param body - 已 JSON 解析的响应体。
 * @returns 逐币种钱包（至少一个）。
 * @throws 当响应结构或金额非法时。
 */
export function parseApiKeyBalance(body: unknown): WalletView[] {
  if (!isRecord(body)) throw new Error('响应不是 JSON 对象')
  const infos = body['balance_infos']
  if (!Array.isArray(infos) || infos.length === 0) throw new Error('响应缺少 balance_infos')

  return infos.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`balance_infos[${index}] 不是对象`)
    const wallet: WalletView = {
      currency: requiredString(raw['currency'], `balance_infos[${index}].currency`).toUpperCase(),
      total: requiredString(raw['total_balance'], `balance_infos[${index}].total_balance`),
    }
    // 分项是可选的：接口没给就不编造，界面按「有无」决定展示。
    const granted = optionalAmount(raw['granted_balance'], `balance_infos[${index}].granted_balance`)
    const toppedUp = optionalAmount(raw['topped_up_balance'], `balance_infos[${index}].topped_up_balance`)
    if (granted !== undefined) wallet.granted = granted
    if (toppedUp !== undefined) wallet.toppedUp = toppedUp
    if (!Number.isFinite(Number(wallet.total))) {
      throw new Error(`balance_infos[${index}].total_balance 不是合法金额`)
    }
    return wallet
  })
}

/**
 * 解析账号路由（`DeepSeekAccount.getBalance`）的返回值。
 *
 * 账号服务的返回有三态：`null`（未登录 / 授权已变化）、`{status:'failed'}`
 * （服务端读取失败）、`{status:'ready', value:[{currency, balance}]}`。
 * 三者必须区分对待：只有后者能拿去显示，前两者要给出不同的提示。
 * @param result - 账号服务的返回值。
 * @returns 成功钱包列表，或带原因的状态。
 */
export function parseAccountBalance(result: unknown): AccountParseResult {
  if (result === null || result === undefined) {
    return { ok: false, status: 'signed-out', message: '未登录 DeepSeek 账号' }
  }
  if (!isRecord(result)) return { ok: false, status: 'failed', message: '账号余额响应格式未知' }
  if (result['status'] === 'failed') return { ok: false, status: 'failed', message: '账号服务读取余额失败' }
  if (result['status'] !== 'ready') {
    return { ok: false, status: 'failed', message: `账号余额状态未知：${String(result['status'])}` }
  }

  const value = result['value']
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, status: 'failed', message: '账号余额响应缺少钱包数据' }
  }

  const wallets: WalletView[] = []
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) return { ok: false, status: 'failed', message: `钱包[${index}] 不是对象` }
    try {
      const total = requiredString(raw['balance'], `value[${index}].balance`)
      if (!Number.isFinite(Number(total))) throw new Error(`value[${index}].balance 不是合法金额`)
      wallets.push({ currency: requiredString(raw['currency'], `value[${index}].currency`).toUpperCase(), total })
    } catch (error) {
      return { ok: false, status: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
  }
  return { ok: true, wallets }
}
