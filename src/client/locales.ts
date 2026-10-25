/**
 * 界面文案（中/英）。文案只描述事实与下一步动作，不替用户做判断：
 * 读不到余额就说读不到，并给出「去哪里登录 / 配置」。
 */

/** 一个语言的字典。 */
export type LocaleDict = Record<string, string>

/** 字典命名空间；与 `ctx.slots.register({ locale })` 里的值一致。 */
export const NS = 'dsh-balance'

/** 中文文案。 */
export const zh: LocaleDict = {
  label: '余额',
  title: '账户余额',
  ariaLabel: '账户余额：{value}',
  'source.account': 'DeepSeek 账号',
  'source.apiKey': 'API Key',
  'source.none': '未知来源',
  updated: '更新于 {time}',
  neverUpdated: '尚未成功读取',
  refresh: '刷新',
  refreshing: '刷新中',
  granted: '赠送 {amount}',
  toppedUp: '充值 {amount}',
  signedOut: '未登录 DeepSeek 账号',
  signedOutHint: '在「设置 → 账号」登录后即可显示余额。',
  signedOutShort: '未登录',
  noCredential: '没有可用的余额来源',
  noCredentialHint: '登录 DeepSeek 账号，或配置 DEEPSEEK_API_KEY 后重试。',
  notConfiguredShort: '未配置',
  failed: '余额读取失败',
  loading: '正在读取余额…',
  staleNote: '显示的是上次成功读取的余额',
  unavailable: '暂不可用',
}

/** 英文文案。 */
export const en: LocaleDict = {
  label: 'Balance',
  title: 'Account balance',
  ariaLabel: 'Account balance: {value}',
  'source.account': 'DeepSeek account',
  'source.apiKey': 'API key',
  'source.none': 'Unknown source',
  updated: 'Updated {time}',
  neverUpdated: 'Never read successfully',
  refresh: 'Refresh',
  refreshing: 'Refreshing',
  granted: 'Granted {amount}',
  toppedUp: 'Topped up {amount}',
  signedOut: 'Not signed in',
  signedOutHint: 'Sign in from Settings → Account to see your balance.',
  signedOutShort: 'No account',
  noCredential: 'No balance source available',
  noCredentialHint: 'Sign in to your DeepSeek account or configure DEEPSEEK_API_KEY, then retry.',
  notConfiguredShort: 'Not set',
  failed: 'Could not read the balance',
  loading: 'Reading balance…',
  staleNote: 'Showing the last successful read',
  unavailable: 'Unavailable',
}
