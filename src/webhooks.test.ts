import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SaemolWebhookError } from './errors'
import { verifyWebhook } from './webhooks'

// 플랫폼 발송 로직(lib/fulfillment/webhooks.ts)과 동일한 서명 생성
function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

const SECRET = 'whsec_test'
const NOW = 1_783_219_000_000 // ms

function makeWebhook(overrides: {
  event?: string
  secret?: string
  timestamp?: string
  tamperBody?: boolean
} = {}) {
  const timestamp = overrides.timestamp ?? String(Math.floor(NOW / 1000))
  const body = JSON.stringify({
    event: overrides.event ?? 'entitlement.activated',
    product_id: 'prod-1',
    data: {
      entitlement_id: 'ent-1', order_id: 'order-1', order_number: 'MF-1',
      kind: 'license', plan_name: 'Pro', license_key: 'MF-KEY', api_key: null, buyer_id: 'buyer-1',
    },
    sent_at: '2026-07-07T00:00:00Z',
  })
  const signature = sign(overrides.secret ?? SECRET, timestamp, body)
  const rawBody = overrides.tamperBody ? body.replace('MF-KEY', 'MF-EVIL') : body
  return {
    rawBody,
    headers: {
      'x-saemol-event': 'entitlement.activated',
      'x-saemol-timestamp': timestamp,
      'x-saemol-signature': signature,
    } as Record<string, string>,
  }
}

function codeOf(fn: () => unknown): SaemolWebhookError['code'] | null {
  try {
    fn()
    return null
  } catch (err) {
    if (err instanceof SaemolWebhookError) return err.code
    throw err
  }
}

describe('verifyWebhook — 정상 검증', () => {
  it('유효한 서명이면 타입된 이벤트를 반환한다', () => {
    const { headers, rawBody } = makeWebhook()
    const event = verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW })
    expect(event.event).toBe('entitlement.activated')
    expect(event.product_id).toBe('prod-1')
    if (event.event === 'entitlement.activated') {
      expect(event.data.license_key).toBe('MF-KEY') // 유니언 내로잉으로 data가 타이핑됨
    }
  })

  it('주문 이벤트 3종(order.paid/refunded/delivered)도 알려진 이벤트로 통과한다', () => {
    for (const eventName of ['order.paid', 'order.refunded', 'order.delivered'] as const) {
      const { headers, rawBody } = makeWebhook({ event: eventName })
      const event = verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW })
      expect(event.event).toBe(eventName)
    }
  })

  it('Fetch Headers 인스턴스도 받는다 (Next.js Route Handler)', () => {
    const { headers, rawBody } = makeWebhook()
    const event = verifyWebhook({ headers: new Headers(headers), rawBody, secret: SECRET, now: NOW })
    expect(event.event).toBe('entitlement.activated')
  })

  it('대소문자 혼용 헤더 키도 받는다', () => {
    const { headers, rawBody } = makeWebhook()
    const mixed = {
      'X-Saemol-Event': headers['x-saemol-event'],
      'X-Saemol-Timestamp': headers['x-saemol-timestamp'],
      'X-Saemol-Signature': headers['x-saemol-signature'],
    }
    expect(verifyWebhook({ headers: mixed, rawBody, secret: SECRET, now: NOW }).event).toBe('entitlement.activated')
  })

  it('Uint8Array 본문도 받는다 (express.raw)', () => {
    const { headers, rawBody } = makeWebhook()
    const event = verifyWebhook({ headers, rawBody: new TextEncoder().encode(rawBody), secret: SECRET, now: NOW })
    expect(event.event).toBe('entitlement.activated')
  })

  it('6종 이벤트 모두 통과한다', () => {
    for (const name of [
      'entitlement.activated', 'entitlement.revoked', 'usage.threshold_exceeded',
      'tenant.provision_requested', 'subscription.renewed', 'subscription.expired',
    ]) {
      const { headers, rawBody } = makeWebhook({ event: name })
      expect(verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW }).event).toBe(name)
    }
  })
})

