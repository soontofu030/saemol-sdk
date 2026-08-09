// ============================================================
// 플랫폼 API 요청·응답 타입 — 실제 라우트 응답과 1:1.
// 근거: app/api/v1/{licenses,entitlements}/verify · usage/report · health
//       (필드 추가만 허용 — 시그니처 동결, INTEGRATIONS.md §4)
// ============================================================

// ── GET /api/v1/health ──────────────────────────────────────

export interface HealthResponse {
  ok: boolean
  service: string
  version: string
  time: string
}

// ── POST /api/v1/licenses/verify ────────────────────────────

export interface VerifyLicenseParams {
  /** 라이선스 키 (MF-XXXX-…) 또는 인앱 활성화 토큰 */
  licenseKey: string
  /** 디바이스 제한 시 전송 — 미등록 디바이스는 자동 등록, 제한 초과 시 거부 */
  deviceId?: string
  /** 제품 버전 — 허용 버전 목록과 대조 (미전송 시 전체 허용) */
  version?: string
}

export interface LicenseDeviceInfo {
  registered: number
  limit: number | null
}

export interface VerifyLicenseOk {
  valid: true
  status: 'active'
  kind: string
  plan_name: string | null
  /** 인앱결제 SKU 매핑 (metadata.sku) */
  sku: string | null
  devices: LicenseDeviceInfo
  /** 기간제·trial 만료 시각 (null=무기한) */
  expires_at: string | null
  /** 무료 체험 발급 여부 */
  is_trial: boolean
  /** 샌드박스 테스트 키 여부 (테스트 시크릿으로 검증한 경우 true) */
  is_test?: boolean
}

export interface VerifyLicenseDenied {
  valid: false
  /** revoked·expired·suspended·device_limit_exceeded·version_not_allowed 또는 키 미존재 안내 */
  reason: string
  status?: string
  expires_at?: string | null
  is_trial?: boolean
  /** 샌드박스 테스트 키 여부 */
  is_test?: boolean
  /** reason=version_not_allowed 시 요청했던 버전 */
  version?: string
  /** reason=version_not_allowed 시 허용 목록 */
  allowed_versions?: string[] | null
  /** reason=device_limit_exceeded 시 현재 등록 현황 */
  devices?: LicenseDeviceInfo
}

export type VerifyLicenseResponse = VerifyLicenseOk | VerifyLicenseDenied

// ── POST /api/v1/entitlements/verify ────────────────────────

export interface VerifyEntitlementParams {
  /** API Key (mfk_…) */
  apiKey: string
  /** 제품 버전 — 허용 버전 목록과 대조 (미전송 시 전체 허용) */
  version?: string
}

export interface EntitlementUsageInfo {
  unit: string | null
  used: number
  limit: number | null
}

/** 키가 조회된 경우의 전체 응답 — 상태가 active가 아니어도 이 형태로 온다(valid만 false). */
export interface VerifyEntitlementResult {
  valid: boolean
  status: string
  kind: string
  plan_name: string | null
  /** 판매자가 등록한 플랜별 기능 목록 (plan_features config) */
  plan_features: string[] | null
  rate_limit_per_min: number | null
  /** 사용량 기반(kind=usage)일 때만 non-null */
  usage: EntitlementUsageInfo | null
  current_period_end: string | null
  expires_at: string | null
  is_trial: boolean
  /** 샌드박스 테스트 키 여부 (테스트 시크릿으로 검증한 경우 true) */
  is_test?: boolean
  reason?: undefined
}

/** 버전 미허용·키 미존재 등 거부 응답 */
export interface VerifyEntitlementDenied {
  valid: false
  reason: string
  status?: string
  version?: string
  allowed_versions?: string[] | null
}

export type VerifyEntitlementResponse = VerifyEntitlementResult | VerifyEntitlementDenied

// ── POST /api/v1/usage/report ───────────────────────────────

export interface ReportUsageParams {
  /** API Key (mfk_…) */
  apiKey: string
  /** 이번에 소비한 양 (양수) */
  quantity: number
  /** 부가 정보 — usage_records.metadata로 저장 */
  metadata?: Record<string, unknown>
}

