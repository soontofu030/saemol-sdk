import { createHmac, timingSafeEqual } from 'node:crypto'
import { SaemolWebhookError } from './errors.js'
import type { SaemolWebhookEvent, SaemolWebhookEventType } from './types.js'

/** 리플레이 방지 기본 허용 오차 — 5분 */
const DEFAULT_TOLERANCE_SEC = 300

const KNOWN_EVENTS: ReadonlySet<string> = new Set<SaemolWebhookEventType>([
  'order.paid',
  'order.refunded',
  'order.cancelled',
  'order.delivered',
  'entitlement.activated',
  'entitlement.revoked',
  'usage.threshold_exceeded',
  'tenant.provision_requested',
  'subscription.created',
  'subscription.renewed',
  'subscription.cancelled',
  'subscription.expired',
  'user.updated',
  'user.withdrawn',
  'product.approved',
  'product.rejected',
  'product.updated',
  'review.created',
  'review.updated',
  'review.deleted',
  'product.featured',
  'product.unfeatured',
  'product.favorited',
  'api_key.issued',
  'api_key.revoked',
  'checkout.completed',
  'team.member_invited',
  'team.member_joined',
  'team.role_changed',
  'team.member_removed',
  'payout.completed',
  'payout.held',
  'analytics.daily_summary',
  'analytics.weekly_summary',
  'analytics.monthly_summary',
])

/** Node http(IncomingMessage.headers)·Fetch Headers·일반 객체를 모두 허용 */
export type WebhookHeaders =
  | Headers
  | Record<string, string | string[] | undefined>

export interface VerifyWebhookParams {
  /** 수신 요청의 헤더 (X-Saemol-Event / X-Saemol-Timestamp / X-Saemol-Signature 포함) */
  headers: WebhookHeaders
  /** 수신 본문 원문 — 반드시 파싱 전 raw 문자열/버퍼여야 서명이 일치한다 */
  rawBody: string | Uint8Array
  /** 웹훅 서명 키 (webhook_secret) — 상품 수정 페이지의 연동 정보 카드에서 확인 */
  secret: string
  /** 타임스탬프 허용 오차(초, 기본 300 = 5분) — 초과 시 리플레이로 간주하고 거부 */
  toleranceSec?: number
  /** 테스트용 현재 시각 주입 (ms epoch) */
  now?: number
}

/**
 * 판매자 웹훅 검증 — 서명(HMAC-SHA256 `{timestamp}.{body}`)과 타임스탬프를 확인하고
 * 타입된 이벤트를 반환한다. 검증 실패 시 SaemolWebhookError를 던진다.
 *
 * 플랫폼에 새로 추가된 이벤트(이 SDK 버전이 모르는 이벤트)도 서명만 유효하면 그대로
 * 통과시킨다 — 구버전 SDK를 쓰는 판매자의 핸들러가 500으로 죽지 않게 하기 위함이다.
 * 따라서 `switch`의 `default`나 `if`의 else에서 미지의 이벤트를 무시하도록 작성할 것.
 * 명시적으로 구분하려면 `isKnownWebhookEvent()`를 사용한다.
 *
 * Next.js (App Router):
 * ```ts
 * export async function POST(req: Request) {
 *   const rawBody = await req.text()
 *   const event = verifyWebhook({ headers: req.headers, rawBody, secret: process.env.SAEMOL_WEBHOOK_SECRET! })
 *   if (event.event === 'entitlement.revoked') await blockAccess(event.data.license_key)
 *   return Response.json({ received: true })
 * }
 * ```
 *
 * Express (raw 본문 필수 — express.json() 이전에 서명을 검증한다):
 * ```ts
 * app.post('/webhooks/saemol', express.raw({ type: 'application/json' }), (req, res) => {
 *   const event = verifyWebhook({ headers: req.headers, rawBody: req.body, secret: process.env.SAEMOL_WEBHOOK_SECRET! })
 *   res.json({ received: true })
 * })
 * ```
 */
export function verifyWebhook(params: VerifyWebhookParams): SaemolWebhookEvent {
  const timestamp = getHeader(params.headers, 'x-saemol-timestamp')
  const signature = getHeader(params.headers, 'x-saemol-signature')
  if (!timestamp) throw new SaemolWebhookError('missing_header', 'X-Saemol-Timestamp 헤더가 없습니다')
  if (!signature) throw new SaemolWebhookError('missing_header', 'X-Saemol-Signature 헤더가 없습니다')

  // 리플레이 방지 — 발송 시각이 허용 오차를 벗어나면 거부
  const tsSec = Number(timestamp)
  if (!Number.isFinite(tsSec)) {
    throw new SaemolWebhookError('invalid_timestamp', `X-Saemol-Timestamp 형식 오류: ${timestamp}`)
  }
  const tolerance = params.toleranceSec ?? DEFAULT_TOLERANCE_SEC
  const nowSec = (params.now ?? Date.now()) / 1000
  if (Math.abs(nowSec - tsSec) > tolerance) {
    throw new SaemolWebhookError(
      'timestamp_out_of_tolerance',
      `웹훅 타임스탬프가 허용 오차(${tolerance}초)를 벗어났습니다 — 리플레이 가능성`,
    )
  }

  const body = typeof params.rawBody === 'string' ? params.rawBody : Buffer.from(params.rawBody).toString('utf8')
  const expected = createHmac('sha256', params.secret).update(`${timestamp}.${body}`).digest('hex')
  if (!safeEqual(expected, signature)) {
    throw new SaemolWebhookError('invalid_signature', '웹훅 서명이 일치하지 않습니다')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new SaemolWebhookError('invalid_payload', '웹훅 본문이 유효한 JSON이 아닙니다')
  }

  // 구조 검증만 수행한다. 이벤트 이름은 화이트리스트로 막지 않는다 —
  // 플랫폼에 새 이벤트가 추가돼도 구버전 SDK를 쓰는 판매자의 핸들러가 깨지지 않도록
  // 통과시키고, 처리 여부는 호출자가 switch/if의 default에서 결정한다.
  // (보안은 위 HMAC 서명 검증이 담당하며, 이름 목록은 보안에 기여하지 않는다.)
  if (
    !parsed || typeof parsed !== 'object' ||
    typeof (parsed as { event?: unknown }).event !== 'string'
  ) {
    throw new SaemolWebhookError(
      'invalid_payload',
      '웹훅 본문에 문자열 event 필드가 없습니다',
    )
  }

  return parsed as SaemolWebhookEvent
}

/**
 * 이 SDK 버전이 아는 이벤트인지 확인한다.
 * `verifyWebhook`은 모르는 이벤트도 통과시키므로, 미지의 이벤트를 로깅하거나
 * 별도 처리하고 싶을 때 사용한다.
 *
 * ```ts
 * const event = verifyWebhook({ headers, rawBody, secret })
 * if (!isKnownWebhookEvent(event.event)) {
 *   logger.info('알 수 없는 이벤트 — SDK 업그레이드 필요', event.event)
 *   return Response.json({ received: true })
 * }
 * ```
 */
export function isKnownWebhookEvent(event: string): event is SaemolWebhookEventType {
  return KNOWN_EVENTS.has(event)
}

function getHeader(headers: WebhookHeaders, name: string): string | null {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name)
  }
  const record = headers as Record<string, string | string[] | undefined>
  // Node IncomingMessage는 소문자 키 — 대소문자 혼용 입력도 수용
  const value = record[name] ?? record[name.toLowerCase()] ??
    Object.entries(record).find(([k]) => k.toLowerCase() === name)?.[1]
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}
