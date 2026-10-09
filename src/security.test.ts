import { describe, expect, it, vi } from 'vitest'
import { Saemol } from './client'
import { SaemolOAuth, isSubscriptionActive, hasPlanFeature } from './oauth'
import { SaemolNetworkError } from './errors'
import type { OAuthUserInfo } from './types'

describe('invalid protocol responses never authorize access', () => {
  it('only keyed writes retry and keep the exact body and key', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(Response.json({
      accepted: true, allowed: true, usage: { used: 1, unit: null, limit: null, remaining: null }, overage_policy: 'block', over_limit: false,
    }))
    await new Saemol({ secret: 's', fetch, retryDelayMs: 0 }).reportUsage({ apiKey: 'key', quantity: 1, idempotencyKey: 'job-1' })
    expect(fetch).toHaveBeenCalledTimes(2)
    const first = fetch.mock.calls[0][1]
    const second = fetch.mock.calls[1][1]
    expect(first.headers['Idempotency-Key']).toBe('job-1')
    expect(second.body).toBe(first.body)
    expect(second.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key'])
    const unkeyed = vi.fn().mockRejectedValue(new Error('lost response'))
    await expect(new Saemol({ secret: 's', fetch: unkeyed }).reportUsage({ apiKey: 'key', quantity: 1 })).rejects.toBeInstanceOf(SaemolNetworkError)
    expect(unkeyed).toHaveBeenCalledTimes(1)
  })
  it('does not retry a conflicting idempotency key', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ reason: 'idempotency_conflict' }, { status: 409 }))
    await expect(new Saemol({ secret: 's', fetch }).createCheckout({ itemCode: 'pro', idempotencyKey: 'one' })).rejects.toMatchObject({ status: 409 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('checks fresh feature membership and denies expired access', async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({ valid: true, status: 'active', kind: 'subscription',
      current_period_end: null, expires_at: null, plan_features: ['export'], plan_name: 'Pro', is_trial: false, rate_limit_per_min: null, usage: null }))
    const client = new Saemol({ secret: 's', fetch })
    expect(await client.canAccess({ apiKey: 'key', feature: 'export' })).toBe(true)
    expect(await client.canAccess({ apiKey: 'key', feature: 'admin' })).toBe(false)
    fetch.mockImplementation(async () => Response.json({ valid: true, status: 'active', kind: 'subscription', current_period_end: new Date(0).toISOString(), expires_at: null, plan_features: null, plan_name: null, is_trial: false, rate_limit_per_min: null, usage: null }))
    expect(await client.canAccess({ apiKey: 'key' })).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('returns the authenticated portal and an application receipt', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ url: 'https://saemol.com/mypage/services/seller', requires_login: true }))
      .mockResolvedValueOnce(Response.json({ recorded: true, session_id: 'session', applied_at: new Date().toISOString() }))
    const client = new Saemol({ secret: 's', fetch })
    expect((await client.customerPortal()).requires_login).toBe(true)
    expect((await client.acknowledgeCheckout({ sessionId: 'session' })).recorded).toBe(true)
    expect(fetch.mock.calls[1][0]).toMatch(/\/session\/acknowledge$/)
  })
  it.each([null, [], {}, 'ok', { valid: 'true' }, { valid: true, status: 'active', kind: 'license' }])('rejects malformed license response %j', async body => {
    const fetch = vi.fn().mockResolvedValue(Response.json(body))
    await expect(new Saemol({ secret: 's', fetch, maxRetries: 0 }).verifyLicense({ licenseKey: 'key' })).rejects.toBeInstanceOf(SaemolNetworkError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('malformed soft 404 is an error, never null permission data', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('<html/>', { status: 404 }))
    await expect(new Saemol({ secret: 's', fetch, maxRetries: 0 }).verifyEntitlement({ apiKey: 'key' })).rejects.toBeInstanceOf(SaemolNetworkError)
  })
  it.each(['exchangeCode', 'refresh', 'getUserInfo'] as const)('rejects corrupt OAuth %s without repeating token writes', async method => {
    const fetch = vi.fn().mockResolvedValue(Response.json(null))
    const oauth = new SaemolOAuth({ clientId: 'c', clientSecret: 's', redirectUri: 'https://example.test/cb', fetch })
    const request = method === 'exchangeCode' ? oauth.exchangeCode({ code: 'code' })
      : method === 'refresh' ? oauth.refresh({ refreshToken: 'token' }) : oauth.getUserInfo({ accessToken: 'token' })
    await expect(request).rejects.toMatchObject({ code: 'invalid_response' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['', ' '])('rejects empty expected state %j', async expectedState => {
    const fetch = vi.fn()
    const oauth = new SaemolOAuth({ clientId: 'c', clientSecret: 's', fetch })
    await expect(oauth.handleCallback({ url: '?code=x&state=x', expectedState })).rejects.toMatchObject({ code: 'state_mismatch' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('cached valid=true cannot keep an expired or revoked subscription open', () => {
    const now = Date.parse('2026-10-04T12:00:00Z')
    const user: OAuthUserInfo = { sub: 'u', name: null, email: null, product_id: 'p', scope: 'entitlement', entitlement: {
      valid: true, status: 'active', kind: 'subscription', plan_name: 'Pro', plan_features: ['export'], is_trial: false,
      current_period_end: new Date(now).toISOString(), expires_at: null,
    } }
    expect(isSubscriptionActive(user, now)).toBe(false)
    user.entitlement!.current_period_end = 'invalid'
    expect(isSubscriptionActive(user, now)).toBe(false)
    user.entitlement!.current_period_end = null
    user.entitlement!.status = 'revoked'
    expect(hasPlanFeature(user, 'export')).toBe(false)
    user.entitlement!.status = 'active'
    expect(isSubscriptionActive(user, now)).toBe(true)
  })
})