export interface ReportUsageAccepted {
  accepted: true
  /** false면(정책 block + 초과) 판매자 서버에서 사용을 차단해야 한다 */
  allowed: boolean
  usage: {
    unit: string | null
    used: number
    limit: number | null
    remaining: number | null
  }
  overage_policy: string
  over_limit: boolean
}

export interface ReportUsageRejected {
  accepted: false
  reason: string
  allowed?: boolean
}

export type ReportUsageResponse = ReportUsageAccepted | ReportUsageRejected

// ============================================================
// Update Check — POST /api/v1/updates/check
// ============================================================

export interface CheckUpdateParams {
  /** 현재 실행 중인 버전 (예: '1.2.0') — 생략 시 latest_version만 반환 */
  currentVersion?: string
}

export interface CheckUpdateResponse {
  product_id: string
  /** 판매자가 설정한 최신 버전 (미설정 시 null) */
  latest_version: string | null
  /** currentVersion을 보냈고 latest보다 낮으면 true */
  update_available: boolean
  /** currentVersion이 min_version 미만이면 true (강제 업데이트) */
  update_required: boolean
  min_version: string | null
  download_url: string | null
  release_notes: string | null
}

// ============================================================
// Current User — POST /api/v1/users/current
// ============================================================

export interface CurrentUserParams {
  /** 라이선스 키 (licenseKey/apiKey 중 하나 필수) */
  licenseKey?: string
  /** API 키 */
  apiKey?: string
}

export interface CurrentUserFound {
  found: true
  entitlement_id: string
  kind: string
  /** 만료 지연 갱신이 반영된 유효 상태 (verify와 동일 의미) */
  status: string
  plan_name: string | null
  is_trial: boolean
  expires_at: string | null
  user: {
    id: string
    name: string | null
    email: string | null
  }
}

export interface CurrentUserNotFound {
  found: false
  /** 키 미존재 안내 또는 'user_withdrawn'(구매자 탈퇴 — 판매자 측 데이터 파기 신호) */
  reason: string
}

export type CurrentUserResponse = CurrentUserFound | CurrentUserNotFound

// ============================================================
// Analytics Summary — GET /api/v1/analytics/summary
// ============================================================

export interface AnalyticsSummaryParams {
  /** 조회 기간(일) — 7 | 30 | 90. 기본 30, 그 외 값은 서버에서 30으로 정규화 */
  period?: 7 | 30 | 90
}

/** 일별 집계 1일치 (KST 기준) */
export interface AnalyticsDailyPoint {
  /** YYYY-MM-DD (Asia/Seoul) */
  date:          string
  views:         number
  favorites:     number
  orders:        number
  paid_orders:   number
  /** 결제 완료 금액 합계 (원) */
  revenue:       number
  refunds:       number
  refund_amount: number
  /** 라이선스·권한 검증 호출 수 */
  verify_calls:  number
  usage_reports: number
}

export interface AnalyticsTotals {
  views:         number
  favorites:     number
  orders:        number
  paid_orders:   number
  revenue:       number
  refunds:       number
  refund_amount: number
  verify_calls:  number
  usage_reports: number
  /** 조회 → 결제 전환율 (%) */
  conversion_rate: number
}

export interface AnalyticsSummaryResponse {
  product_id: string
  /** 실제 적용된 기간(일) — 요청값이 7/30/90이 아니면 30 */
  period:     number
  /** 집계 기준 시간대 (고정: 'Asia/Seoul') */
  timezone:   string
  /** 오래된 날짜 → 최신 날짜 순 */
  days:       AnalyticsDailyPoint[]
  totals:     AnalyticsTotals
}

// ============================================================
// 판매자 웹훅 이벤트 타입 (플랫폼 → 판매자, INTEGRATIONS.md §3)
// ============================================================

