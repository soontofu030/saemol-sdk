import { afterEach,expect,it,vi } from 'vitest'
import { Saemol } from './client.js'
const policy={version:'2026-10-27',provider:'inicis',live_checkout_ready:false,billing_ready:false,conditional_payout_ready:false,reason:'계약 확인 중',terms_url:'https://saemol.com/payment',seller_terms_url:'https://saemol.com/seller-terms',refund_url:'https://saemol.com/refund',notice:'기존 구매 권리는 유지됩니다.'}
afterEach(()=>vi.unstubAllGlobals())
it('reads authoritative commerce readiness without interpreting a closed gate as an API failure',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(policy))))
  const result=await new Saemol({secret:'server-only'}).getCommercePolicy()
  expect(result.live_checkout_ready).toBe(false)
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('https://saemol.com/api/v1/commerce/policy')
})
it('rejects malformed provider policy responses',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...policy,billing_ready:'yes'}))))
  await expect(new Saemol({secret:'server-only'}).getCommercePolicy()).rejects.toThrow()
})
it('binds the approved service origin and preserves the purchase-attempt idempotency key',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({session_id:'session',url:'https://saemol.com/checkout/token',expires_at:'2026-10-27T12:00:00Z'}))))
  await new Saemol({secret:'server-only'}).createCheckout({itemCode:'approved-item',serviceOrigin:'https://seller.example',idempotencyKey:'attempt-1'})
  const init=vi.mocked(fetch).mock.calls[0][1]
  expect(JSON.parse(String(init?.body))).toEqual({item_code:'approved-item',service_origin:'https://seller.example'})
  expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('attempt-1')
})
