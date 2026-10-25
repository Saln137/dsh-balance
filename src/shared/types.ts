/**
 * 宿主与浏览器两半之间唯一的线上契约（JSON）。
 *
 * 设计约束：
 * - 只放可 JSON 序列化的字段：这条数据要经 HTTP 路由交给浏览器；
 * - **绝不出现凭据**：服务端读到的 key / 授权记录一律不出宿主进程；
 * - 币种与金额保持服务端原始字符串，格式化只在展示层做一次，避免在传输层丢精度。
 */

/** 一次读取的整体状态。 */
export type BalanceStatus =
  /** 还没有任何结果（启动后第一次读取中）。 */
  | 'loading'
  /** 读取成功，`wallets` 可用。 */
  | 'ready'
  /** 曾经成功、最近一次失败：保留旧数字并标记为过期，不把余额清成 0。 */
  | 'stale'
  /** 账号路由可用但未登录，且没有其他可用凭据。 */
  | 'signed-out'
  /** 没有任何可用凭据（未登录账号、也没配 API Key）。 */
  | 'no-credential'
  /** 读取失败且没有可回退的旧数据。 */
  | 'failed'

/** 数据来自哪条路由。 */
export type BalanceSource = 'account' | 'api-key' | 'none'

/** 一个币种钱包；金额是服务端原样字符串。 */
export interface WalletView {
  currency: string
  total: string
  /** 赠送额度分项（仅 API Key 路由提供） */
  granted?: string
  /** 充值额度分项（仅 API Key 路由提供） */
  toppedUp?: string
}

/**
 * 某币种「今日」的余额变动。
 *
 * 口径来自**余额本身**（DeepSeek 平台没有公开的本地账单接口）：余额净减少算消费，
 * 余额增加单独记为充值/退款——两者不互相冲抵，所以「充值 100 又花掉 2」会显示
 * `spent=2 / toppedUp=100`，而不是 0。
 */
export interface SpendEntry {
  /** 今日累计消费（正数，两位小数字符串）。 */
  spent: string
  /** 今日累计入账（充值/退款，正数）。 */
  toppedUp: string
  /** 今日首次观测到的余额（当日基准）。 */
  startBalance: string
}

/** 今日账本：一个日期 + 每个观测到的币种。 */
export interface DailySpend {
  /** 账本日期 `YYYY-MM-DD`（按配置的 dayTimeZone，默认北京时间）。 */
  date: string
  /** 币种 → 今日变动。 */
  byCurrency: Record<string, SpendEntry>
}

/** 低余额告警。 */
export interface LowBalance {
  /** 是否已低于阈值。 */
  active: boolean
  currency: string
  /** 触发阈值（原样两位小数）。 */
  threshold: string
  /** 当前余额（与 currency 对应）。 */
  balance: string
}

/** `GET /dsh-balance/state` 的响应体，也是插槽组件渲染的唯一数据源。 */
export interface BalanceView {
  status: BalanceStatus
  source: BalanceSource
  wallets: WalletView[]
  /** 最近一次成功的读取时间（epoch ms）。 */
  updatedAt: number | null
  /** 最近一次尝试的读取时间（epoch ms）。 */
  checkedAt: number | null
  /** 失败原因（已脱敏的人话），仅 status 为 stale/failed/signed-out 时存在。 */
  error?: string
  /** 宿主下发的轮询间隔：前端不自己拍脑袋定频率。 */
  pollMs: number
  /** 紧凑标签优先显示的币种。 */
  displayCurrency: 'auto' | 'CNY' | 'USD'
  /** 侧边栏折叠时是否仍显示图标。 */
  showInRail: boolean
  /** 今日账本；还没有成功读数时为 null。 */
  today: DailySpend | null
  /** 低余额告警；没有可用余额时为 null。 */
  low: LowBalance | null
  /** 账号服务提供的充值页地址（仅账号路由且服务提供时存在）。 */
  topUpUrl?: string
}

/** 路由前缀；客户端与宿主共用，避免两边各写一份字符串。 */
export const ROUTE_PREFIX = '/dsh-balance'

/** 客户端插件 id（必须等于包名，`__ModuleLoader__.load` 会校验）。 */
export const PLUGIN_ID = 'dsh-balance'
