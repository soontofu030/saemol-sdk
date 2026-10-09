import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { Saemol } from '../../dist/esm/index.js'
import { PurchaseStore } from './store.mjs'
import { createHandlers } from './handlers.mjs'

const secret = process.env.SAEMOL_TEST_SECRET
const webhookSecret = process.env.SAEMOL_WEBHOOK_SECRET
const appToken = process.env.DEMO_APP_TOKEN
if (!secret || !webhookSecret || !appToken || !process.env.DEMO_USER_ID || !process.env.SAEMOL_ITEM_CODE) throw new Error('README의 테스트 환경 변수를 먼저 설정하세요.')
const store = new PurchaseStore(process.env.PURCHASE_DB_PATH || './purchases.sqlite')
const matches = value => { const a=Buffer.from(value || ''), b=Buffer.from(`Bearer ${appToken}`); return a.length === b.length && timingSafeEqual(a,b) }
const handlers = createHandlers({ saemol: new Saemol({ secret, baseUrl: process.env.SAEMOL_BASE_URL }), store,
  webhookSecret, resolveUserId: req => matches(req.headers.get('authorization')) ? process.env.DEMO_USER_ID : null,
  allowedItemCodes: [process.env.SAEMOL_ITEM_CODE] })
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = []; let bytes = 0
    for await (const chunk of incoming) { bytes += chunk.length; if (bytes > 1_000_000) { outgoing.writeHead(413).end(); return }; chunks.push(chunk) }
    const headers = new Headers()
    for (const [key,value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value)
    const request = new Request(`http://localhost${incoming.url}`, { method: incoming.method, headers,
      ...(!['GET','HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}) })
    const pathname = new URL(request.url).pathname
    const handler = incoming.method === 'POST' ? ({ '/checkout': handlers.checkout, '/webhooks/saemol': handlers.webhook })[pathname]
      : incoming.method === 'GET' && pathname === '/customer-portal' ? handlers.portal : null
    const response = pathname === '/health' && incoming.method === 'GET' ? Response.json({ ok: true })
      : handler ? await handler(request) : new Response(null, { status: 404 })
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)).end(await response.text())
  } catch { outgoing.writeHead(503).end() }
})
server.listen(Number(process.env.PORT || 4300), '127.0.0.1', () => console.log('테스트 결제 서버: http://127.0.0.1:' + server.address().port))
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0) }))