export type SaemolWebhookEventType =
  // 상품 단위 (product_integrations.webhook_url 수신)
  | 'order.paid'
  | 'order.refunded'
  | 'order.cancelled'
  | 'order.delivered'
  | 'entitlement.activated'
  | 'entitlement.revoked'
  | 'usage.threshold_exceeded'
  | 'tenant.provision_requested'
  | 'subscription.created'
  | 'subscription.renewed'
  | 'subscription.cancelled'
  | 'subscription.expired'
  | 'user.updated'
  | 'user.withdrawn'
  | 'product.approved'
  | 'product.rejected'
  | 'product.updated'
  | 'review.created'
  | 'review.updated'
  | 'review.deleted'
  | 'product.featured'
  | 'product.unfeatured'
  | 'product.favorited'
  | 'api_key.issued'
  | 'api_key.revoked'
  // 판매자 계정 단위 (seller_integrations.webhook_url 수신, product_id는 null)
  | 'team.member_invited'
  | 'team.member_joined'
  | 'team.role_changed'
  | 'team.member_removed'
  | 'payout.completed'
  | 'payout.held'
  | 'analytics.daily_summary'
  | 'analytics.weekly_summary'
  | 'analytics.monthly_summary'

/** 결제 완료 (Purchase Event) */
export interface OrderPaidData {
  order_id: string
  order_number: string
  buyer_id: string
  amount: number
}

/** 환불 완료 (Purchase Event) — 발급 권한은 entitlement.revoked로 별도 통지 */
export interface OrderRefundedData {
  order_id: string
  order_number: string
  buyer_id: string
  amount: number
}

/** 전달 완료 (Download Event) — 구매자가 산출물에 접근 가능해진 시점 */
export interface OrderDeliveredData {
  order_id: string
  order_number: string
  buyer_id: string
}

/** 권한 발급·재개·재발급 새 키. reason: 'reissued' | 'resumed' | 'trial' (최초 발급은 없음) */
export interface EntitlementActivatedData {
  entitlement_id: string
  order_id: string | null
  order_number?: string
  kind: string
  plan_name?: string | null
  license_key: string | null
  api_key: string | null
  /**
   * 인앱결제 SKU (kind='in_app'만 non-null) — 요금제명으로 상품 설정의 sku_map을 찾은 값.
   * 토큰 검증 없이 웹훅만으로 어떤 인앱 상품인지 판별할 때 쓴다.
   * 요금제명과 sku_map의 키가 다르면 null이 온다.
   */
  sku?: string | null
  buyer_id?: string
  reason?: string
  is_trial?: boolean
  /** 샌드박스 테스트 키 발급 여부 */
  is_test?: boolean
  expires_at?: string | null
}

/** 권한 무효화. reason으로 구분: refunded(환불)·revoked(수동 회수)·suspended(정지)·reissued(재발급 구키) */
export interface EntitlementRevokedData {
  entitlement_id: string
  order_id: string | null
  kind: string
  license_key: string | null
  api_key: string | null
  reason: string
}

/** 사용량이 포함량을 처음 초과했을 때 */
export interface UsageThresholdExceededData {
  entitlement_id: string
  plan_name: string | null
  unit: string | null
  used: number
  limit: number | null
  overage_policy: string
}

/** 화이트라벨 결제 완료 — 테넌트 생성 요청 */
export interface TenantProvisionRequestedData {
  entitlement_id: string
  order_id: string | null
  order_number?: string
  kind: string
  plan_name?: string | null
  license_key: string | null
  api_key: string | null
  buyer_id?: string
}

/** 주문 취소 (Purchase Event). reason: 'buyer_cancelled' | 'payment_timeout' 등 */
export interface OrderCancelledData {
  order_id: string
  order_number: string
  buyer_id: string
  reason?: string
}

/** 구독 시작 (Subscription Event) — 첫 결제 성공 시 */
export interface SubscriptionCreatedData {
  subscription_id: string
  entitlement_id?: string | null
  plan_name?: string | null
  billing_cycle?: string
  current_period_end?: string | null
  buyer_id?: string
}

/** 구독 해지 예약 (Subscription Event) — current_period_end에 종료 예정 */
export interface SubscriptionCancelledData {
  subscription_id: string
  plan_name?: string | null
  current_period_end?: string | null
  buyer_id?: string
}

/** 구매자 프로필 변경 (User Event) — 활성 권한 보유 상품의 판매자에게만 발송 */
export interface UserUpdatedData {
  user_id: string
  name: string | null
  changed_fields: string[]
}

