# @saemol/sdk

[![npm version](https://img.shields.io/npm/v/@saemol/sdk)](https://www.npmjs.com/package/@saemol/sdk)
[![SDK checks](https://github.com/soontofu030/saemol-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/soontofu030/saemol-sdk/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Saemol seller integration SDK for Node.js — verify licenses, check entitlements, report usage, validate webhooks, create hosted checkout links, and add "Sign in with Saemol" in a few lines of code.

새몰 판매자 연동 SDK — 라이선스 검증·권한 확인·사용량 리포팅·웹훅 서명 검증·새몰 호스티드 결제·새몰 계정 로그인(SSO)을 몇 줄의 코드로 처리합니다.

- **Zero runtime dependencies** — uses built-in `fetch` (Node.js 18+)
- **TypeScript types included** — responses are typed 1:1 with the platform API
- **CJS & ESM** dual build
- Full documentation (Korean): https://saemol.com/docs

## Install

```bash
npm install @saemol/sdk@^0.4.0
```

Current npm release: **0.4.0**. See [CHANGELOG.md](CHANGELOG.md) for released and upcoming changes.

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

// Report usage · 사용량 리포팅 (사용량 측정 전달 방식)
const report = await saemol.reportUsage({ apiKey: 'mfk_…', quantity: 120 })
if (!report.accepted || !report.allowed) block() // invalid key or block-policy limit

// Analytics · 애널리틱스 요약 (SDK Advanced)
const { totals } = await saemol.analytics({ period: 30 })
console.log(totals.revenue, totals.conversion_rate)

// Hosted checkout · 새몰 호스티드 결제 링크
const { url } = await saemol.createCheckout({ itemCode: 'credit_100', externalUserId: user.id })
```

## Hosted checkout · 새몰 호스티드 결제

Create a Saemol-hosted checkout link for credits, feature unlocks, or app subscriptions. Paid sessions use the same order, settlement, and refund flow as marketplace sales when Saemol's paid-transaction gate is enabled; your server receives the result by webhook.

내 앱 안에서 크레딧·기능 해제·앱 내 구독의 새몰 결제 링크를 만듭니다. 새몰의 유료 거래 게이트가 열린 환경에서만 결제할 수 있고, 결과는 웹훅으로 받습니다.

First register the items on your product edit page (**상품 수정 → 호스티드 결제 아이템**). Each item has a `code`, a name, a price and a kind:

| kind | 설명 | 반복 구매 |
|---|---|---|
| `consumable` | 크레딧·이용권 — 쓰면 없어진다. 결제마다 `quantity`만큼 지급 | 가능 |
| `one_time` | 기능 해제 — 한 번 사면 계속 쓴다 | 불가 (이미 보유하면 거부) |
| `subscription` | 앱 내 구독 — 주기마다 자동 결제 | 주기마다 자동 |

```ts
// 1) Create a checkout session on your server · 서버에서 결제 세션을 만든다
const checkout = await saemol.createCheckout({
  itemCode: 'credit_100',                        // 등록한 아이템 코드
  externalUserId: user.id,                       // 내 앱의 사용자 id — 웹훅으로 되돌아온다
  returnUrl: 'https://myapp.com/billing/done',   // optional
  metadata: { source: 'editor_toolbar' },        // optional — 그대로 되돌아온다
  idempotencyKey: purchaseAttempt.id,            // 같은 구매 시도의 재시도에는 같은 값
})

// 2) Send the buyer there · 구매자를 보낸다
res.redirect(checkout.url)

checkout.session_id   // 나중에 조회할 때 쓴다
checkout.expires_at   // 세션 유효기간 (30분)
checkout.item.price   // 등록된 가격 (부가세 포함 총액)
```

> **The price never comes from your app.** You send only `itemCode`; Saemol uses the price registered on the product page. That is why a tampered client cannot buy a ₩5,000 pack for ₩1.
>
> **금액은 앱이 보내지 않습니다.** 코드만 보내고 가격은 새몰이 등록값을 씁니다 — 클라이언트를 변조해도 가격을 바꿀 수 없습니다. 가격을 바꾸려면 상품 수정 화면에서 바꾸세요. 앱은 고치지 않아도 됩니다.

Then unlock the feature when the `checkout.completed` webhook arrives:

```ts
const event = verifyWebhook({ headers, rawBody, secret: webhookSecret })
if (event.event === 'checkout.completed') {
  const d = event.data
  // d.external_user_id — 세션을 만들 때 넘긴 내 앱의 사용자 id
  // d.item_code        — 'credit_100'
  // d.quantity         — consumable이면 지급 수량, 그 외 null
  // d.order_id         — 새몰 주문 id (환불 웹훅이 같은 값으로 온다)
  // 주문 고유 제약과 지급을 같은 DB 트랜잭션에 넣는 함수입니다.
  await grantCreditsOnceInTransaction(d.order_id, d.external_user_id, d.quantity)
  if (d.session_id) await saemol.acknowledgeCheckout({ sessionId: d.session_id })
}
```

> Webhooks can arrive **twice** for the same payment (retry, race). Record `order_id` and skip orders you have already handled — that one line prevents double-granting credits.
>
> 같은 결제로 웹훅이 두 번 올 수 있습니다. `order_id` 고유 제약·지급·이벤트 처리 기록을 같은 트랜잭션에서 저장하세요. 적용 확인은 커밋 뒤 호출합니다. 환불 이벤트가 먼저 와도 늦게 도착한 완료 이벤트가 권한을 다시 켜면 안 됩니다. 실행 가능한 예제는 [checkout-service](examples/checkout-service/README.md)에 있습니다.

Missed the webhook, or want to confirm a buyer who just came back? Read the session:

```ts
const s = await saemol.getCheckout({ sessionId })
s.status          // 'pending' | 'completed' | 'cancelled' | 'expired'
s.entitlement_id  // 발급된 권한 id (완료된 경우)
```

**Do not trust the return URL alone.** It carries `?checkout=completed&session_id=…`, but a buyer can edit the address bar — decide with the webhook or `getCheckout()`.
**복귀 주소만 믿지 마세요.** 기능을 여는 판단은 웹훅이나 세션 조회로 합니다.

Refunds send `order.refunded` and `entitlement.revoked` with the same `order_id` — take back what you granted there, or a refunded buyer keeps the credits.
환불 시 같은 `order_id`로 두 웹훅이 갑니다. 그때 지급분을 회수하지 않으면 **환불받고도 크레딧이 남습니다.**

Balances are yours to keep. Saemol tells you *how much* to grant (`quantity`); counting and deducting stays in your app.
잔량 관리와 차감은 앱의 몫입니다 — 새몰은 지급할 수량만 알려 줍니다.

> ⚠️ **Mobile app stores.** iOS/Android stores have their own rules for digital goods; opening this checkout inside a store-distributed app may violate them. Use it for web, desktop and server-side products.
> 스토어에 올린 앱에서는 마켓 결제 정책이 별도로 적용될 수 있습니다 — 웹앱·데스크톱·서버형 서비스에서 쓰세요.

Full guide (Korean): https://saemol.com/docs/in-app-checkout

### PortOne과 연결해 테스트하기

새몰 서버에 PortOne 테스트 상점·채널을 연결하면 위 `createCheckout()` 흐름으로 PG 결제를 시험할 수 있습니다. 판매자 앱은 새몰 연동 키와 새몰 웹훅 키를 쓰며, PortOne API Secret은 새몰 서버에만 둡니다. 새몰 테스트 키와 PG 테스트 채널은 각각의 설정입니다. [PortOne 테스트 연결 안내](examples/checkout-service/portone.md)를 참고하세요.

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

### Retries and deduplication · 재전송과 중복 처리

새 이벤트는 본문 `event_id`와 `X-Saemol-Event-Id` 헤더에 같은 식별자를 제공합니다. 재전송 시 본문·식별자·`sent_at`은 같고 서명 타임스탬프가 갱신됩니다. 서명 검증 뒤 **DB의 unique 제약**으로 처리 이력을 저장하고, 실제 지급·회수와 같은 트랜잭션에서 기록하세요. 기록만 먼저 저장하고 지급이 실패하면 재시도가 영구히 누락될 수 있습니다. 메모리 Set만으로 중복을 막으면 서버 재시작 때 다시 지급될 수 있습니다.

2026-10-01 이전에 만들어진 이벤트에는 `event_id`가 없을 수 있습니다. 결제 지급은 `order_id`/`session_id`도 고유 키로 유지하고, 활성화와 회수는 **이벤트 종류와 대상 ID를 함께** 사용하세요. 같은 entitlement에 대한 활성화와 회수를 하나의 중복 키로 묶으면 회수가 누락됩니다. 서로 다른 갱신 주문도 각각 처리합니다. 수신자는 처리 완료 후에만 2xx를 반환하고, 일시 실패는 비정상 응답으로 재시도를 요청합니다.

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
| Success status with unreadable / invalid JSON body | Throws `SaemolNetworkError`; only idempotent calls may retry |
| Webhook signature / timestamp invalid | Throws `SaemolWebhookError` (`code` for cause) |
| Webhook event unknown to this SDK version | Passes through — does **not** throw |
| OAuth denial / bad state / expired token | Throws `SaemolOAuthError` (`code` for cause) |

`reportUsage` and `createCheckout` retry only when `idempotencyKey` is provided. Without a key they make one attempt. A lost response does not mean that the write failed.

`reportUsage`와 `createCheckout`은 `idempotencyKey`가 있을 때만 자동 재시도합니다. 구매 시도 또는 사용량 업무마다 키를 한 번 생성해 저장하고, 같은 요청을 복구할 때 그대로 사용하세요. 상품·테스트/운영 환경으로 결제 키가 구분되며 사용량 키는 이용 권한별로 구분됩니다. 같은 키로 다른 내용을 보내면 409 오류가 발생합니다. 사용량 재시도는 저장 당시의 누적 결과를 돌려줍니다. 최신 이용 권한은 `canAccess()`/`verifyEntitlement()`로 다시 확인하세요.

```ts
const usage = await saemol.reportUsage({ apiKey, quantity: 1, idempotencyKey: job.id })
if (!usage.accepted || !usage.allowed) return denyAccess()
if (!(await saemol.canAccess({ apiKey, feature: 'export' }))) return denyAccess()
const { url } = await saemol.customerPortal()
// 본인 새몰 계정으로 로그인해 주문·구독·기기·지원 내역을 관리합니다.
```

`customerPortal()`은 로그인 주소를 반환하며 구매자를 대신 로그인시키지 않습니다. `acknowledgeCheckout()`은 판매자 서버의 적용 완료 보고입니다. 대시보드의 수신 성공과 적용 확인은 별도로 표시되며 새몰이 판매자 DB를 직접 검사했다는 뜻은 아닙니다.

권한/SSO 응답을 저장했다면 만료 시각을 확인하고 주기적으로 재조회하세요. 환불·회수는 저장된 `valid: true`만으로 발견할 수 없습니다. OAuth `state`는 서버 세션에 저장하고 콜백에서 한 번만 소비하며, `expectedState` 누락·공백·불일치는 거부합니다.

## Start and diagnose · 빠른 시작과 진단

연결할 상품을 선택하고 [서비스 연결 시작](https://saemol.com/dashboard/connect)에서 목적·가격·설정·테스트·고객 관리 순서로 진행하세요. [실행 가능한 결제 예제와 Next.js/Express 연결](examples/checkout-service/README.md)은 영구 중복 기록과 환불 순서 역전을 포함합니다.

서버 환경 변수를 넣은 뒤 `node scripts/doctor.mjs`로 키의 존재와 새몰 API 접속을 확인하세요. `SAEMOL_SECRET`/`SAEMOL_TEST_SECRET`/`SAEMOL_WEBHOOK_SECRET` 값은 출력하지 않습니다. 이 도구는 주문을 생성하거나 결제·권한을 바꾸지 않습니다. SDK 선언은 Node 18 이상이지만 새 배포에는 보안 지원 중인 LTS를 사용하세요. SQLite 예제는 Node 24 이상이 필요합니다.

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

## 서버별 키·오류 추적·무료 로컬 도구 (0.4.0)

추가 유료 API 서비스나 AI 호출은 사용하지 않습니다. 기존 서버·DB의 운영 비용과 PG 수수료는 별도입니다. 기업 SSO/SCIM은 일반 SDK 사용의 전제가 아닙니다.

상품 수정 → 연동 정보에서 서버별 추가 키를 만들고 `verify`, `usage.write`, `checkout.read`, `checkout.write`, `checkout.ack`, `analytics.read`, `portal.read` 중 필요한 권한만 부여하세요. 추가 키 원문은 생성 직후 한 번만 표시하며 DB에는 SHA-256 해시만 저장합니다. 만료·폐기·교체된 키는 거부합니다. 기존 기본 키는 전체 권한입니다. 새 키 생성 → 서버 설정 교체 → 확인 → 이전 키 폐기로 중단을 줄일 수 있습니다. 즉시 교체 버튼은 이전 키를 즉시 폐기합니다.

`SaemolApiError.requestId`와 `onResponse({ path, status, requestId, attempt })`로 응답 추적 ID를 얻습니다. 관찰 콜백 실패는 API 결과를 바꾸지 않습니다. 콜백에는 키·본문·개인정보를 포함하지 않습니다. 401은 키·환경·만료, 403은 권한/플랜, 429는 Retry-After, 409는 멱등 키 충돌을 확인하세요.

```sh
# 저장소에서 파일 생성 계획만 확인
node scripts/scaffold.mjs --framework next --out ./saemol-connection
# 검토 후 새 폴더에만 생성
node scripts/scaffold.mjs --framework express --out ./saemol-connection --write
node scripts/doctor.mjs
node scripts/self-test.mjs
```

공개 패키지 설치 후에는 `npx saemol-sdk scaffold --framework next --out ./saemol-connection`, `npx saemol-sdk doctor`, `npx saemol-sdk self-test`를 사용할 수 있습니다. 생성된 로그인 검증은 기본적으로 구매를 거부하므로 실제 서버 세션에 연결해야 합니다. SQLite 저장소는 단일 영구 Node 24 프로세스용이고, 여러 인스턴스/서버리스에서는 공유 DB 트랜잭션 저장소로 교체해야 합니다.

셀프 테스트는 합성 데이터와 임시 SQLite로 중복 이벤트·응답 유실·환불 순서·재시작 복구를 검사하며 외부 서비스를 호출하지 않습니다. PG 계약 후 실제 승인·취소·환불·구독 갱신·정산 검증은 별도입니다. [연결·운영 문서](https://saemol.com/docs/operations).

## Development

```sh
npm ci
npm test
npm run build
npm run test:example
npm run test:scaffold
npm run check:public
```

The repository contains SDK source, tests, runnable examples, and build configuration.
Generated files, local credentials, and internal reports are excluded. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
