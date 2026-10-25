/**
 * 今日账本：用**余额变动**推算「今日消费」。
 *
 * 为什么不直接查账单：DeepSeek 平台没有向本地暴露逐笔账单/费用的接口
 * （DSH 的 `usage` 只是一个跳转链接）。而余额是唯一的金额真值，所以：
 *
 * - 相邻两次读数**余额减少** → 计入今日消费；
 * - 相邻两次读数**余额增加** → 计入今日充值/退款（单独显示，不冲抵消费）；
 * - 跨天（按 `dayTimeZone`，默认北京时间）→ 重置基准；
 * - 账本落在 `$DSH_HOME/dsh-balance/ledger.json`，重启后当天数据不丢。
 *
 * 已知边界：如果「充值」和「消费」发生在同一次读数间隔内且金额恰好抵消，
 * 这次会记不上——余额本身没有方向信息，这是该口径的固有上限。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DailySpend, LowBalance, SpendEntry, WalletView } from '../shared/types.ts'

/** 单币种当日记录；金额保存累积原值（最多 8 位小数），格式化留给展示层。 */
export interface LedgerDay {
  /** 记录所属日期 `YYYY-MM-DD`（按配置时区）。 */
  date: string
  /** 当日首次观测到的余额（基准）。 */
  start: string
  /** 当日最后一次观测到的余额。 */
  last: string
  /** 当日累计消费（正数）。 */
  spent: string
  /** 当日累计入账（正数）。 */
  toppedUp: string
}

/** 账本文件结构。 */
export interface Ledger {
  version: 1
  /** 币种 → 当日记录（只保留当前这天的，跨天自然重置）。 */
  days: Record<string, LedgerDay>
}

/** 空账本。 */
export const EMPTY_LEDGER: Ledger = { version: 1, days: {} }

/** 累积精度：余额串有 16 位小数，收敛到 8 位避免浮点噪声越滚越大。 */
function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8
}

/**
 * 按配置时区取「今天是哪一天」。
 * @param at - 时间点。
 * @param timeZone - IANA 时区名。
 * @returns `YYYY-MM-DD`；时区非法时退回 UTC。
 */
export function dayOf(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

/**
 * 用一次成功读数更新账本。
 *
 * 纯函数：不读文件、不改入参。未变化的币种保持原记录，新出现/跨天的币种以当前余额为基准。
 * @param ledger - 旧账本。
 * @param wallets - 本次读到的钱包。
 * @param date - 今天（{@link dayOf}）。
 * @returns 新账本。
 */
export function applyReading(ledger: Ledger, wallets: readonly WalletView[], date: string): Ledger {
  const days: Record<string, LedgerDay> = {}

  for (const wallet of wallets) {
    const currency = wallet.currency.trim().toUpperCase()
    const current = Number(wallet.total)
    if (currency.length === 0 || !Number.isFinite(current)) continue

    const previous = ledger.days[currency]
    if (previous === undefined || previous.date !== date) {
      // 当天第一次（或跨天第一次）读数：它本身就是基准。
      days[currency] = {
        date,
        start: String(round8(current)),
        last: String(round8(current)),
        spent: '0',
        toppedUp: '0',
      }
      continue
    }

    const previousLast = Number(previous.last)
    const previousSpent = Number(previous.spent)
    const previousToppedUp = Number(previous.toppedUp)
    // 读数之间余额的变化方向决定它算消费还是算入账。
    const delta = round8((Number.isFinite(previousLast) ? previousLast : current) - current)
    const spent = round8((Number.isFinite(previousSpent) ? previousSpent : 0) + (delta > 0 ? delta : 0))
    const toppedUp = round8((Number.isFinite(previousToppedUp) ? previousToppedUp : 0) + (delta < 0 ? -delta : 0))

    days[currency] = { date, start: previous.start, last: String(round8(current)), spent: String(spent), toppedUp: String(toppedUp) }
  }

  return { version: 1, days }
}

/**
 * 把账本投影成面向浏览器的今日视图。
 * @param ledger - 账本。
 * @param date - 今天。
 * @returns 今日账本；没有任何当日币种时 `byCurrency` 为空对象。
 */
export function toDailySpend(ledger: Ledger, date: string): DailySpend {
  const byCurrency: Record<string, SpendEntry> = {}
  for (const [currency, day] of Object.entries(ledger.days)) {
    if (day.date !== date) continue
    byCurrency[currency] = { spent: day.spent, toppedUp: day.toppedUp, startBalance: day.start }
  }
  return { date, byCurrency }
}

/**
 * 找出需要告警的低余额币种。
 *
 * 多个币种同时低于各自阈值时，取「余额/阈值」比值最小的那个（最紧急的）。
 * @param wallets - 本次钱包。
 * @param thresholds - 币种 → 阈值；未配置或 ≤0 的币种不参与告警。
 * @returns 告警信息；没有币种低于阈值时 null。
 */
export function detectLow(wallets: readonly WalletView[], thresholds: Readonly<Record<string, number>>): LowBalance | null {
  let worst: LowBalance | null = null
  let worstRatio = Number.POSITIVE_INFINITY

  for (const wallet of wallets) {
    const currency = wallet.currency.trim().toUpperCase()
    const threshold = thresholds[currency]
    if (threshold === undefined || !Number.isFinite(threshold) || threshold <= 0) continue
    const balance = Number(wallet.total)
    if (!Number.isFinite(balance) || balance >= threshold) continue
    const ratio = balance / threshold
    if (ratio >= worstRatio) continue
    worstRatio = ratio
    worst = {
      active: true,
      currency,
      threshold: threshold.toFixed(2),
      balance: wallet.total,
    }
  }

  return worst
}

/**
 * 读取账本文件（容错：缺失、损坏、结构不对都当作空账本，绝不因此让插件装配失败）。
 * @param path - 账本路径。
 * @returns 账本。
 */
export function loadLedger(path: string): Ledger {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return { ...EMPTY_LEDGER, days: {} }
    const days = (raw as { days?: unknown }).days
    if (typeof days !== 'object' || days === null || Array.isArray(days)) return { ...EMPTY_LEDGER, days: {} }

    const valid: Record<string, LedgerDay> = {}
    for (const [currency, value] of Object.entries(days as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const record = value as Partial<LedgerDay>
      if (
        typeof record.date !== 'string' ||
        typeof record.start !== 'string' ||
        typeof record.last !== 'string' ||
        typeof record.spent !== 'string' ||
        typeof record.toppedUp !== 'string'
      ) {
        continue
      }
      valid[currency] = { ...record as LedgerDay }
    }
    return { version: 1, days: valid }
  } catch {
    return { ...EMPTY_LEDGER, days: {} }
  }
}

/**
 * 写账本（先写临时文件再改名，避免半截 JSON）。
 * @param path - 账本路径。
 * @param ledger - 要写入的账本。
 */
export function saveLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(ledger, undefined, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}
