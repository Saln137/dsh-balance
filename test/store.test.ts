/**
 * 快照存储：失败不能把已有数字冲掉；成功要一并更新今日账本与低余额告警。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBalanceStore, type BalanceExtras } from '../src/host/store.ts'

const options = { pollMs: 5_000, displayCurrency: 'auto' as const, showInRail: true }

/** 常用派生信息：默认没有今日数据、没有告警、没有流速、没有充值页。 */
function extras(overrides: Partial<BalanceExtras> = {}): BalanceExtras {
  return { today: null, low: null, flow: null, ...overrides }
}

describe('createBalanceStore', () => {
  it('初始为 loading，没有任何数字', () => {
    const store = createBalanceStore(options)
    const view = store.read()
    assert.equal(view.status, 'loading')
    assert.deepEqual(view.wallets, [])
    assert.equal(view.updatedAt, null)
    assert.equal(view.checkedAt, null)
    assert.equal(view.today, null)
    assert.equal(view.low, null)
  })

  it('成功后 ready，并记下两条时间', () => {
    const store = createBalanceStore(options)
    store.succeed([{ currency: 'CNY', total: '8.79' }], 'account', 1_000, extras())
    const view = store.read()
    assert.equal(view.status, 'ready')
    assert.equal(view.source, 'account')
    assert.deepEqual(view.wallets, [{ currency: 'CNY', total: '8.79' }])
    assert.equal(view.updatedAt, 1_000)
    assert.equal(view.checkedAt, 1_000)
  })

  it('把今日账本、告警、充值页一起带进快照', () => {
    const store = createBalanceStore(options)
    store.succeed([{ currency: 'CNY', total: '1.20' }], 'account', 1_000, extras({
      today: { date: '2026-10-25', byCurrency: { CNY: { spent: '2.1', toppedUp: '100', startBalance: '103.9' } } },
      low: { active: true, currency: 'CNY', threshold: '2.00', balance: '1.20' },
      topUpUrl: 'https://platform.example/top_up',
    }))
    const view = store.read()
    assert.equal(view.today?.date, '2026-10-25')
    assert.equal(view.today?.byCurrency['CNY']?.spent, '2.1')
    assert.equal(view.low?.active, true)
    assert.equal(view.low?.currency, 'CNY')
    assert.equal(view.topUpUrl, 'https://platform.example/top_up')
  })

  it('把流速快照一起带进来', () => {
    const store = createBalanceStore(options)
    store.succeed([{ currency: 'CNY', total: '8.79' }], 'account', 1_000, extras({
      flow: { currency: 'CNY', ratePerMinute: '0.4200', level: 3, windowSeconds: 60, samples: 11 },
    }))
    const view = store.read()
    assert.equal(view.flow?.level, 3)
    assert.equal(view.flow?.ratePerMinute, '0.4200')
  })

  it('第二次成功没有充值页时会移除这个键，不残留旧值', () => {
    const store = createBalanceStore(options)
    store.succeed([{ currency: 'CNY', total: '1.00' }], 'account', 1_000, extras({ topUpUrl: 'https://x/top' }))
    store.succeed([{ currency: 'CNY', total: '0.90' }], 'account', 2_000, extras())
    const view = store.read()
    assert.equal('topUpUrl' in view, false)
  })

  it('失败且手里有旧数据 → stale，数字、今日账本与成功时间保留', () => {
    const store = createBalanceStore(options)
    store.succeed([{ currency: 'CNY', total: '8.79' }], 'account', 1_000, extras({
      today: { date: '2026-10-25', byCurrency: { CNY: { spent: '0.2', toppedUp: '0', startBalance: '8.99' } } },
      low: { active: false, currency: 'CNY', threshold: '2.00', balance: '8.79' },
    }))
    store.fail({ status: 'failed', error: '网络断了', source: 'account' }, 2_000)
    const view = store.read()
    assert.equal(view.status, 'stale')
    assert.deepEqual(view.wallets, [{ currency: 'CNY', total: '8.79' }])
    assert.equal(view.updatedAt, 1_000)
    assert.equal(view.checkedAt, 2_000)
    assert.equal(view.error, '网络断了')
    // 旧账本在失败期间继续展示（用户看到的是「上次成功时的今日消费」）。
    assert.equal(view.today?.byCurrency['CNY']?.spent, '0.2')
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
    store.succeed([{ currency: 'CNY', total: '1.00' }], 'api-key', 2_000, extras())
    const view = store.read()
    assert.equal(view.status, 'ready')
    assert.equal('error' in view, false)
  })

  it('read 返回副本：调用方改不动内部状态（钱包与今日账本都是）', () => {
    const store = createBalanceStore(options)
    store.succeed([{ currency: 'CNY', total: '8.79' }], 'account', 1_000, extras({
      today: { date: '2026-10-25', byCurrency: { CNY: { spent: '0.2', toppedUp: '0', startBalance: '8.99' } } },
    }))
    const view = store.read()
    view.wallets[0]!.total = '0.00'
    view.status = 'failed'
    view.today!.byCurrency['CNY']!.spent = '999'
    const again = store.read()
    assert.equal(again.wallets[0]!.total, '8.79')
    assert.equal(again.status, 'ready')
    assert.equal(again.today!.byCurrency['CNY']!.spent, '0.2')
  })
})
