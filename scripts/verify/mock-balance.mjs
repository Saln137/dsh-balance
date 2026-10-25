/**
 * 本地假余额接口（只用于道具验证）：按 DeepSeek 官方 `GET /user/balance`
 * 的响应形状返回数据，用来在不接触真实凭据的前提下跑通
 * 「凭据解析 → HTTP → 解析 → 快照 → 浏览器」整条链路。
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 6398)

const WALLETS = [
  { currency: 'CNY', total_balance: '128.4500', granted_balance: '18.45', topped_up_balance: '110.00' },
  { currency: 'USD', total_balance: '6.78', granted_balance: '0.00', topped_up_balance: '6.78' },
]

let hits = 0

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (url.pathname === '/user/balance') {
    hits += 1
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Bearer ') || auth === 'Bearer ') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'missing bearer' }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ is_available: true, balance_infos: WALLETS }))
    console.log(`[mock] balance hit #${hits}`)
    return
  }

  if (url.pathname === '/hits') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ hits }))
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{}')
})

server.listen(port, '127.0.0.1', () => console.log(`[mock] listening on http://127.0.0.1:${port}`))
