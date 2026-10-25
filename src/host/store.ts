/**
 * 余额快照存储：宿主侧唯一的一份内存状态，HTTP 路由读它，刷新逻辑写它。
 *
 * 关键语义——失败**不覆盖**成功数据：
 * - 成功 → `ready`，记下 `updatedAt`，同时带上今日账本与低余额告警；
 * - 失败且手里有旧数字 → `stale`：数字照旧显示，附带错误说明（用户看到的是
 *   「上次成功读到的余额 + 取数失败」，而不是凭空出现的 0）；
 * - 失败且从没成功过 → 直接呈失败状态。
 */
import type { BalanceSource, BalanceView, DailySpend, LowBalance, WalletView } from '../shared/types.ts'

/** 一次失败携带的原因。 */
export interface BalanceFailure {
  status: 'signed-out' | 'no-credential' | 'failed'
  error: string
  source: BalanceSource
}

/** 成功时随余额一起更新的派生信息。 */
export interface BalanceExtras {
  /** 今日账本（`null` = 今日统计被配置关闭或还没有读数）。 */
  today: DailySpend | null
  /** 低余额告警（`null` = 未触发）。 */
  low: LowBalance | null
  /** 账号服务提供的充值页。 */
  topUpUrl?: string
}

/** 快照存储。 */
export interface BalanceStore {
  /** 读当前快照（返回副本，调用方改不坏内部状态）。 */
  read(): BalanceView
  /** 记一次成功。 */
  succeed(wallets: WalletView[], source: BalanceSource, at: number, extras: BalanceExtras): void
  /** 记一次失败。 */
  fail(failure: BalanceFailure, at: number): void
}

/** 深拷贝钱包数组（防止调用方后续改动污染快照）。 */
function cloneWallets(wallets: readonly WalletView[]): WalletView[] {
  return wallets.map((wallet) => ({ ...wallet }))
}

/**
 * 创建快照存储。
 * @param options - 随快照下发给浏览器的展示参数。
 * @returns 存储实例。
 */
export function createBalanceStore(options: {
  pollMs: number
  displayCurrency: 'auto' | 'CNY' | 'USD'
  showInRail: boolean
}): BalanceStore {
  let view: BalanceView = {
    status: 'loading',
    source: 'none',
    wallets: [],
    updatedAt: null,
    checkedAt: null,
    pollMs: options.pollMs,
    displayCurrency: options.displayCurrency,
    showInRail: options.showInRail,
    today: null,
    low: null,
  }

  return {
    read(): BalanceView {
      const today: DailySpend | null =
        view.today === null
          ? null
          : {
              date: view.today.date,
              byCurrency: Object.fromEntries(
                Object.entries(view.today.byCurrency).map(([currency, entry]) => [currency, { ...entry }]),
              ),
            }
      return { ...view, wallets: cloneWallets(view.wallets), today }
    },

    succeed(wallets: WalletView[], source: BalanceSource, at: number, extras: BalanceExtras): void {
      const next: BalanceView = {
        ...view,
        status: 'ready',
        source,
        wallets: cloneWallets(wallets),
        updatedAt: at,
        checkedAt: at,
        today: extras.today,
        low: extras.low,
      }
      // exactOptionalPropertyTypes：只有确实没有错误时才移除这两个键。
      delete next.error
      delete next.topUpUrl
      if (extras.topUpUrl !== undefined) next.topUpUrl = extras.topUpUrl
      view = next
    },

    fail(failure: BalanceFailure, at: number): void {
      const hasData = view.wallets.length > 0 && view.updatedAt !== null
      view = {
        ...view,
        status: hasData ? 'stale' : failure.status,
        source: hasData ? view.source : failure.source,
        checkedAt: at,
        error: failure.error,
      }
    },
  }
}