/** 구매자 회원 탈퇴 (User Event) — 활성 권한 보유 상품의 판매자에게만 발송 */
export interface UserWithdrawnData {
  user_id: string
}

/** 상품 심사 승인 (Product Event) */
export interface ProductApprovedData {
  name: string
}

/** 상품 심사 반려 (Product Event) */
export interface ProductRejectedData {
  name: string
  reason: string | null
}

/** 상품 정보 수정 (Product Event) */
export interface ProductUpdatedData {
  name: string
  changed_fields?: string[]
}

/** 리뷰 등록 (Review Event) */
export interface ReviewCreatedData {
  review_id: string
  rating: number
  title?: string | null
  user_id: string
}

/** 리뷰 수정 (Review Event). 작성 후 30일 이내 작성자 본인 수정 */
export interface ReviewUpdatedData {
  review_id: string
  rating: number
  title?: string | null
  user_id: string
}

/** 리뷰 삭제 (Review Event). reason: 'author'(작성자) | 'admin'(관리자) */
export interface ReviewDeletedData {
  review_id: string
  reason?: string
}

/** 추천 선정·해제 (Marketplace Event) */
export interface ProductFeaturedData {
  name: string
}

/** 찜 추가 (Marketplace Event) */
export interface ProductFavoritedData {
  user_id: string
}

/** API Key 발급 (API Event). reason: 'issued' | 'reissued' */
export interface ApiKeyIssuedData {
  entitlement_id: string
  api_key: string
  reason?: string
}

/** API Key 회수 (API Event) */
export interface ApiKeyRevokedData {
  entitlement_id: string
  api_key: string | null
  reason?: string
}

/** 팀원 초대·합류·역할 변경·제외 (Team Event — 판매자 계정 웹훅) */
export interface TeamEventData {
  organization_id: string
  member_user_id?: string
  email?: string
  role?: string
}

/** 정산 지급 완료·보류 (Payout Event — 판매자 계정 웹훅) */
export interface PayoutEventData {
  settlement_id: string
  period_start?: string
  period_end?: string
  payout_amount?: number
  reason?: string
}

/** 통계 요약 (Analytics Event — 판매자 계정 웹훅). totals는 이벤트 유형별 집계 */
export interface AnalyticsSummaryData {
  period_start: string
  period_end: string
  totals: Record<string, number>
}

interface WebhookEventBase {
  /** 판매자 계정 단위 이벤트(team/payout/analytics)는 null */
  product_id: string | null
  sent_at: string
}

export type SaemolWebhookEvent = WebhookEventBase &
  (
    | { event: 'order.paid'; data: OrderPaidData }
    | { event: 'order.refunded'; data: OrderRefundedData }
    | { event: 'order.cancelled'; data: OrderCancelledData }
    | { event: 'order.delivered'; data: OrderDeliveredData }
    | { event: 'entitlement.activated'; data: EntitlementActivatedData }
    | { event: 'entitlement.revoked'; data: EntitlementRevokedData }
    | { event: 'usage.threshold_exceeded'; data: UsageThresholdExceededData }
    | { event: 'tenant.provision_requested'; data: TenantProvisionRequestedData }
    | { event: 'subscription.created'; data: SubscriptionCreatedData }
    | { event: 'subscription.renewed'; data: Record<string, unknown> }
    | { event: 'subscription.cancelled'; data: SubscriptionCancelledData }
    | { event: 'subscription.expired'; data: Record<string, unknown> }
    | { event: 'user.updated'; data: UserUpdatedData }
    | { event: 'user.withdrawn'; data: UserWithdrawnData }
    | { event: 'product.approved'; data: ProductApprovedData }
    | { event: 'product.rejected'; data: ProductRejectedData }
    | { event: 'product.updated'; data: ProductUpdatedData }
    | { event: 'review.created'; data: ReviewCreatedData }
    | { event: 'review.updated'; data: ReviewUpdatedData }
    | { event: 'review.deleted'; data: ReviewDeletedData }
    | { event: 'product.featured'; data: ProductFeaturedData }
    | { event: 'product.unfeatured'; data: ProductFeaturedData }
    | { event: 'product.favorited'; data: ProductFavoritedData }
    | { event: 'api_key.issued'; data: ApiKeyIssuedData }
    | { event: 'api_key.revoked'; data: ApiKeyRevokedData }
    | { event: 'team.member_invited'; data: TeamEventData }
    | { event: 'team.member_joined'; data: TeamEventData }
    | { event: 'team.role_changed'; data: TeamEventData }
    | { event: 'team.member_removed'; data: TeamEventData }
    | { event: 'payout.completed'; data: PayoutEventData }
    | { event: 'payout.held'; data: PayoutEventData }
    | { event: 'analytics.daily_summary'; data: AnalyticsSummaryData }
    | { event: 'analytics.weekly_summary'; data: AnalyticsSummaryData }
    | { event: 'analytics.monthly_summary'; data: AnalyticsSummaryData }
  )

