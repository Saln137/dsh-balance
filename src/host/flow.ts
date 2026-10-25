/**
 * 余额流速：把「余额下降得多快」折算成 0–3 档，供界面驱动扫光特效。
 *
 * 口径（与今日消费同源，都是余额变动）：
 * - 只在**最近 windowSeconds 秒**的采样里算，`rate = 净减少 / 分钟`；
 * - 余额**上升**视为充值/退款：清空这个币种的窗口重新起一段，避免算出负消耗；
 * - 采样跨度不足（< window/2，且至少 10s）时不报速率——宁可不演，也不给假数据；
 * - 两次读数间隔超过 30 分钟（睡眠/休眠）视为断档，重置窗口；
 * - 速率做 EMA 平滑，档位切换再做 `holdMs` 保持期（滞回），避免一次抖动就闪烁。
 *
 * 纯逻辑：时间由调用方传入，不读系统时钟，便于单测。
 */
import type { FlowView, WalletView } from '../shared/types.ts'

/** 流速配置（已归一化）。 */
export interface FlowConfig {
  /** 关闭后 `observe` 永远返回 null（界面无特效）。 */
  enabled: boolean
  /** 观察窗口（秒）。 */
  windowSeconds: number
  /** 档位切换需要连续保持多久（毫秒）。 */
  holdMs: number
  /** 币种 → [L1, L2, L3] 的速率下界（¥/分钟）。 */
  thresholds: Record<string, [number, number, number]>
}

/** 一个采样点。 */
interface Sample {
  at: number
  total: number
}

/** 单币种的流速状态。 */
interface FlowState {
  samples: Sample[]
  ema: number | null
  level: 0 | 1 | 2 | 3
  candidate: 0 | 1 | 2 | 3 | null
  candidateSince: number | null
}

/** 采样点上限（60s 窗口每 5s 一采 = 12 个，留一倍余量）。 */
const MAX_SAMPLES = 24
/** 两次读数间隔超过它就认为断档（睡眠/休眠/长时间关闭）。 */
const GAP_MS = 30 * 60 * 1000
/** EMA 新值权重。 */
const EMA_ALPHA = 0.4

/**
 * 新建一个空状态。
 * @returns 初始状态。
 */
function emptyState(): FlowState {
  return { samples: [], ema: null, level: 0, candidate: null, candidateSince: null }
}

/**
 * 取该币种的阈值；没配就按「没有阈值」处理（不产生档位）。
 * @param thresholds - 币种 → 三档下界。
 * @param currency - 币种代码。
 * @returns 三档下界或 undefined。
 */
function thresholdOf(thresholds: FlowConfig['thresholds'], currency: string): [number, number, number] | undefined {
  return thresholds[currency]
}

/**
 * 速率 → 档位。
 * @param rate - 平滑后的速率（¥/分钟）。
 * @param thresholds - 三档下界。
 * @returns 0–3。
 */
function levelOf(rate: number, thresholds: readonly [number, number, number]): 0 | 1 | 2 | 3 {
  if (rate >= thresholds[2]) return 3
  if (rate >= thresholds[1]) return 2
  if (rate >= thresholds[0]) return 1
  return 0
}

/**
 * 挑出「界面上正在显示的那个钱包」（与客户端 `pickPrimaryWallet` 同口径）。
 * @param wallets - 本次钱包。
 * @param displayCurrency - `auto` 或指定币种。
 * @returns 选中的钱包。
 */
function pickWallet(wallets: readonly WalletView[], displayCurrency: 'auto' | 'CNY' | 'USD'): WalletView | undefined {
  if (wallets.length === 0) return undefined
  if (displayCurrency === 'auto') return wallets[0]
  const wanted = displayCurrency.toUpperCase()
  return wallets.find((wallet) => wallet.currency.toUpperCase() === wanted) ?? wallets[0]
}

/** 流速跟踪器。 */
export interface FlowTracker {
  /**
   * 记一次成功读数。
   * @param wallets - 本次钱包。
   * @param at - 本次读数时间（epoch ms）。
   * @returns 当前展示币种的流速快照；数据不足时为 null。
   */
  observe(wallets: readonly WalletView[], at: number): FlowView | null
}

/**
 * 创建流速跟踪器。
 * @param config - 流速配置。
 * @param displayCurrency - 当前展示币种（决定上报哪个币种的流速）。
 * @returns 跟踪器。
 */
