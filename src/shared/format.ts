/**
 * 金额与时间的展示格式化（纯函数，无 DOM、无 locale 服务依赖，可单测）。
 *
 * 货币符号 + 两位小数 + 千分位，手工实现而不用 `Intl.NumberFormat`：
 * 后者的输出随 ICU 数据变化（窄空格、不同分组符），一个余额标签不值得
 * 引入这种不确定性。
 */
import type { WalletView } from './types.ts'

/** 已知币种符号；未知币种退化成「代码 + 空格」前缀（如 `EUR 1.00`）。 */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  CNY: '¥',
  USD: '$',
}

/**
 * 取币种符号。
 * @param currency - ISO 币种代码，大小写不敏感。
 * @returns 符号；未知币种返回 `CODE ` 形式的前缀。
 */
export function currencySymbol(currency: string): string {
  const code = currency.trim().toUpperCase()
  return CURRENCY_SYMBOLS[code] ?? `${code} `
}

/**
 * 解析服务端金额串。
 * @param raw - 十进制字符串（服务端可能给 `9.9902690000000000` 或 `0E-16`）。
 * @returns 有限数值；非法/空返回 undefined（调用方显示占位符，绝不伪造 0）。
 */
export function parseAmount(raw: string | undefined | null): number | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * 金额展示：符号 + 两位小数 + 千分位。
 * @param raw - 服务端金额串；非法时返回 `—`。
 * @param currency - ISO 币种代码。
 * @returns 例如 `¥8.79`、`$1,234.50`、`EUR 0.00`、`—`。
 */
export function formatAmount(raw: string | undefined | null, currency: string): string {
  const value = parseAmount(raw)
  if (value === undefined) return '—'
  const fixed = Math.abs(value).toFixed(2)
  const [whole = '0', fraction = '00'] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${value < 0 ? '-' : ''}${currencySymbol(currency)}${grouped}.${fraction}`
}

/**
 * 从钱包列表里挑出紧凑标签要显示的那个。
 *
 * 账户可能同时持有 CNY 与 USD：默认按服务端顺序取第一个（用户主币种通常在前），
 * 也可以用 `displayCurrency` 固定。固定币种不存在时仍然回落第一个——
 * 宁可显示真实存在的另一个币种，也不显示一个空标签。
 * @param wallets - 钱包列表。
 * @param displayCurrency - `auto` 或指定币种。
 * @returns 选中的钱包；列表为空时 undefined。
 */
export function pickPrimaryWallet(
  wallets: readonly WalletView[],
  displayCurrency: 'auto' | 'CNY' | 'USD',
): WalletView | undefined {
  if (wallets.length === 0) return undefined
  if (displayCurrency === 'auto') return wallets[0]
  const wanted = displayCurrency.toUpperCase()
  return wallets.find((wallet) => wallet.currency.toUpperCase() === wanted) ?? wallets[0]
}

/**
 * 本地时钟时间（`HH:MM:SS`），用于「更新于 …」。
 * @param epochMs - 毫秒时间戳。
 * @returns 补零后的本地时间。
 */
export function formatClock(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 紧凑的「多久以前」秒数，交给界面按当前语言拼文案。
 * @param sinceMs - 事件时间戳。
 * @param nowMs - 当前时间戳。
 * @returns 非负整秒数。
 */
export function secondsSince(sinceMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - sinceMs) / 1000))
}