// ============================================================
// OAuth 2.0 / SSO — "새몰 계정으로 로그인" (구독형 auth_method sso·oauth)
// 근거: app/(auth)/oauth/authorize · app/api/v1/oauth/{token,userinfo}
// ============================================================

/**
 * 요청 권한 범위.
 *  - 'identity'    SSO — 신원 확인만 (auth_method='sso'의 유일한 값)
 *  - 'entitlement' 신원 + 이 상품의 구독 상태·플랜 (auth_method='oauth' 기본값)
 */
export type OAuthScope = 'identity' | 'entitlement'

/** 토큰 응답 — authorization_code 교환과 refresh_token 갱신이 동일 형태 */
export interface OAuthTokens {
  access_token: string
  token_type: 'Bearer'
  /** 액세스 토큰 유효 시간(초) */
  expires_in: number
  /** 갱신 시 회전(rotation)된다 — 새 값으로 반드시 교체 저장할 것 */
  refresh_token: string
  scope: OAuthScope
}

/** userinfo의 구독 요약 — scope가 'entitlement'일 때만 채워진다 */
export interface OAuthEntitlement {
  /** 지금 이 상품을 쓸 수 있는지 — 기능 개방 판정은 이 값 하나로 충분하다 */
  valid: boolean
  status: string
  kind: string
  plan_name: string | null
  /** 판매자가 등록한 plan_features의 해당 플랜 항목 */
  plan_features: string[] | null
  current_period_end: string | null
  expires_at: string | null
  is_trial: boolean
}

/**
 * 로그인한 구매자 정보.
 * scope='identity'면 entitlement 필드 자체가 없고, 'entitlement'면 구독 요약이
 * 함께 온다 (구매 이력이 없으면 null).
 */
export interface OAuthUserInfo {
  /** 새몰 회원 식별자 — 판매자 서비스의 계정 연결 키로 쓴다 */
  sub: string
  name: string | null
  email: string | null
  product_id: string
  scope: OAuthScope
  entitlement?: OAuthEntitlement | null
}

export interface CreateAuthorizationUrlParams {
  /**
   * 미지정 시 scope 파라미터를 보내지 않고 플랫폼 기본값에 맡긴다
   * (`sso`→identity, `oauth`→entitlement). 대부분 지정할 필요가 없다.
   */
  scope?: OAuthScope
  /** 미지정 시 SDK가 암호학적 난수로 생성해 반환한다 */
  state?: string
  /** 생성자 redirectUri를 이 요청에서만 덮어쓴다 */
  redirectUri?: string
}

export interface ExchangeCodeParams {
  /** 콜백 쿼리의 code */
  code: string
  /** 인가 요청 때와 **정확히 같은** 값이어야 한다 */
  redirectUri?: string
}

export interface RefreshTokensParams {
  refreshToken: string
}

export interface GetUserInfoParams {
  accessToken: string
}

export interface HandleCallbackParams {
  /** 콜백 요청의 전체 URL 또는 쿼리스트링·검색 파라미터 */
  url: string | URL | URLSearchParams
  /** 인가 요청 때 발급한 state — 넘기면 불일치 시 state_mismatch로 거부한다 */
  expectedState?: string
  redirectUri?: string
}

/** handleCallback 한 번으로 얻는 로그인 결과 */
export interface OAuthSession {
  tokens: OAuthTokens
  user: OAuthUserInfo
}
