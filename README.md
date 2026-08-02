# @saemol/sdk

Saemol seller integration SDK for Node.js — verify licenses, check entitlements, report usage, validate webhooks, and add "Sign in with Saemol" in a few lines of code.

새몰 판매자 연동 SDK — 라이선스 검증·권한 확인·사용량 리포팅·웹훅 서명 검증·새몰 계정 로그인(SSO)을 몇 줄의 코드로 처리합니다.

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

## Sign in with Saemol · 새몰 계정으로 로그인 (SSO / OAuth 2.0)

Let buyers sign in with their Saemol account — no separate signup, and you get their
subscription status in the same response. Requires the product's auth method to be
**새몰 계정으로 로그인** (구독형 상품의 인증 연동 방식).

구매자가 별도 회원가입 없이 새몰 계정으로 로그인하고, 판매자는 그 응답만으로
구독 여부·플랜까지 한 번에 확인합니다. API Key 방식과 달리 구매자가 키를 복사·입력할 필요가 없습니다.

```ts
import { SaemolOAuth, isSubscriptionActive, hasPlanFeature } from '@saemol/sdk'

const oauth = new SaemolOAuth({
  clientId:     process.env.SAEMOL_CLIENT_ID!,
  clientSecret: process.env.SAEMOL_CLIENT_SECRET!,
  redirectUri:  'https://app.example.com/auth/callback', // must match the product setting exactly
})

// 1) Login button — SDK generates the CSRF state for you
//    로그인 버튼 — state는 SDK가 만들어 줍니다
const { url, state } = oauth.createAuthorizationUrl()
session.oauthState = state
redirect(url)

// 2) Callback — one call does error check + state check + code exchange + userinfo
//    콜백 — 오류 확인·state 검증·토큰 교환·사용자 조회를 한 번에
const { user, tokens } = await oauth.handleCallback({
  url: request.url,
  expectedState: session.oauthState,
})

if (!isSubscriptionActive(user)) return showPricing()
if (hasPlanFeature(user, 'advanced')) enableAdvancedExport()

await createSession({ saemolUserId: user.sub, refreshToken: tokens.refresh_token })
```

`redirectUri` must be registered in the product's **OAuth Redirect URI** setting and match
**exactly** — no partial matches or wildcards (open-redirect protection).
상품 설정의 OAuth Redirect URI에 **정확히 같은 값**을 등록해야 합니다.

### Scopes · 권한 범위

**The scope decides what you receive — you set it per login, not per product.**
The same product can request different scopes from different pages.

**무엇을 받을지는 로그인마다 `scope`로 정합니다 — 상품 등록이 아니라 런타임 결정입니다.**
같은 상품에서 페이지마다 다르게 요청할 수 있습니다.

| Scope | You get · 받는 것 |
|---|---|
| `identity` | `sub`, `name`, `email` — 신원 확인만 (로그인) |
| `entitlement` (default · 기본) | 위 + `entitlement` (구독 상태·플랜·`plan_features`) |

```ts
oauth.createAuthorizationUrl()                     // entitlement (기본) — 로그인 + 구독
oauth.createAuthorizationUrl({ scope: 'identity' }) // 신원만 (SSO에 해당)
```

`isSubscriptionActive()` always returns `false` when you requested `identity` — there is
no subscription data to judge. 신원만 받는 로그인이라면 이 함수를 쓰지 마세요.

### Refresh · 토큰 갱신

Both tokens rotate on refresh — **always store the new `refresh_token`**; the old one is
immediately invalid. 갱신 시 리프레시 토큰도 회전하므로 새 값을 반드시 교체 저장하세요.

```ts
try {
  user = await oauth.getUserInfo({ accessToken })
} catch (err) {
  if (err instanceof SaemolOAuthError && err.code === 'invalid_token') {
    const tokens = await oauth.refresh({ refreshToken })
    await saveTokens(tokens)          // refresh_token rotated · 회전됨
    user = await oauth.getUserInfo({ accessToken: tokens.access_token })
  }
}
```

### OAuth error codes · 오류 코드

`SaemolOAuthError.code`: `access_denied` (buyer declined) · `invalid_client` ·
`invalid_grant` (code reused/expired) · `invalid_request` · `invalid_token` ·
`state_mismatch` (CSRF blocked) · `missing_code`. Unknown codes from the platform pass
through as strings — keep a `default` branch.

## Error contract · 에러 규약

| Situation · 상황 | Behavior · 동작 |
|---|---|
| Key invalid (not found / revoked / expired / limits) | Returns `valid: false` — never throws |
| Integration misconfig (bad secret 401, bad request 400) | Throws `SaemolApiError` |
| Transient 502/503/504 | Retried (idempotent calls only), then `SaemolApiError` |
| Network failure / timeout | Throws `SaemolNetworkError` (`timedOut` flag) |
| Webhook signature / timestamp invalid | Throws `SaemolWebhookError` (`code` for cause) |
| Webhook event unknown to this SDK version | Passes through — does **not** throw |
| OAuth denial / bad state / expired token | Throws `SaemolOAuthError` (`code` for cause) |

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
