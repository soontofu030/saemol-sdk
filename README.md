# @saemol/sdk

Saemol seller integration SDK for Node.js — verify licenses, check entitlements, report usage, and validate webhooks with a few lines of code.

새몰 판매자 연동 SDK — 라이선스 검증·권한 확인·사용량 리포팅·웹훅 서명 검증을 몇 줄의 코드로 처리합니다.

- **Zero runtime dependencies** — uses built-in `fetch` (Node.js 18+)
- **TypeScript types included** — responses are typed 1:1 with the platform API
- **CJS & ESM** dual build
- Full documentation (Korean): https://saemol.com/docs

## Install

```bash
npm install @saemol/sdk
```

> ⚠️ Server-side only. Never ship your integration secret to browsers or mobile apps.
> 서버 전용입니다. 연동 시크릿을 브라우저·모바일 앱에 포함하지 마세요.

## Quick start · 빠른 시작

Get your integration secret from the **integration info card** on your product edit page (판매자 대시보드 → 상품 수정 → 연동 정보 카드).

```ts
import { Saemol } from '@saemol/sdk'

const saemol = new Saemol({ secret: process.env.SAEMOL_SECRET! })

// Health check · 연동 테스트
await saemol.health()

// Verify a license key · 라이선스 검증 (1회성 라이선스/인앱 토큰)
const result = await saemol.verifyLicense({
  licenseKey: 'MF-XXXX-XXXX-XXXX-XXXX',
  deviceId: 'machine-abc', // optional — device limit enforcement
  version: '2.0',          // optional — version gating
})
if (!result.valid) deny(result.reason)

// Check an entitlement · 권한 확인 (구독/API/사용량/화이트라벨)
const ent = await saemol.verifyEntitlement({ apiKey: 'mfk_…' })

// Report usage · 사용량 리포팅 (사용량 기반 상품)
const report = await saemol.reportUsage({ apiKey: 'mfk_…', quantity: 120 })
if (report.accepted && !report.allowed) block() // overage policy = block

// Analytics · 애널리틱스 요약 (SDK Advanced)
const { totals } = await saemol.analytics({ period: 30 })
console.log(totals.revenue, totals.conversion_rate)
```

## Webhooks · 웹훅 서명 검증

Verify the HMAC-SHA256 signature and replay window (5 min) of incoming webhooks, and get a typed event back:

```ts
import { verifyWebhook } from '@saemol/sdk'

// Next.js App Router
export async function POST(req: Request) {
  const rawBody = await req.text() // must be the raw body · 반드시 파싱 전 원문
  const event = verifyWebhook({
    headers: req.headers,
    rawBody,
    secret: process.env.SAEMOL_WEBHOOK_SECRET!,
  })

  if (event.event === 'entitlement.revoked') {
    await blockAccess(event.data) // data.reason: refunded | revoked | suspended | reissued
  }
  return Response.json({ received: true })
}
```

Events · 이벤트: `entitlement.activated` · `entitlement.revoked` · `usage.threshold_exceeded` · `tenant.provision_requested` · `subscription.renewed` · `subscription.expired` 외 33종

**Forward compatible · 상위 호환**: events added to the platform after this SDK release pass through instead of throwing, so an older SDK never 500s your webhook endpoint. Handle them in your `switch` default, or detect them explicitly:

플랫폼에 새로 추가된 이벤트도 서명만 유효하면 통과합니다 — 구버전 SDK가 웹훅 핸들러를 죽이지 않도록 하기 위함입니다. `switch`의 `default`에서 무시하거나 아래처럼 구분하세요.

```ts
import { verifyWebhook, isKnownWebhookEvent } from '@saemol/sdk'

const event = verifyWebhook({ headers, rawBody, secret })
if (!isKnownWebhookEvent(event.event)) {
  logger.info('unknown event — SDK 업그레이드 필요', event.event)
  return Response.json({ received: true })
}
```

## Error contract · 에러 규약

| Situation · 상황 | Behavior · 동작 |
|---|---|
| Key invalid (not found / revoked / expired / limits) | Returns `valid: false` — never throws |
| Integration misconfig (bad secret 401, bad request 400) | Throws `SaemolApiError` |
| Transient 502/503/504 | Retried (idempotent calls only), then `SaemolApiError` |
| Network failure / timeout | Throws `SaemolNetworkError` (`timedOut` flag) |
| Webhook signature / timestamp invalid | Throws `SaemolWebhookError` (`code` for cause) |
| Webhook event unknown to this SDK version | Passes through — does **not** throw |

`reportUsage` is **never retried automatically** to avoid double counting — decide re-submission yourself.
`reportUsage`는 중복 집계 방지를 위해 자동 재시도하지 않습니다.

## Options · 옵션

```ts
new Saemol({
  secret: '…',                       // required · 필수
  baseUrl: 'https://saemol.com',  // default
  timeoutMs: 10_000,                 // per request
  maxRetries: 2,                     // idempotent calls only
  retryDelayMs: 300,                 // doubles per attempt
  fetch: customFetch,                // injection for tests/polyfills
})
```

## Versioning · 버저닝

Semver. The platform API (`/api/v1`) is **additive-only** — response fields are never removed or repurposed. New API fields land as **minor** SDK releases; patches are bug fixes. Breaking changes are not expected under the API freeze policy.

플랫폼 API는 필드 추가만 허용(시그니처 동결)됩니다 — API 필드 추가 대응은 minor, 버그 수정은 patch로 배포됩니다.

## License

MIT
