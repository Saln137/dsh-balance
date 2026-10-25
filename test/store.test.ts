/**
 * 快照存储：失败不能把已有数字冲掉；成功要一并更新两个时间戳。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBalanceStore } from '../src/host/store.ts'

const options = { pollMs: 15_000, displayCurrency: 'auto' as const, showInRail: true }

describe('createBalanceStore', () => {
  it('初始为 loading，没有任何数字', () => {
    const store = createBalanceStore(options)
    const view = store.read()
    assert.equal(view.status, 'loading')
    assert.deepEqual(view.wallets, [])
    assert.equal(view.updatedAt, null)
    assert.equal(view.checkedAt, null)
  })

  it('成功后 ready，并记下两条时间', () => {
    const store = createBalanceStore(options)
    store.succeed([{ currency: 'CNY', total: '8.79' }], 'account', 1_000)
    const view = store.read()
    assert.equal(view.status, 'ready')
    assert.equal(view.source, 'account')
    assert.deepEqual(view.wallets, [{ currency: 'CNY', total: '8.79' }])
    assert.equal(view.updatedAt, 1_000)
    assert.equal(view.checkedAt, 1_000)
  })

  it('失败且手里有旧数据 → stale，数字与成功时间保留', () => {
    const store = createBalanceStore(options)
    store.succeed([{ currency: 'CNY', total: '8.79' }], 'account', 1_000)
    store.fail({ status: 'failed', error: '网络断了', source: 'account' }, 2_000)
    const view = store.read()
    assert.equal(view.status, 'stale')
    assert.deepEqual(view.wallets, [{ currency: 'CNY', total: '8.79' }])
    assert.equal(view.updatedAt, 1_000)
    assert.equal(view.checkedAt, 2_000)
    assert.equal(view.error, '网络断了')
  })

  it('失败且从没成功过 → 直接呈现失败状态', () => {
    const store = createBalanceStore(options)
    store.fail({ status: 'signed-out', error: '未登录', source: 'account' }, 2_000)
    const view = store.read()
    assert.equal(view.status, 'signed-out')
    assert.equal(view.updatedAt, null)
    assert.equal(view.error, '未登录')
  })

  it('重新成功会清掉上一次的错误', () => {
    const store = createBalanceStore(options)
    store.fail({ status: 'failed', error: '第一次失败', source: 'none' }, 1_000)
    store.succeed([{ currency: 'CNY', total: '1.00' }], 'api-key', 2_000)
    const view = store.read()
    assert.equal(view.status, 'ready')
    assert.equal('error' in view, false)
  })

  it('read 返回副本：调用方改不动内部状态', () => {
    const store = createBalanceStore(options)
    store.succeed([{ currency: 'CNY', total: '8.79' }], 'account', 1_000)
    const view = store.read()
    view.wallets[0]!.total = '0.00'
    view.status = 'failed'
    const again = store.read()
    assert.equal(again.wallets[0]!.total, '8.79')
    assert.equal(again.status, 'ready')
  })
})
