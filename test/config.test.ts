/**
 * 配置归一化的边界：用户手写的 YAML 什么都可能写，这里保证插件不会因为
 * 一个笔误就装配失败，也不会把 15 秒以下的刷新间隔放过去。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_CONFIG, normalizeConfig } from '../src/host/config.ts'

describe('normalizeConfig', () => {
  it('缺省配置时给出全部默认值', () => {
    assert.deepEqual(normalizeConfig(undefined), DEFAULT_CONFIG)
    assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG)
    assert.deepEqual(normalizeConfig('garbage'), DEFAULT_CONFIG)
  })

  it('只写关心的项、其余保持默认', () => {
    const config = normalizeConfig({ source: 'api-key' })
    assert.equal(config.source, 'api-key')
    assert.equal(config.refreshIntervalSeconds, DEFAULT_CONFIG.refreshIntervalSeconds)
  })

  it('刷新间隔夹紧在 [15, 3600]', () => {
    assert.equal(normalizeConfig({ refreshIntervalSeconds: 1 }).refreshIntervalSeconds, 15)
    assert.equal(normalizeConfig({ refreshIntervalSeconds: 99_999 }).refreshIntervalSeconds, 3600)
    assert.equal(normalizeConfig({ refreshIntervalSeconds: 90.4 }).refreshIntervalSeconds, 90)
    assert.equal(normalizeConfig({ refreshIntervalSeconds: '45' }).refreshIntervalSeconds, 45)
    assert.equal(normalizeConfig({ refreshIntervalSeconds: 'abc' }).refreshIntervalSeconds, 60)
  })

  it('轮询间隔夹紧在 [5, 600]', () => {
    assert.equal(normalizeConfig({ pollIntervalSeconds: 0 }).pollIntervalSeconds, 5)
    assert.equal(normalizeConfig({ pollIntervalSeconds: 9_999 }).pollIntervalSeconds, 600)
  })

  it('baseUrl 只接受 http(s) 并去掉尾部斜杠', () => {
    assert.equal(normalizeConfig({ baseUrl: 'https://api.deepseek.com/' }).baseUrl, 'https://api.deepseek.com')
    assert.equal(normalizeConfig({ baseUrl: 'https://gw.example.com/ds//' }).baseUrl, 'https://gw.example.com/ds')
    assert.equal(normalizeConfig({ baseUrl: 'ftp://nope' }).baseUrl, DEFAULT_CONFIG.baseUrl)
    assert.equal(normalizeConfig({ baseUrl: 'not a url' }).baseUrl, DEFAULT_CONFIG.baseUrl)
  })

  it('凭据引用名非法时回落到默认值', () => {
    assert.equal(normalizeConfig({ apiKeyRef: 'MY_KEY' }).apiKeyRef, 'MY_KEY')
    assert.equal(normalizeConfig({ apiKeyRef: 'has space' }).apiKeyRef, 'DEEPSEEK_API_KEY')
    assert.equal(normalizeConfig({ apiKeyRef: '' }).apiKeyRef, 'DEEPSEEK_API_KEY')
  })

  it('未知枚举值逐一回落', () => {
    assert.equal(normalizeConfig({ source: 'ftp' }).source, 'auto')
    assert.equal(normalizeConfig({ displayCurrency: 'JPY' }).displayCurrency, 'auto')
    assert.equal(normalizeConfig({ displayCurrency: 'USD' }).displayCurrency, 'USD')
    assert.equal(normalizeConfig({ locale: 'not a locale' }).locale, 'zh-CN')
    assert.equal(normalizeConfig({ locale: 'en_US' }).locale, 'en-US')
  })

  it('布尔项只接受真正的布尔值', () => {
    assert.equal(normalizeConfig({ showInRail: false }).showInRail, false)
    assert.equal(normalizeConfig({ showInRail: 'no' }).showInRail, true)
    assert.equal(normalizeConfig({ debug: true }).debug, true)
    assert.equal(normalizeConfig({ debug: 1 }).debug, false)
  })

  it('超时夹紧在 [3000, 60000]', () => {
    assert.equal(normalizeConfig({ requestTimeoutMs: 10 }).requestTimeoutMs, 3_000)
    assert.equal(normalizeConfig({ requestTimeoutMs: 999_999 }).requestTimeoutMs, 60_000)
  })

  it('低余额阈值只覆盖给出的币种，其余保留默认', () => {
    assert.deepEqual(normalizeConfig({ lowBalanceThresholds: { CNY: 5 } }).lowBalanceThresholds, {
      CNY: 5,
      USD: 0.3,
    })
    assert.equal(normalizeConfig({ lowBalanceThresholds: { cny: '3.5' } }).lowBalanceThresholds['CNY'], 3.5)
  })

  it('低余额阈值忽略非法键与非法值，0 表示关闭该币种告警', () => {
    const thresholds = normalizeConfig({
      lowBalanceThresholds: { 'not a code': 9, CNY: -1, USD: 0, EUR: 'abc' },
    }).lowBalanceThresholds
    assert.equal('not a code' in thresholds, false)
    assert.equal(thresholds['CNY'], 2, '负数被忽略，保留默认')
    assert.equal(thresholds['USD'], 0, '0 是合法值（关闭）')
    assert.equal('EUR' in thresholds, false, '非法值被忽略')
  })

  it('今日统计开关只接受布尔', () => {
    assert.equal(normalizeConfig({ todaySpend: false }).todaySpend, false)
    assert.equal(normalizeConfig({ todaySpend: 'no' }).todaySpend, true)
  })

  it('时区非法时回落到默认（北京时间）', () => {
    assert.equal(normalizeConfig({ dayTimeZone: 'Asia/Tokyo' }).dayTimeZone, 'Asia/Tokyo')
    assert.equal(normalizeConfig({ dayTimeZone: 'Mars/Olympus' }).dayTimeZone, 'Asia/Shanghai')
    assert.equal(normalizeConfig({ dayTimeZone: 42 }).dayTimeZone, 'Asia/Shanghai')
  })
})
