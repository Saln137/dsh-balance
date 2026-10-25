/**
 * 本地假余额接口（只用于道具验证）：按 DeepSeek 官方 `GET /user/balance`
 * 的响应形状返回数据，用来在不接触真实凭据的前提下跑通
 * 「凭据解析 → HTTP → 解析 → 今日账本 → 快照 → 浏览器」整条链路。
 *
 * 每次查询把人民币余额按 `step` 递减，用来模拟「消费发生 → 余额下降」，
 * 这样今日消费与低余额告警都能被真实链路驱动出来。
 *
 * 用法: node scripts/verify/mock-balance.mjs [port] [startCny] [step]
 *   port      监听端口，默认 6398
 *   startCny  起始人民币余额，默认 3.30
 *   step      每次查询后递减的金额，默认 0.05
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 6398)
const startCny = Number(process.argv[3] ?? 3.3)
const decrement = Number(process.argv[4] ?? 0.05)

let total = startCny
let hits = 0

/** 保留 8 位小数，模拟平台返回的高精度金额串。 */
const money = (value) => String(Math.round(value * 1e8) / 1e8)

/** 当前钱包快照：人民币随查询递减，美元固定（用来验证多币种展示）。 */
const wallets = () => [
  {
    currency: 'CNY',
    total_balance: money(total),
    granted_balance: '0.50',
    topped_up_balance: money(Math.max(0, total - 0.5)),
  },
  { currency: 'USD', total_balance: '6.78', granted_balance: '0.00', topped_up_balance: '6.78' },
]

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (url.pathname === '/user/balance') {
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Bearer ') || auth === 'Bearer ') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'missing bearer' }))
      return
    }
    hits += 1
    const body = { is_available: true, balance_infos: wallets() }
    // 本次应答之后再扣费：第一次查询是「今日基准」，之后的查询才产生消费。
    total = Math.max(0, total - decrement)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
    console.log(`[mock] balance hit #${hits} -> CNY ${body.balance_infos[0].total_balance}`)
    return
  }

  if (url.pathname === '/hits') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ hits, total: money(total) }))
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{}')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock] listening on http://127.0.0.1:${port} (CNY ${startCny}, step ${decrement})`)
})
