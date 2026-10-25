/**
 * 宿主配置：把 patch 里用户写的 `config` 归一化成确定值。
 *
 * 原则：配置是用户手写的 YAML，任何一项都可能是字符串、缺省或胡写；
 * 这里做一次收敛（校验 + 夹紧 + 兜底），让后面的取数逻辑只面对合法值，
 * 并且**绝不因为一个配置笔误就让插件装配失败**（装配失败 = 整个插件不可见）。
 */

/** 余额数据源策略。 */
export type BalanceSourceMode = 'auto' | 'account' | 'api-key'

/** 归一化后的宿主配置。 */
export interface BalanceConfig {
  /** `auto`：先账号、再 API Key；`account` / `api-key`：只用其中一条。 */
  source: BalanceSourceMode
  /** API Key 路由使用的凭据引用名（交给 credentials 服务解析）。 */
  apiKeyRef: string
  /** API Key 路由的接口根地址，默认官方端点。 */
  baseUrl: string
  /** 宿主后台刷新间隔（秒）。 */
  refreshIntervalSeconds: number
  /** 下发给浏览器的轮询间隔（秒）。 */
  pollIntervalSeconds: number
  /** 单次 HTTP 请求超时（毫秒）。 */
  requestTimeoutMs: number
  /** 账号服务要求的调用方语言（影响服务端返回文案，不影响金额）。 */
  locale: string
  /** 紧凑标签优先显示的币种。 */
  displayCurrency: 'auto' | 'CNY' | 'USD'
  /** 侧边栏折叠时是否仍显示。 */
  showInRail: boolean
  /** 是否统计并展示「今日消费」。 */
  todaySpend: boolean
  /** 低余额告警阈值（币种 → 金额）；0 表示该币种不告警。 */
  lowBalanceThresholds: Record<string, number>
  /** 计算「今天」用的时区（DeepSeek 按北京时间计费）。 */
  dayTimeZone: string
  /** 是否输出调试日志（只输出状态，绝不输出凭据）。 */
  debug: boolean
}

/** 默认低余额阈值：人民币 2 元、美元 0.3 元；余额低于它就开始醒目提示。 */
export const DEFAULT_LOW_BALANCE: Readonly<Record<string, number>> = { CNY: 2, USD: 0.3 }

/** 默认配置：与 cordis.patch.yml 里注释的默认值保持一致。 */
export const DEFAULT_CONFIG: BalanceConfig = {
  source: 'auto',
  apiKeyRef: 'DEEPSEEK_API_KEY',
  baseUrl: 'https://api.deepseek.com',
  refreshIntervalSeconds: 60,
  // 浏览器轮询的是宿主内存快照（不打上游），所以可以密一点：回合结束后
  // 宿主 1.2s 内会刷新一次，页面最多再隔这么久就能看到新数字。
  pollIntervalSeconds: 5,
  requestTimeoutMs: 15_000,
  locale: 'zh-CN',
  displayCurrency: 'auto',
  showInRail: true,
  todaySpend: true,
  lowBalanceThresholds: { ...DEFAULT_LOW_BALANCE },
  dayTimeZone: 'Asia/Shanghai',
  debug: false,
}

/** 凭据引用名文法（与 DSH credentials 的 REF_PATTERN 同义，避免依赖其运行时值）。 */
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/
/** 语言标签：`zh` / `zh-CN` / `en-US` 这类两段式即可。 */
const LOCALE_TAG = /^[A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 读一个有界整数。
 * @param value - 原始值（number 或数字字符串）。
 * @param fallback - 缺失/非法时的默认值。
 * @param min - 下界（含）。
 * @param max - 上界（含）。
 * @returns 夹紧后的整数。
 */
function readInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

/**
 * 归一化接口根地址。
 * @param value - 原始值。
 * @param fallback - 缺失/非法时的默认值。
 * @returns 去掉尾部斜杠的 http(s) 根地址。
 */
function readBaseUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback
    // 允许反代带路径前缀（`https://gw.example.com/deepseek`），但去掉尾部斜杠，
    // 后面统一用 `${baseUrl}/user/balance` 拼装。
    return url.toString().replace(/\/+$/u, '')
  } catch {
    return fallback
  }
}

