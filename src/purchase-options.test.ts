import { describe, expect, it, vi } from 'vitest'
import { Saemol } from './client.js'
import { validApiResponse } from './response.js'

describe('hosted purchase options', () => {
  it('builds a credential-free purchase URL with an encoded option', () => {
    const sdk = new Saemol({ secret: 'server-only' })
    expect(sdk.getPurchaseUrl({ productId: 'product-id', itemCode: 'team_year' })).toBe('https://saemol.com/products/product-id?option=team_year')
  })
  it('sends pack count and item code, never a price or seller ID', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ session_id: 'session', url: 'https://saemol.com/checkout/token', expires_at: '2026-11-12' }))
    const sdk = new Saemol({ secret: 'test_secret', fetch: fetcher })
    await sdk.createCheckout({ itemCode: 'credits', quantity: 3 })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ item_code: 'credits', quantity: 3 })
  })
  it('rejects malformed sales totals rather than certifying external revenue', () => {
    expect(validApiResponse('/api/v1/analytics/summary?view=commerce', { source: 'verified_payments', gross_sales: '1000', options: [] })).toBe(false)
  })
})
