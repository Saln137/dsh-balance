/**
 * 今日账本：余额净减少算消费、增加算充值、跨天重置、精度不丢、低余额判定。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import {
  EMPTY_LEDGER,
  applyReading,
  dayOf,
  detectLow,
  loadLedger,
  saveLedger,
  toDailySpend,
} from '../src/host/ledger.ts'

/** 每个用例独立目录，用完删除。 */
const scratch = mkdtempSync(join(tmpdir(), 'dsh-balance-ledger-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const DATE = '2026-10-25'
const wallet = (total: string, currency = 'CNY') => ({ currency, total })

describe('applyReading', () => {
  it('当天第一次读数只立基准，不算消费', () => {
    const ledger = applyReading(EMPTY_LEDGER, [wallet('8.79')], DATE)
    assert.deepEqual(ledger.days['CNY'], {
      date: DATE,
      start: '8.79',
      last: '8.79',
      spent: '0',
      toppedUp: '0',
    })
  })

  it('余额减少累计为消费', () => {
    let ledger = applyReading(EMPTY_LEDGER, [wallet('8.79')], DATE)
    ledger = applyReading(ledger, [wallet('8.50')], DATE)
    ledger = applyReading(ledger, [wallet('8.29')], DATE)
    assert.equal(ledger.days['CNY']?.spent, '0.5')
    assert.equal(ledger.days['CNY']?.toppedUp, '0')
    assert.equal(ledger.days['CNY']?.start, '8.79')
    assert.equal(ledger.days['CNY']?.last, '8.29')
  })

  it('余额增加单独记为充值，不把消费冲成负数', () => {
    let ledger = applyReading(EMPTY_LEDGER, [wallet('8.79')], DATE)
    ledger = applyReading(ledger, [wallet('108.79')], DATE)
    assert.equal(ledger.days['CNY']?.spent, '0')
    assert.equal(ledger.days['CNY']?.toppedUp, '100')
    // 充值后继续消费，仍然只累计真实消费。
    ledger = applyReading(ledger, [wallet('108.29')], DATE)
    assert.equal(ledger.days['CNY']?.spent, '0.5')
    assert.equal(ledger.days['CNY']?.toppedUp, '100')
  })

  it('消费与充值交替时互不冲抵', () => {
    let ledger = applyReading(EMPTY_LEDGER, [wallet('5')], DATE)
    ledger = applyReading(ledger, [wallet('4')], DATE) // 消费 1
    ledger = applyReading(ledger, [wallet('104')], DATE) // 充值 100
    ledger = applyReading(ledger, [wallet('99.5')], DATE) // 消费 4.5
    assert.equal(ledger.days['CNY']?.spent, '5.5')
    assert.equal(ledger.days['CNY']?.toppedUp, '100')
  })

  it('跨天重置基准与累计', () => {
    const day1 = applyReading(EMPTY_LEDGER, [wallet('10')], DATE)
    const day2 = applyReading(day1, [wallet('9')], '2026-10-26')
    assert.deepEqual(day2.days['CNY'], {
      date: '2026-10-26',
      start: '9',
      last: '9',
      spent: '0',
      toppedUp: '0',
    })
  })

  it('同一读数内新增币种独立开账', () => {
    let ledger = applyReading(EMPTY_LEDGER, [wallet('8.79')], DATE)
    ledger = applyReading(ledger, [wallet('8.79'), wallet('6.78', 'USD')], DATE)
    assert.equal(ledger.days['USD']?.start, '6.78')
    assert.equal(ledger.days['USD']?.spent, '0')
  })

  it('读数里消失的币种从账本里移除', () => {
    let ledger = applyReading(EMPTY_LEDGER, [wallet('8.79'), wallet('6.78', 'USD')], DATE)
    ledger = applyReading(ledger, [wallet('8.79')], DATE)
    assert.equal(ledger.days['USD'], undefined)
  })

  it('非法金额被忽略，不产生脏账', () => {
    const ledger = applyReading(EMPTY_LEDGER, [wallet('abc')], DATE)
    assert.deepEqual(ledger.days, {})
  })

  it('亚分消费连续累积不会四舍五入成 0', () => {
    let ledger = applyReading(EMPTY_LEDGER, [wallet('1.0000')], DATE)
    for (const total of ['0.9997', '0.9994', '0.9991']) {
      ledger = applyReading(ledger, [wallet(total)], DATE)
    }
    assert.equal(ledger.days['CNY']?.spent, '0.0009')
  })
})

describe('toDailySpend', () => {
  it('只导出当天，并保留原始精度供展示层格式化', () => {
    const ledger = applyReading(EMPTY_LEDGER, [wallet('1.00')], DATE)
    const spend = toDailySpend(applyReading(ledger, [wallet('0.501')], DATE), DATE)
    assert.equal(spend.date, DATE)
    assert.equal(spend.byCurrency['CNY']?.spent, '0.499')
    assert.equal(spend.byCurrency['CNY']?.startBalance, '1')
  })

  it('日期不匹配时导出的币种为空', () => {
    const ledger = applyReading(EMPTY_LEDGER, [wallet('1.00')], DATE)
    assert.deepEqual(toDailySpend(ledger, '2026-10-26').byCurrency, {})
  })
})

describe('detectLow', () => {
  it('低于阈值时给出告警对象', () => {
    assert.deepEqual(detectLow([wallet('1.20')], { CNY: 2 }), {
      active: true,
      currency: 'CNY',
      threshold: '2.00',
      balance: '1.20',
    })
  })

  it('等于或高于阈值不告警', () => {
    assert.equal(detectLow([wallet('2.00')], { CNY: 2 }), null)
    assert.equal(detectLow([wallet('2.01')], { CNY: 2 }), null)
  })

  it('没有配置阈值的币种不参与', () => {
    assert.equal(detectLow([wallet('0.01')], {}), null)
    assert.equal(detectLow([wallet('0.01')], { CNY: 0 }), null)
  })

  it('多币种同时告警时选最紧急的（余额/阈值最小）', () => {
    const low = detectLow([wallet('1.90', 'CNY'), wallet('0.10', 'USD')], { CNY: 2, USD: 0.3 })
    assert.equal(low?.currency, 'USD')
    assert.equal(low?.threshold, '0.30')
  })
})

describe('dayOf', () => {
  it('按北京时间跨天（UTC 16:30 已是次日）', () => {
    assert.equal(dayOf(new Date('2026-10-25T15:30:00Z'), 'Asia/Shanghai'), '2026-10-25')
    assert.equal(dayOf(new Date('2026-10-25T16:30:00Z'), 'Asia/Shanghai'), '2026-10-26')
  })

  it('时区非法时退回 UTC', () => {
    assert.equal(dayOf(new Date('2026-10-25T16:30:00Z'), 'Not/AZone'), '2026-10-25')
  })
})

describe('账本落盘', () => {
  it('写入后能原样读回', () => {
    const path = join(scratch, 'nested', 'ledger.json')
    const ledger = applyReading(EMPTY_LEDGER, [wallet('3.00')], DATE)
    saveLedger(path, ledger)
    assert.deepEqual(loadLedger(path), ledger)
  })

  it('文件缺失时返回空账本', () => {
    assert.deepEqual(loadLedger(join(scratch, 'missing.json')), { version: 1, days: {} })
  })

  it('文件损坏或结构不对时返回空账本，不抛错', () => {
    const broken = join(scratch, 'broken.json')
    writeFileSync(broken, '{not json', 'utf8')
    assert.deepEqual(loadLedger(broken).days, {})

    const wrongShape = join(scratch, 'shape.json')
    writeFileSync(wrongShape, JSON.stringify({ version: 1, days: [] }), 'utf8')
    assert.deepEqual(loadLedger(wrongShape).days, {})

    const badRecord = join(scratch, 'bad.json')
    writeFileSync(
      badRecord,
      JSON.stringify({ version: 1, days: { CNY: { date: DATE, start: '1' } } }),
      'utf8',
    )
    assert.deepEqual(loadLedger(badRecord).days, {})
  })
})