describe('verifyWebhook — 거부', () => {
  it('다른 시크릿으로 서명된 요청은 invalid_signature', () => {
    const { headers, rawBody } = makeWebhook({ secret: 'whsec_forged' })
    expect(codeOf(() => verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW }))).toBe('invalid_signature')
  })

  it('본문이 변조되면 invalid_signature', () => {
    const { headers, rawBody } = makeWebhook({ tamperBody: true })
    expect(codeOf(() => verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW }))).toBe('invalid_signature')
  })

  it('5분보다 오래된 타임스탬프는 리플레이로 거부한다', () => {
    const old = String(Math.floor(NOW / 1000) - 301)
    const { headers, rawBody } = makeWebhook({ timestamp: old })
    expect(codeOf(() => verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW }))).toBe('timestamp_out_of_tolerance')
  })

  it('미래로 치우친 타임스탬프도 거부한다', () => {
    const future = String(Math.floor(NOW / 1000) + 301)
    const { headers, rawBody } = makeWebhook({ timestamp: future })
    expect(codeOf(() => verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW }))).toBe('timestamp_out_of_tolerance')
  })

  it('toleranceSec로 허용 오차를 조정할 수 있다', () => {
    const old = String(Math.floor(NOW / 1000) - 301)
    const { headers, rawBody } = makeWebhook({ timestamp: old })
    expect(verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW, toleranceSec: 600 }).event)
      .toBe('entitlement.activated')
  })

  it('서명 헤더 누락은 missing_header', () => {
    const { headers, rawBody } = makeWebhook()
    delete headers['x-saemol-signature']
    expect(codeOf(() => verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW }))).toBe('missing_header')
  })

  it('숫자가 아닌 타임스탬프는 invalid_timestamp', () => {
    const { headers, rawBody } = makeWebhook()
    headers['x-saemol-timestamp'] = 'abc'
    expect(codeOf(() => verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW }))).toBe('invalid_timestamp')
  })

  it('알 수 없는 이벤트명은 invalid_payload', () => {
    const { headers, rawBody } = makeWebhook({ event: 'order.hacked' })
    expect(codeOf(() => verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW }))).toBe('invalid_payload')
  })

  it('서명은 맞지만 JSON이 아닌 본문은 invalid_payload', () => {
    const timestamp = String(Math.floor(NOW / 1000))
    const rawBody = 'not-json'
    const headers = {
      'x-saemol-timestamp': timestamp,
      'x-saemol-signature': sign(SECRET, timestamp, rawBody),
    }
    expect(codeOf(() => verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW }))).toBe('invalid_payload')
  })
})

describe('verifyWebhook — 확장 이벤트 카탈로그 (2026-07-15)', () => {
  function makeCustomWebhook(event: string, productId: string | null, data: Record<string, unknown>) {
    const timestamp = String(Math.floor(NOW / 1000))
    const body = JSON.stringify({ event, product_id: productId, data, sent_at: '2026-07-15T00:00:00Z' })
    return {
      rawBody: body,
      headers: {
        'x-saemol-timestamp': timestamp,
        'x-saemol-signature': sign(SECRET, timestamp, body),
      } as Record<string, string>,
    }
  }

  it('user.withdrawn — User Event를 수신·내로잉한다', () => {
    const { headers, rawBody } = makeCustomWebhook('user.withdrawn', 'prod-1', { user_id: 'user-1' })
    const event = verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW })
    expect(event.event).toBe('user.withdrawn')
    if (event.event === 'user.withdrawn') expect(event.data.user_id).toBe('user-1')
  })

  it('analytics.daily_summary — 판매자 계정 단위 이벤트는 product_id가 null', () => {
    const { headers, rawBody } = makeCustomWebhook('analytics.daily_summary', null, {
      period_start: '2026-07-14', period_end: '2026-07-14', totals: { view: 10 },
    })
    const event = verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW })
    expect(event.event).toBe('analytics.daily_summary')
    expect(event.product_id).toBeNull()
  })

  it('신규 이벤트 전체가 KNOWN_EVENTS에 등록되어 있다', () => {
    const added = [
      'order.cancelled', 'subscription.created', 'subscription.cancelled',
      'user.updated', 'user.withdrawn',
      'product.approved', 'product.rejected', 'product.updated',
      'review.created', 'review.deleted',
      'product.featured', 'product.unfeatured', 'product.favorited',
      'api_key.issued', 'api_key.revoked',
      'team.member_invited', 'team.member_joined', 'team.role_changed', 'team.member_removed',
      'payout.completed', 'payout.held',
      'analytics.daily_summary', 'analytics.weekly_summary', 'analytics.monthly_summary',
    ]
    for (const event of added) {
      const { headers, rawBody } = makeCustomWebhook(event, 'prod-1', {})
      expect(verifyWebhook({ headers, rawBody, secret: SECRET, now: NOW }).event).toBe(event)
    }
  })
})
