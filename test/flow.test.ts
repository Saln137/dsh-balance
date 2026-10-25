/**
 * 流速：窗口速率、充值重置、断档、EMA 平滑、滞回、多币种与关闭开关。
 * 时间全部由用例传入，不依赖真实时钟。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createFlowTracker, type FlowConfig } from '../src/host/flow.ts'

/** 一分钟的毫秒数。 */
const MIN = 60_000

/** 造配置；默认 holdMs=0 便于观察档位变化，滞回另开用例。 */
function config(overrides: Partial<FlowConfig> = {}): FlowConfig {
  return {
    enabled: true,
    windowSeconds: 60,
    holdMs: 0,
    thresholds: { CNY: [0.02, 0.15, 0.6] },
    ...overrides,
  }
}

/** 造钱包。 */
function wallet(total: string, currency = 'CNY') {
  return { currency, total }
}

describe('createFlowTracker', () => {
  it('单次读数不足以判断流速', () => {
    const tracker = createFlowTracker(config(), 'auto')
    assert.equal(tracker.observe([wallet('10')], 0), null)
  })

  it('跨度不足窗口一半时不报速率', () => {
    const tracker = createFlowTracker(config(), 'auto')
    assert.equal(tracker.observe([wallet('10')], 0), null)
    // 20s 跨度 < 60s 窗口的一半（30s）
    assert.equal(tracker.observe([wallet('9.9')], 20_000), null)
  })

  it('60s 内掉 0.6 元 = 0.6/分钟 → L3', () => {
    const tracker = createFlowTracker(config(), 'auto')
    assert.equal(tracker.observe([wallet('10')], 0), null)
    tracker.observe([wallet('9.7')], 30_000)
    const flow = tracker.observe([wallet('9.4')], MIN)
    assert.equal(flow?.currency, 'CNY')
    assert.equal(flow?.ratePerMinute, '0.6000')
    assert.equal(flow?.level, 3)
    assert.equal(flow?.windowSeconds, 60)
    assert.ok((flow?.samples ?? 0) >= 3)
  })

  it('档位下界按 0.02 / 0.15 / 0.60 判定', () => {
    const levelFor = (drop: string): number => {
      const tracker = createFlowTracker(config(), 'auto')
      tracker.observe([wallet('10')], 0)
      return tracker.observe([wallet((10 - Number(drop)).toFixed(6))], MIN)?.level ?? -1
    }
    assert.equal(levelFor('0.019'), 0)
    assert.equal(levelFor('0.02'), 1)
    assert.equal(levelFor('0.149'), 1)
    assert.equal(levelFor('0.15'), 2)
    assert.equal(levelFor('0.599'), 2)
    assert.equal(levelFor('0.6'), 3)
  })

  it('余额上升视为充值：窗口重开，速率归零', () => {
    const tracker = createFlowTracker(config(), 'auto')
    tracker.observe([wallet('10')], 0)
    tracker.observe([wallet('9.4')], MIN)
    const afterTopUp = tracker.observe([wallet('109.4')], 2 * MIN)
    assert.equal(afterTopUp, null, '充值后只剩一个采样，不报速率')
    // 充值后的第一段消费重新积累
    tracker.observe([wallet('109.0')], 3 * MIN)
    const flow = tracker.observe([wallet('108.0')], 4 * MIN)
    assert.equal(flow?.level, 3)
  })

  it('两次读数间隔超过 30 分钟视为断档，不把停机算成消费', () => {
    const tracker = createFlowTracker(config(), 'auto')
    tracker.observe([wallet('10')], 0)
    const flow = tracker.observe([wallet('3')], 31 * MIN)
    assert.equal(flow, null)
  })

  it('EMA 让速率平滑爬升，而不是一步跳到最新值', () => {
    const tracker = createFlowTracker(config(), 'auto')
    tracker.observe([wallet('10')], 0)
    tracker.observe([wallet('9.7')], 30_000)
    assert.equal(tracker.observe([wallet('9.4')], MIN)?.ratePerMinute, '0.6000')
    // 窗口 [30s,90s]：9.7 → 8.8 ＝ 0.9/min；EMA = 0.6*0.6 + 0.9*0.4 = 0.72
    assert.equal(tracker.observe([wallet('8.8')], 90_000)?.ratePerMinute, '0.7200')
    // 窗口 [60s,120s]：9.4 → 8.2 ＝ 1.2/min；EMA = 0.72*0.6 + 1.2*0.4 = 0.912
    assert.equal(tracker.observe([wallet('8.2')], 2 * MIN)?.ratePerMinute, '0.9120')
  })

  it('滞回：档位要连续保持 holdMs 才切换', () => {
    const tracker = createFlowTracker(config({ holdMs: 8_000, thresholds: { CNY: [0.01, 0.02, 0.03] } }), 'auto')
    // 现实一点的采样：每 5s 一次，稳定 0.1 元/分钟。
    // 窗口跨到 30s（= minSpan）时才算得出速率，候选从那一刻开始计时。
    const balanceAt = (seconds: number): string => (10 - (0.1 * seconds) / 60).toFixed(6)

    const levels: Record<number, number> = {}
    for (let seconds = 0; seconds <= 40; seconds += 5) {
      levels[seconds] = tracker.observe([wallet(balanceAt(seconds))], seconds * 1000)?.level ?? -1
    }
    assert.equal(levels[25], -1, '25s：跨度不足，不给速率')
    assert.equal(levels[30], 0, '30s：算出 L3 但刚开始候选，保持 L0')
    assert.equal(levels[35], 0, '35s：候选只保持 5s，仍未切换')
    assert.equal(levels[40], 3, '40s：候选满 8s，切到 L3')
  })

  it('停止消费后速率快速衰减回 L0', () => {
    const tracker = createFlowTracker(config(), 'auto')
    tracker.observe([wallet('10')], 0)
    const hot = tracker.observe([wallet('9.4')], MIN)
    assert.equal(hot?.level, 3)
    // 之后余额不再变化：整个窗口速率为 0，EMA 按 ×0.25 衰减
    const rates: string[] = []
    let level: number = hot?.level ?? -1
    for (let index = 2; index <= 5; index += 1) {
      const flow = tracker.observe([wallet('9.4')], index * MIN)
      rates.push(flow?.ratePerMinute ?? 'null')
      level = flow?.level ?? -1
    }
    assert.deepEqual(rates, ['0.1500', '0.0375', '0.0094', '0.0023'])
    assert.equal(level, 0, '四个无消费采样后特效应停止')
  })

  it('关闭开关后永远不报流速', () => {
    const tracker = createFlowTracker(config({ enabled: false }), 'auto')
    tracker.observe([wallet('10')], 0)
    assert.equal(tracker.observe([wallet('9.4')], MIN), null)
  })

  it('没有配置阈值的币种不产生档位', () => {
    const tracker = createFlowTracker(config({ thresholds: {} }), 'auto')
    tracker.observe([wallet('10')], 0)
    assert.equal(tracker.observe([wallet('9.4')], MIN), null)
  })

  it('按 displayCurrency 上报对应币种的流速', () => {
    const tracker = createFlowTracker(
      config({ thresholds: { CNY: [0.02, 0.15, 0.6], USD: [0.003, 0.02, 0.09] } }),
      'USD',
    )
    tracker.observe([wallet('10'), wallet('6.78', 'USD')], 0)
    const flow = tracker.observe([wallet('9.4'), wallet('6.50', 'USD')], MIN)
    assert.equal(flow?.currency, 'USD')
    // 0.28/min 在美元阈值里属于 L3
    assert.equal(flow?.level, 3)
  })
})
