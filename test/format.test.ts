/**
 * 展示格式化：金额只在这里收敛成「符号 + 两位小数 + 千分位」。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { currencySymbol, formatAmount, formatClock, parseAmount, pickPrimaryWallet, secondsSince } from '../src/shared/format.ts'

describe('currencySymbol', () => {
  it('已知币种给符号，未知币种给代码前缀', () => {
    assert.equal(currencySymbol('CNY'), '¥')
    assert.equal(currencySymbol('usd'), '$')
    assert.equal(currencySymbol('EUR'), 'EUR ')
  })
})

describe('parseAmount', () => {
  it('接受服务端的各种十进制写法', () => {
    assert.equal(parseAmount('8.79'), 8.79)
    assert.equal(parseAmount('9.9902690000000000'), 9.990269)
    assert.equal(parseAmount('0E-16'), 0)
    assert.equal(parseAmount('-1.5'), -1.5)
  })

  it('缺失或非法返回 undefined（不伪造 0）', () => {
    assert.equal(parseAmount(undefined), undefined)
    assert.equal(parseAmount(null), undefined)
    assert.equal(parseAmount(''), undefined)
    assert.equal(parseAmount('   '), undefined)
    assert.equal(parseAmount('abc'), undefined)
    assert.equal(parseAmount('Infinity'), undefined)
  })
})

describe('formatAmount', () => {
  it('两位小数 + 千分位 + 币种符号', () => {
    assert.equal(formatAmount('9.9902690000000000', 'CNY'), '¥9.99')
    assert.equal(formatAmount('8.7', 'CNY'), '¥8.70')
    assert.equal(formatAmount('1234.5', 'USD'), '$1,234.50')
    assert.equal(formatAmount('0E-16', 'CNY'), '¥0.00')
    assert.equal(formatAmount('1234567.891', 'CNY'), '¥1,234,567.89')
  })

  it('负数保留符号在币种之前', () => {
    assert.equal(formatAmount('-3.2', 'CNY'), '-¥3.20')
  })

  it('未知币种用代码前缀', () => {
    assert.equal(formatAmount('5', 'EUR'), 'EUR 5.00')
  })

  it('非法金额显示占位符', () => {
    assert.equal(formatAmount(undefined, 'CNY'), '—')
    assert.equal(formatAmount('oops', 'CNY'), '—')
  })
})

describe('pickPrimaryWallet', () => {
  const wallets = [
    { currency: 'CNY', total: '8.79' },
    { currency: 'USD', total: '1.20' },
  ]

  it('auto 取第一个（服务端顺序即主币种顺序）', () => {
    assert.equal(pickPrimaryWallet(wallets, 'auto')?.currency, 'CNY')
  })

  it('指定币种时精确匹配', () => {
    assert.equal(pickPrimaryWallet(wallets, 'USD')?.currency, 'USD')
  })

  it('指定币种不存在时回落第一个，而不是空标签', () => {
    const onlyUsd = [{ currency: 'USD', total: '1.20' }]
    assert.equal(pickPrimaryWallet(onlyUsd, 'CNY')?.currency, 'USD')
  })

  it('空列表返回 undefined', () => {
    assert.equal(pickPrimaryWallet([], 'auto'), undefined)
  })
})

describe('时间', () => {
  it('formatClock 补零到 HH:MM:SS', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5)
    assert.equal(formatClock(date.getTime()), '03:04:05')
  })

  it('secondsSince 不为负', () => {
    assert.equal(secondsSince(1_000, 4_500), 4)
    assert.equal(secondsSince(5_000, 4_000), 0)
  })
})
