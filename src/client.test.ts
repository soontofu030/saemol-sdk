import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Saemol } from './client'
import { SaemolApiError, SaemolNetworkError } from './errors'

// ─────────────────────────────────────────────────────────────
// 모의 HTTP 서버 — 테스트마다 handler를 갈아끼우고 수신 요청을 기록한다.
// ─────────────────────────────────────────────────────────────

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void

interface RecordedRequest {
  method: string
  url: string
  headers: NodeJS.Dict<string | string[]>
  body: string
}

let server: Server
let baseUrl: string
let handler: Handler
let requests: RecordedRequest[]
/** 타임아웃 테스트에서 응답을 보류한 res — 테스트 종료 시 정리 */
let hanging: ServerResponse[]

function json(status: number, payload: unknown): Handler {
  return (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
      handler(req, res, body)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

beforeEach(() => {
  requests = []
  hanging = []
  handler = json(200, { ok: true })
})

function makeClient(overrides: Partial<ConstructorParameters<typeof Saemol>[0]> = {}) {
  return new Saemol({ secret: 'test-secret', baseUrl, retryDelayMs: 1, ...overrides })
}

// ─────────────────────────────────────────────────────────────

describe('Saemol 생성자', () => {
  it('secret 없이 생성하면 TypeError', () => {
    expect(() => new Saemol({ secret: '' })).toThrow(TypeError)
  })

  it('baseUrl 끝 슬래시를 정규화한다', async () => {
    handler = json(200, { ok: true, service: 'saemol-api', version: 'v1', time: 't' })
    await makeClient({ baseUrl: `${baseUrl}/` }).health()
    expect(requests[0].url).toBe('/api/v1/health')
  })
})

describe('health', () => {
  it('GET /api/v1/health을 호출하고 응답을 반환한다', async () => {
    handler = json(200, { ok: true, service: 'saemol-api', version: 'v1', time: '2026-07-07T00:00:00Z' })
    const res = await makeClient().health()
    expect(res.ok).toBe(true)
    expect(res.service).toBe('saemol-api')
    expect(requests[0].method).toBe('GET')
  })
})

describe('analytics', () => {
  const payload = {
    product_id: 'prod-1',
    period: 30,
    timezone: 'Asia/Seoul',
    days: [{
      date: '2026-07-20', views: 10, favorites: 2, orders: 3, paid_orders: 2,
      revenue: 20000, refunds: 0, refund_amount: 0, verify_calls: 5, usage_reports: 1,
    }],
    totals: {
      views: 10, favorites: 2, orders: 3, paid_orders: 2, revenue: 20000,
      refunds: 0, refund_amount: 0, verify_calls: 5, usage_reports: 1, conversion_rate: 20,
    },
  }

  it('GET /api/v1/analytics/summary — period 쿼리 전송·집계 반환', async () => {
    handler = json(200, payload)
    const res = await makeClient().analytics({ period: 30 })

    expect(res.totals.revenue).toBe(20000)
    expect(res.totals.conversion_rate).toBe(20)
    expect(res.days[0].date).toBe('2026-07-20')

    const req = requests[0]
    expect(req.method).toBe('GET')
    expect(req.url).toBe('/api/v1/analytics/summary?period=30')
    expect(req.headers['x-saemol-secret']).toBe('test-secret')
  })

  it('period 미지정 시 쿼리 없이 호출한다 (서버 기본값 사용)', async () => {
    handler = json(200, payload)
    await makeClient().analytics()
    expect(requests[0].url).toBe('/api/v1/analytics/summary')
  })

  it('503은 재시도한다 (조회 전용 — 멱등)', async () => {
    let n = 0
    handler = (_req, res) => {
      n++
      if (n === 1) { res.writeHead(503); res.end('{}'); return }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    const res = await makeClient({ retryDelayMs: 1 }).analytics()
    expect(res.product_id).toBe('prod-1')
    expect(n).toBe(2)
  })

  it('401(시크릿 불일치)은 SaemolApiError를 던진다', async () => {
    handler = json(401, { error: 'invalid secret' })
    await expect(makeClient().analytics()).rejects.toBeInstanceOf(SaemolApiError)
  })
})

describe('checkUpdate', () => {
  it('POST /api/v1/updates/check — current_version 전송·응답 반환', async () => {
    handler = json(200, {
      product_id: 'prod-1', latest_version: '1.4.0', update_available: true,
      update_required: false, min_version: null, download_url: 'https://dl', release_notes: '노트',
    })
    const res = await makeClient().checkUpdate({ currentVersion: '1.2.0' })
    expect(res.update_available).toBe(true)
    expect(res.latest_version).toBe('1.4.0')

    const req = requests[0]
    expect(req.url).toBe('/api/v1/updates/check')
    expect(req.headers['x-saemol-secret']).toBe('test-secret')
    expect(JSON.parse(req.body)).toEqual({ current_version: '1.2.0' })
  })

  it('파라미터 없이 호출하면 빈 본문으로 POST한다', async () => {
    handler = json(200, {
      product_id: 'prod-1', latest_version: null, update_available: false,
      update_required: false, min_version: null, download_url: null, release_notes: null,
    })
    const res = await makeClient().checkUpdate()
    expect(res.latest_version).toBeNull()
    expect(JSON.parse(requests[0].body)).toEqual({})
  })
})

describe('currentUser', () => {
  it('POST /api/v1/users/current — 구매자 컨텍스트 반환 (유니언 내로잉)', async () => {
    handler = json(200, {
      found: true, entitlement_id: 'ent-1', kind: 'license', status: 'active',
      plan_name: 'Pro', is_trial: false, expires_at: null,
      user: { id: 'u-1', name: '구매자', email: 'buyer@example.com' },
    })
    const res = await makeClient().currentUser({ licenseKey: 'MF-1' })
    expect(res.found).toBe(true)
    if (res.found) expect(res.user.email).toBe('buyer@example.com')
    expect(JSON.parse(requests[0].body)).toEqual({ license_key: 'MF-1' })
  })

  it('404(키 미존재)는 던지지 않고 found:false 본문을 반환한다', async () => {
    handler = json(404, { found: false, reason: '유효하지 않은 키입니다' })
    const res = await makeClient().currentUser({ apiKey: 'mfk-gone' })
    expect(res.found).toBe(false)
    if (!res.found) expect(res.reason).toBe('유효하지 않은 키입니다')
    expect(JSON.parse(requests[0].body)).toEqual({ api_key: 'mfk-gone' })
  })
})

describe('verifyLicense', () => {
  it('시크릿 헤더와 snake_case 본문으로 POST한다', async () => {
    handler = json(200, {
      valid: true, status: 'active', kind: 'license', plan_name: 'Pro', sku: null,
      devices: { registered: 1, limit: 2 }, expires_at: null, is_trial: false,
    })
    const res = await makeClient().verifyLicense({ licenseKey: 'MF-1', deviceId: 'dev-1', version: '2.0' })

    expect(res.valid).toBe(true)
    if (res.valid) expect(res.devices).toEqual({ registered: 1, limit: 2 })

    const req = requests[0]
    expect(req.url).toBe('/api/v1/licenses/verify')
    expect(req.headers['x-saemol-secret']).toBe('test-secret')
    expect(JSON.parse(req.body)).toEqual({ license_key: 'MF-1', device_id: 'dev-1', version: '2.0' })
  })

  it('선택 파라미터 미전송 시 본문에서 키 자체를 뺀다', async () => {
    handler = json(200, { valid: false, reason: 'revoked', status: 'revoked' })
    await makeClient().verifyLicense({ licenseKey: 'MF-1' })
    expect(JSON.parse(requests[0].body)).toEqual({ license_key: 'MF-1' })
  })

  it('404(유효하지 않은 키)는 던지지 않고 valid:false 본문을 반환한다', async () => {
    handler = json(404, { valid: false, reason: '유효하지 않은 키입니다' })
    const res = await makeClient().verifyLicense({ licenseKey: 'MF-gone' })
    expect(res.valid).toBe(false)
    if (!res.valid) expect(res.reason).toBe('유효하지 않은 키입니다')
  })

  it('401(시크릿 불일치)은 SaemolApiError를 던진다', async () => {
    handler = json(401, { valid: false, reason: '연동 시크릿이 일치하지 않습니다' })
    const err = await makeClient().verifyLicense({ licenseKey: 'MF-1' }).catch(e => e)
    expect(err).toBeInstanceOf(SaemolApiError)
    expect(err.status).toBe(401)
    expect(err.reason).toBe('연동 시크릿이 일치하지 않습니다')
  })

  it('503은 재시도 후 성공을 반환한다 (멱등 호출)', async () => {
    let calls = 0
    handler = (req, res, body) => {
      calls++
      ;(calls < 3 ? json(503, { error: 'unavailable' }) : json(200, { valid: false, reason: 'expired' }))(req, res, body)
    }
    const res = await makeClient({ maxRetries: 2 }).verifyLicense({ licenseKey: 'MF-1' })
    expect(calls).toBe(3)
    expect(res.valid).toBe(false)
  })

  it('재시도 소진 시 마지막 SaemolApiError를 던진다', async () => {
    handler = json(503, null)
    const err = await makeClient({ maxRetries: 1 }).verifyLicense({ licenseKey: 'MF-1' }).catch(e => e)
    expect(err).toBeInstanceOf(SaemolApiError)
    expect(err.status).toBe(503)
    expect(requests).toHaveLength(2)
  })

  it('타임아웃 시 SaemolNetworkError(timedOut)를 던진다', async () => {
    handler = (_req, res) => { hanging.push(res) } // 응답 보류
    const err = await makeClient({ timeoutMs: 100, maxRetries: 0 })
      .verifyLicense({ licenseKey: 'MF-1' })
      .catch(e => e)
    hanging.forEach(res => res.destroy())
    expect(err).toBeInstanceOf(SaemolNetworkError)
    expect(err.timedOut).toBe(true)
  })
})

describe('verifyEntitlement', () => {
  it('api_key 본문으로 POST하고 전체 응답을 반환한다', async () => {
    handler = json(200, {
      valid: true, status: 'active', kind: 'subscription', plan_name: 'Pro',
      plan_features: ['core'], rate_limit_per_min: 60, usage: null,
      current_period_end: '2026-08-07T00:00:00Z', expires_at: null, is_trial: false,
    })
    const res = await makeClient().verifyEntitlement({ apiKey: 'mfk_1' })
    expect(res.valid).toBe(true)
    if (res.reason === undefined) expect(res.plan_features).toEqual(['core'])
    expect(JSON.parse(requests[0].body)).toEqual({ api_key: 'mfk_1' })
    expect(requests[0].url).toBe('/api/v1/entitlements/verify')
  })

  it('version_not_allowed 거부 응답을 그대로 반환한다', async () => {
    handler = json(200, { valid: false, reason: 'version_not_allowed', status: 'active', version: '3.0', allowed_versions: ['1.0'] })
    const res = await makeClient().verifyEntitlement({ apiKey: 'mfk_1', version: '3.0' })
    expect(res.valid).toBe(false)
    if (res.reason) expect(res.allowed_versions).toEqual(['1.0'])
  })
})

describe('reportUsage', () => {
  it('성공 응답을 반환한다', async () => {
    handler = json(200, {
      accepted: true, allowed: true,
      usage: { unit: 'API 호출', used: 120, limit: 1000, remaining: 880 },
      overage_policy: 'notify', over_limit: false,
    })
    const res = await makeClient().reportUsage({ apiKey: 'mfk_1', quantity: 120, metadata: { endpoint: '/convert' } })
    expect(res.accepted).toBe(true)
    if (res.accepted) expect(res.usage.remaining).toBe(880)
    expect(JSON.parse(requests[0].body)).toEqual({ api_key: 'mfk_1', quantity: 120, metadata: { endpoint: '/convert' } })
  })

  it('중복 집계 방지 — 503이어도 재시도하지 않는다', async () => {
    handler = json(503, null)
    const err = await makeClient({ maxRetries: 5 }).reportUsage({ apiKey: 'mfk_1', quantity: 1 }).catch(e => e)
    expect(err).toBeInstanceOf(SaemolApiError)
    expect(requests).toHaveLength(1)
  })

  it('400(사용량 상품 아님 등)은 SaemolApiError를 던진다', async () => {
    handler = json(400, { accepted: false, reason: '사용량 기반 상품의 키가 아닙니다' })
    const err = await makeClient().reportUsage({ apiKey: 'mfk_1', quantity: 1 }).catch(e => e)
    expect(err).toBeInstanceOf(SaemolApiError)
    expect(err.status).toBe(400)
  })
})
