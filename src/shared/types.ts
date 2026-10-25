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
}

/** 路由前缀；客户端与宿主共用，避免两边各写一份字符串。 */
export const ROUTE_PREFIX = '/dsh-balance'

/** 客户端插件 id（必须等于包名，`__ModuleLoader__.load` 会校验）。 */
export const PLUGIN_ID = 'dsh-balance'