export function createFlowTracker(config: FlowConfig, displayCurrency: 'auto' | 'CNY' | 'USD'): FlowTracker {
  const states = new Map<string, FlowState>()
  const minSpanMs = Math.max(10_000, (config.windowSeconds * 1000) / 2)

  return {
    observe(wallets: readonly WalletView[], at: number): FlowView | null {
      if (!config.enabled) return null

      for (const wallet of wallets) {
        const currency = wallet.currency.trim().toUpperCase()
        const total = Number(wallet.total)
        if (currency.length === 0 || !Number.isFinite(total)) continue

        let state = states.get(currency)
        if (state === undefined) {
          state = emptyState()
          states.set(currency, state)
        }

        const last = state.samples.at(-1)
        if (last !== undefined) {
          if (at - last.at > GAP_MS) {
            // 断档：不把那段时间算成消费。
            state.samples = []
            state.ema = null
            state.level = 0
            state.candidate = null
            state.candidateSince = null
          } else if (total > last.total + 1e-9) {
            // 充值/退款：窗口重开，速率清零。
            state.samples = []
            state.ema = null
            state.level = 0
            state.candidate = null
            state.candidateSince = null
          }
        }

        state.samples.push({ at, total })
        // 只保留 2 倍窗口内的采样，避免长跑后数组无限增长。
        const cutoff = at - config.windowSeconds * 2 * 1000
        while (state.samples.length > 0 && state.samples[0]!.at < cutoff) state.samples.shift()
        if (state.samples.length > MAX_SAMPLES) state.samples.splice(0, state.samples.length - MAX_SAMPLES)

        // 在窗口内取首尾两个样本算速率。
        const windowStart = at - config.windowSeconds * 1000
        const within = state.samples.filter((sample) => sample.at >= windowStart)
        const first = within[0]
        const newest = within.at(-1)
        if (first === undefined || newest === undefined || within.length < 2) {
          // 窗口里已经没有任何变化：按「无消费」快速衰减，而不是把上一档悬在那里。
          if (state.ema !== null) state.ema = Math.round(state.ema * 0.25 * 1e6) / 1e6
          continue
        }
        const spanMs = newest.at - first.at
        if (spanMs < minSpanMs) {
          // 跨度太短：还不足以说明「流速」，保留上一档（窗口正在重建），本次不更新。
          continue
        }

        const rawRate = Math.max(0, (first.total - newest.total) / (spanMs / 60_000))
        // 金额是十进制字符串，浮点减法会得到 0.599999… 这种值：
        // 先收敛到 6 位再比阈值，否则刚好等于档位下界时会掉档。
        const windowRate = Math.round(rawRate * 1e6) / 1e6
        if (state.ema === null) {
          state.ema = windowRate
        } else if (windowRate === 0) {
          // 整个窗口都没有消费：快速衰减（×0.25），否则扫光会在停手后拖好几分钟。
          state.ema = Math.round(state.ema * 0.25 * 1e6) / 1e6
        } else {
          state.ema = Math.round((state.ema * (1 - EMA_ALPHA) + windowRate * EMA_ALPHA) * 1e6) / 1e6
        }

        const thresholds = thresholdOf(config.thresholds, currency)
        if (thresholds === undefined) {
          state.ema = null
          continue
        }
        const target = levelOf(state.ema, thresholds)

        // 滞回：档位变化要连续保持 holdMs，避免采样抖动导致闪烁；
        // holdMs=0 时在本次读数就切换（候选期长度为 0）。
        if (target === state.level) {
          state.candidate = null
          state.candidateSince = null
        } else {
          const since = state.candidate === target && state.candidateSince !== null ? state.candidateSince : at
          if (at - since >= config.holdMs) {
            state.level = target
            state.candidate = null
            state.candidateSince = null
          } else {
            state.candidate = target
            state.candidateSince = since
          }
        }
      }

      const shown = pickWallet(wallets, displayCurrency)
      if (shown === undefined) return null
      const currency = shown.currency.trim().toUpperCase()
      const state = states.get(currency)
      if (state === undefined || state.ema === null) return null

      return {
        currency,
        ratePerMinute: state.ema.toFixed(4),
        level: state.level,
        windowSeconds: config.windowSeconds,
        samples: state.samples.length,
      }
    },
  }
}
