/**
 * 响应解析：**任何非法字段都必须报错，绝不能静默变成 0**。
 * 余额显示 0 会让用户以为钱没了；报错至少还能说清发生了什么。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAccountBalance, parseApiKeyBalance } from '../src/host/parse.ts'

describe('parseApiKeyBalance', () => {
  it('解析多币种钱包并保留服务端精度', () => {
    const wallets = parseApiKeyBalance({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '8.7900000000000000', granted_balance: '2.00', topped_up_balance: '6.79' },
        { currency: 'usd', total_balance: '0E-16' },
      ],
    })
    assert.deepEqual(wallets, [
      { currency: 'CNY', total: '8.7900000000000000', granted: '2.00', toppedUp: '6.79' },
      { currency: 'USD', total: '0E-16' },
    ])
  })

  it('缺少 balance_infos 或为空数组时抛错', () => {
    assert.throws(() => parseApiKeyBalance({ is_available: false }), /balance_infos/u)
    assert.throws(() => parseApiKeyBalance({ balance_infos: [] }), /balance_infos/u)
    assert.throws(() => parseApiKeyBalance(null), /JSON 对象/u)
    assert.throws(() => parseApiKeyBalance('oops'), /JSON 对象/u)
  })

  it('缺少币种或金额时抛错，而不是补 0', () => {
    assert.throws(() => parseApiKeyBalance({ balance_infos: [{ total_balance: '1.00' }] }), /currency/u)
    assert.throws(() => parseApiKeyBalance({ balance_infos: [{ currency: 'CNY' }] }), /total_balance/u)
  })

  it('金额非法时抛错', () => {
    assert.throws(() => parseApiKeyBalance({ balance_infos: [{ currency: 'CNY', total_balance: 'abc' }] }), /不是合法金额/u)
    assert.throws(
      () => parseApiKeyBalance({ balance_infos: [{ currency: 'CNY', total_balance: '1.00', granted_balance: 'x' }] }),
      /granted_balance/u,
    )
  })

  it('可选分项缺失时不写入这个键', () => {
    const [wallet] = parseApiKeyBalance({ balance_infos: [{ currency: 'CNY', total_balance: '5.00' }] })
    assert.ok(wallet !== undefined)
    assert.equal('granted' in wallet, false)
    assert.equal('toppedUp' in wallet, false)
  })
})

describe('parseAccountBalance', () => {
  it('ready 时映射为钱包列表', () => {
    const result = parseAccountBalance({
      status: 'ready',
      value: [
        { currency: 'CNY', balance: '9.9902690000000000' },
        { currency: 'USD', balance: '6.78' },
      ],
    })
    assert.deepEqual(result, {
      ok: true,
      wallets: [
        { currency: 'CNY', total: '9.9902690000000000' },
        { currency: 'USD', total: '6.78' },
      ],
    })
  })

  it('null 表示未登录，而不是 0 余额', () => {
    assert.deepEqual(parseAccountBalance(null), { ok: false, status: 'signed-out', message: '未登录 DeepSeek 账号' })
  })

  it('failed 与未知状态都归为读取失败', () => {
    assert.equal(parseAccountBalance({ status: 'failed' }).ok, false)
    const unknown = parseAccountBalance({ status: 'pending' })
    assert.equal(unknown.ok, false)
    assert.match(unknown.ok === false ? unknown.message : '', /状态未知/u)
  })

  it('ready 但没有钱包数据时失败', () => {
    const result = parseAccountBalance({ status: 'ready', value: [] })
    assert.equal(result.ok, false)
  })

  it('金额非法时失败而不是显示 0', () => {
    const result = parseAccountBalance({ status: 'ready', value: [{ currency: 'CNY', balance: 'NaN' }] })
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.message : '', /合法金额/u)
  })
})