/**
 * 归一化低余额阈值表。
 *
 * 用户只写关心的币种即可，其余保留默认；值必须是非负有限数（0 = 该币种不告警）。
 * 币种键按 `CNY` / `USD` 这种 3–5 位大写代码收敛。
 * @param value - 原始值（YAML 对象）。
 * @returns 币种 → 阈值。
 */
function readThresholds(value: unknown): Record<string, number> {
  const thresholds: Record<string, number> = { ...DEFAULT_LOW_BALANCE }
  if (!isRecord(value)) return thresholds
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const currency = rawKey.trim().toUpperCase()
    if (!/^[A-Z]{3,5}$/u.test(currency)) continue
    const parsed = typeof rawValue === 'number' ? rawValue : typeof rawValue === 'string' ? Number(rawValue) : Number.NaN
    if (!Number.isFinite(parsed) || parsed < 0) continue
    thresholds[currency] = Math.round(parsed * 100) / 100
  }
  return thresholds
}

/**
 * 归一化时区名（`Intl` 不认的值会让 `DateTimeFormat` 抛错，这里提前挡掉）。
 * @param value - 原始值。
 * @param fallback - 缺失/非法时的默认值。
 * @returns 合法 IANA 时区名。
 */
function readTimeZone(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback
  const zone = value.trim()
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone })
    return zone
  } catch {
    return fallback
  }
}

/**
 * 把原始 `config` 归一化。
 * @param raw - Loader 传入的配置（可能是 undefined、字符串或对象）。
 * @returns 完整配置，字段全部合法。
 */
export function normalizeConfig(raw: unknown): BalanceConfig {
  const source = isRecord(raw) ? raw : {}
  const mode = source['source']
  const displayCurrency = source['displayCurrency']
  const locale = source['locale']
  const apiKeyRef = source['apiKeyRef']

  return {
    source: mode === 'account' || mode === 'api-key' || mode === 'auto' ? mode : DEFAULT_CONFIG.source,
    apiKeyRef:
      typeof apiKeyRef === 'string' && CREDENTIAL_REF.test(apiKeyRef.trim())
        ? apiKeyRef.trim()
        : DEFAULT_CONFIG.apiKeyRef,
    baseUrl: readBaseUrl(source['baseUrl'], DEFAULT_CONFIG.baseUrl),
    // 15 秒是下限：再密就是拿用户账号去刷官方接口了。
    refreshIntervalSeconds: readInt(source['refreshIntervalSeconds'], DEFAULT_CONFIG.refreshIntervalSeconds, 15, 3600),
    pollIntervalSeconds: readInt(source['pollIntervalSeconds'], DEFAULT_CONFIG.pollIntervalSeconds, 5, 600),
    requestTimeoutMs: readInt(source['requestTimeoutMs'], DEFAULT_CONFIG.requestTimeoutMs, 3_000, 60_000),
    locale:
      typeof locale === 'string' && LOCALE_TAG.test(locale.trim())
        ? locale.trim().replace('_', '-')
        : DEFAULT_CONFIG.locale,
    displayCurrency:
      displayCurrency === 'CNY' || displayCurrency === 'USD' || displayCurrency === 'auto'
        ? displayCurrency
        : DEFAULT_CONFIG.displayCurrency,
    showInRail: typeof source['showInRail'] === 'boolean' ? source['showInRail'] : DEFAULT_CONFIG.showInRail,
    todaySpend: typeof source['todaySpend'] === 'boolean' ? source['todaySpend'] : DEFAULT_CONFIG.todaySpend,
    lowBalanceThresholds: readThresholds(source['lowBalanceThresholds']),
    dayTimeZone: readTimeZone(source['dayTimeZone'], DEFAULT_CONFIG.dayTimeZone),
    debug: source['debug'] === true,
  }
}
