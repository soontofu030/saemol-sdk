import { verifyWebhook, SaemolWebhookError, SaemolApiError } from '../../dist/esm/index.js'
import { createHash } from 'node:crypto'

const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 200
export function createHandlers({ saemol, store, webhookSecret, resolveUserId, allowedItemCodes }) {
  if (!webhookSecret || typeof resolveUserId !== 'function' || !allowedItemCodes?.length) throw new Error('연동 키·로그인 확인·판매 아이템을 설정하세요.')
  return {
    async checkout(req) {
      const userId = await resolveUserId(req)
      if (!identifier(userId)) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 })
      let body
      try { body = await req.json() } catch { return Response.json({ error: '요청을 확인해주세요.' }, { status: 400 }) }
      if (!body || !allowedItemCodes.includes(body.itemCode) || !identifier(body.purchaseAttemptId)) return Response.json({ error: '판매 아이템과 구매 시도 ID를 확인해주세요.' }, { status: 400 })
      // Do not accept an external user ID or price from the caller.
      try { return Response.json(await saemol.createCheckout({ itemCode: body.itemCode, externalUserId: userId,
        idempotencyKey: createHash('sha256').update(`${userId}:${body.purchaseAttemptId}`).digest('hex') })) }
      catch (error) { return Response.json({ error: error instanceof SaemolApiError && error.status === 409 ? '같은 구매 시도의 내용이 바뀌었습니다.' : '결제창을 준비하지 못했습니다. 같은 구매 시도로 다시 확인하세요.' }, { status: error instanceof SaemolApiError && error.status === 409 ? 409 : 503 }) }
    },
    async webhook(req) {
      const rawBody = await req.text()
      if (Buffer.byteLength(rawBody) > 1_000_000) return new Response(null, { status: 413 })
      let event
      try { event = verifyWebhook({ headers: req.headers, rawBody, secret: webhookSecret }) }
      catch (error) { if (error instanceof SaemolWebhookError) return Response.json({ error: '웹훅을 검증하지 못했습니다.' }, { status: 400 }); throw error }
      if (!['checkout.completed', 'order.refunded', 'entitlement.revoked'].includes(event.event)) return Response.json({ ignored: true })
      const d = event.data
      if (!identifier(d.order_id)) return Response.json({ ignored: true })
      const eventId = `${event.event}:${event.event_id ?? d.order_id}`
      try {
        if (event.event !== 'checkout.completed') {
          store.apply({ eventId, orderId: d.order_id, revoke: true })
          return Response.json({ received: true })
        }
        if (!identifier(d.session_id) || !identifier(d.external_user_id) || !allowedItemCodes.includes(d.item_code)) return Response.json({ error: '구매 적용 정보를 확인해주세요.' }, { status: 400 })
        const current = await saemol.getCheckout({ sessionId: d.session_id })
        if (current.order_id !== d.order_id || current.external_user_id !== d.external_user_id || current.item_code !== d.item_code) return Response.json({ error: '구매 정보가 일치하지 않습니다.' }, { status: 400 })
        if (current.status !== 'completed' || current.entitlement?.status !== 'active') {
          store.apply({ eventId, orderId: d.order_id, revoke: true })
          return Response.json({ received: true, applied: false })
        }
        const applied = store.apply({ eventId, orderId: d.order_id, userId: d.external_user_id,
          itemCode: d.item_code, quantity: Number.isFinite(d.quantity) && d.quantity > 0 ? d.quantity : null })
        if (applied.active) {
          try { await saemol.acknowledgeCheckout({ sessionId: d.session_id }) }
          catch (error) {
            if (!(error instanceof SaemolApiError) || error.status !== 409) throw error
            store.apply({ eventId: `inactive:${d.order_id}`, orderId: d.order_id, revoke: true })
            return Response.json({ received: true, applied: false })
          }
        }
        return Response.json({ received: true, applied: applied.active })
      } catch { return Response.json({ error: '구매 적용을 다시 확인해야 합니다.' }, { status: 503 }) }
    },
    async portal(req) {
      if (!identifier(await resolveUserId(req))) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 })
      try { return Response.json(await saemol.customerPortal()) }
      catch { return Response.json({ error: '관리 주소를 불러오지 못했습니다.' }, { status: 503 }) }
    },
  }
}
