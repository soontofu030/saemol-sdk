import { describe, it, expect } from 'vitest'
import { Saemol } from './client'
import { SaemolApiError } from './errors'

describe('SDK response tracing', () => {
  it('retains the failed request ID and isolates observer failures', async () => {
    const observed: unknown[] = []
    const sdk = new Saemol({ secret: 'PRIVATE-SECRET', maxRetries: 0,
      fetch: async () => Response.json({ error: 'insufficient_key_scope' }, { status: 403, headers: { 'X-Request-Id': 'trace-1' } }),
      onResponse: info => { observed.push(info); throw new Error('observer failed') },
    })
    await expect(sdk.customerPortal()).rejects.toMatchObject({ status: 403, requestId: 'trace-1' })
    expect(observed).toEqual([{ path: '/api/v1/customer-portal', status: 403, requestId: 'trace-1', attempt: 1 }])
    expect(JSON.stringify(observed)).not.toContain('PRIVATE-SECRET')
  })
  it('legacy error construction remains supported', () => {
    expect(new SaemolApiError(401, { error: 'bad_secret' }).requestId).toBeNull()
  })
})
