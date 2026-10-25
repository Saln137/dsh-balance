/**
 * 取数编排：账号优先、Key 兜底、鉴权失败不重试、任何异常都收口成可展示的失败。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeConfig } from '../src/host/config.ts'
import { readBalance, type AccountLike, type ReadBalanceDeps } from '../src/host/sources.ts'

/** 造一份依赖；未给的项按「未登录、没配 Key」处理。 */
function makeDeps(overrides: {
  source?: 'auto' | 'account' | 'api-key'
  account?: AccountLike
  key?: string
  fetchImpl?: typeof fetch
  resolveKey?: () => Promise<string | undefined>
}): ReadBalanceDeps {
  return {
    config: normalizeConfig({ source: overrides.source ?? 'auto' }),
    account: overrides.account,
    resolveKey: overrides.resolveKey ?? (async () => overrides.key),
    version: '0.1.0-test',
    timezoneOffsetSeconds: 32_400,
    ...(overrides.fetchImpl === undefined ? {} : { fetchImpl: overrides.fetchImpl }),
  }
}

/** 账号服务：返回固定结果。 */
function accountReturning(value: unknown): AccountLike {
  return { getBalance: async () => value }
}

/** 计数用的假 fetch。 */
function countingFetch(body: unknown, status = 200): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls: () => calls }
}

describe('readBalance', () => {
  it('auto：账号可用时走账号，且不碰 API Key', async () => {
    let keyReads = 0
    const result = await readBalance(
      makeDeps({
        account: accountReturning({ status: 'ready', value: [{ currency: 'CNY', balance: '8.79' }] }),
        resolveKey: async () => {
          keyReads += 1
          return 'sk-should-not-be-used'
        },
      }),
    )
    assert.deepEqual(result, { ok: true, wallets: [{ currency: 'CNY', total: '8.79' }], source: 'account' })
    assert.equal(keyReads, 0)
  })

  it('auto：账号未登录且没有 Key → signed-out（而不是 0 余额）', async () => {
    const result = await readBalance(makeDeps({ account: accountReturning(null) }))
    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.status : '', 'signed-out')
  })

  it('auto：账号未登录但有 Key → 走 API Key 路由', async () => {
    const fake = countingFetch({ balance_infos: [{ currency: 'CNY', total_balance: '19.80' }] })
    const result = await readBalance(
      makeDeps({
        account: accountReturning(null),
        key: 'sk-test',
        fetchImpl: fake.fetchImpl,
      }),
    )
    assert.deepEqual(result, { ok: true, wallets: [{ currency: 'CNY', total: '19.80' }], source: 'api-key' })
    assert.equal(fake.calls(), 1)
  })

  it('auto：没有账号服务时也能用 Key 兜底', async () => {
    const fake = countingFetch({ balance_infos: [{ currency: 'USD', total_balance: '2.00' }] })
    const result = await readBalance(makeDeps({ key: 'sk-test', fetchImpl: fake.fetchImpl }))
    assert.equal(result.ok, true)
    assert.equal(result.ok === true ? result.source : '', 'api-key')
  })

  it('api-key 模式完全忽略账号服务', async () => {
    let accountCalls = 0
    const account: AccountLike = {
      getBalance: async () => {
        accountCalls += 1
        return null
      },
    }
    const fake = countingFetch({ balance_infos: [{ currency: 'CNY', total_balance: '1.00' }] })
    const result = await readBalance(
      makeDeps({ source: 'api-key', account, key: 'sk-test', fetchImpl: fake.fetchImpl }),
    )
    assert.equal(result.ok, true)
    assert.equal(accountCalls, 0)
  })

  it('account 模式没有账号服务时如实报 signed-out', async () => {
    const result = await readBalance(makeDeps({ source: 'account' }))
    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.status : '', 'signed-out')
  })

  it('账号服务抛错时收口成 failed，并保留原因', async () => {
    const result = await readBalance(
      makeDeps({
        source: 'account',
        account: {
          getBalance: async () => {
            throw new Error('storage unavailable')
          },
        },
      }),
    )
    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.status : '', 'failed')
    assert.match(result.ok === false ? result.error : '', /storage unavailable/u)
  })

  it('把调用方身份（版本/语言/时区）传给账号服务', async () => {
    let metadata: Record<string, unknown> | undefined
    const account: AccountLike = {
      getBalance: async (client) => {
        metadata = client as unknown as Record<string, unknown>
        return null
      },
    }
    await readBalance(makeDeps({ account }))
    assert.equal(metadata?.['version'], '0.1.0-test')
    assert.equal(metadata?.['locale'], 'zh-CN')
    assert.equal(metadata?.['timezoneOffsetSeconds'], 32_400)
  })

  it('API Key 被拒（401）时不重试，直接报鉴权失败', async () => {
    const fake = countingFetch({ error: 'unauthorized' }, 401)
    const result = await readBalance(makeDeps({ key: 'sk-bad', fetchImpl: fake.fetchImpl }))
    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.status : '', 'failed')
    assert.match(result.ok === false ? result.error : '', /HTTP 401/u)
    assert.equal(fake.calls(), 1)
  })

  it('服务端 5xx 会重试一次后失败', async () => {
    const fake = countingFetch({ error: 'boom' }, 500)
    const result = await readBalance(makeDeps({ key: 'sk-test', fetchImpl: fake.fetchImpl }))
    assert.equal(result.ok, false)
    assert.equal(fake.calls(), 2)
  })

  it('网络层失败（fetch failed）被翻译成可行动的提示', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const result = await readBalance(makeDeps({ key: 'sk-test', fetchImpl }))
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.error : '', /网络请求失败/u)
  })

  it('凭据解析抛错时收口成 failed', async () => {
    const result = await readBalance(
      makeDeps({
        resolveKey: async () => {
          throw new Error('credential store broken')
        },
      }),
    )
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.error : '', /credential store broken/u)
  })

  it('响应非法时报错而不是给 0，且不重试', async () => {    const fake = countingFetch({ balance_infos: [{ currency: 'CNY' }] })
    const result = await readBalance(makeDeps({ key: 'sk-test', fetchImpl: fake.fetchImpl }))
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.error : '', /total_balance/u)
    assert.equal(fake.calls(), 1)
  })
})
