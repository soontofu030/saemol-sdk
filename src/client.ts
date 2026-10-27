import { SaemolApiError, SaemolNetworkError } from './errors.js'
import { validApiResponse } from './response.js'
import type {
  CommercePolicyResponse,
  AnalyticsSummaryParams,
  AnalyticsSummaryResponse,
  CheckoutSessionResponse,
  CheckUpdateParams,
  CheckUpdateResponse,
  CreateCheckoutParams,
  CreateCheckoutResponse,
  GetCheckoutParams,
  CurrentUserParams,
  CurrentUserResponse,
  HealthResponse,
  ReportUsageParams,
  ReportUsageResponse,
  VerifyEntitlementParams,
  VerifyEntitlementResponse,
  VerifyLicenseParams,
  VerifyLicenseResponse,
  AcknowledgeCheckoutResponse,
  CustomerPortalResponse,
  AccessParams,
} from './types.js'

export const SDK_VERSION = '0.5.0'

const DEFAULT_BASE_URL = 'https://saemol.com'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 300
/** 재시도 대상 상태코드 — 일시적 서버·게이트웨이 장애만 */
const RETRYABLE_STATUSES = new Set([502, 503, 504])

export interface SaemolOptions {
  /** 상품별 연동 시크릿 — 상품 수정 페이지의 연동 정보 카드에서 확인 (X-Saemol-Secret) */
  secret: string
  /** 플랫폼 주소 (기본: https://saemol.com — 셀프호스팅·개발 환경에서 변경) */
  baseUrl?: string
  /** 요청당 타임아웃 ms (기본 10초) */
  timeoutMs?: number
  /** 조회 또는 idempotencyKey를 지정한 쓰기의 최대 재시도 횟수 (기본 2) */
  maxRetries?: number
  /** 재시도 대기 ms — 시도마다 2배씩 증가 (기본 300) */
  retryDelayMs?: number
  /** fetch 주입 (테스트·폴리필용, 기본: 전역 fetch — Node 18+) */
  fetch?: typeof globalThis.fetch
  /** 상태와 추적 ID만 받는 관찰 콜백. 콜백 오류는 API 결과를 바꾸지 않는다. */
  onResponse?: (info: { path: string; status: number; requestId: string | null; attempt: number }) => void
}

interface RequestOptions {
  method: 'GET' | 'POST'
  body?: Record<string, unknown>
  /** 조회 또는 멱등 키로 보호한 쓰기만 재시도 */
  retry: boolean
  /** 이 상태코드는 에러로 던지지 않고 본문을 그대로 반환 (예: 404 = 유효하지 않은 키) */
  softStatuses?: number[]
  idempotencyKey?: string
}

/**
 * Saemol 판매자 연동 클라이언트 (판매자 서버 → 플랫폼).
 *
 * ```ts
 * const saemol = new Saemol({ secret: process.env.SAEMOL_SECRET! })
 * const result = await saemol.verifyLicense({ licenseKey: 'MF-…', deviceId: 'machine-1' })
 * if (!result.valid) deny(result.reason)
 * ```
 *
 * 에러 규약:
 * - 키가 유효하지 않음(미존재·회수·만료 등) → 던지지 않고 `valid: false` 응답 반환
 * - 연동 설정 문제(시크릿 불일치 401, 잘못된 요청 400)·서버 오류 → SaemolApiError
 * - 네트워크 실패·타임아웃(재시도 소진) → SaemolNetworkError
 */
export class Saemol {
  private readonly secret: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly onResponse?: SaemolOptions['onResponse']
  private readonly retryDelayMs: number
  private readonly fetchFn: typeof globalThis.fetch

  constructor(options: SaemolOptions) {
    if (!options?.secret) throw new TypeError('Saemol: secret은 필수입니다 (상품 수정 페이지의 연동 정보 카드에서 확인)')
    this.secret = options.secret
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.onResponse = options.onResponse
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    this.fetchFn = options.fetch ?? globalThis.fetch
  }

  /** 연동 테스트 — GET /api/v1/health */
  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/api/v1/health', { method: 'GET', retry: true })
  }

  /**
   * 라이선스 키 검증 — POST /api/v1/licenses/verify (1회성 라이선스·인앱 활성화 토큰).
   * deviceId를 보내면 자동 등록되며 제한 초과 시 `reason: 'device_limit_exceeded'`.
   */
  verifyLicense(params: VerifyLicenseParams): Promise<VerifyLicenseResponse> {
    return this.request<VerifyLicenseResponse>('/api/v1/licenses/verify', {
      method: 'POST',
      body: {
        license_key: params.licenseKey,
        ...(params.deviceId !== undefined ? { device_id: params.deviceId } : {}),
        ...(params.version !== undefined ? { version: params.version } : {}),
      },
      retry: true, // 동일 device_id 재등록은 no-op — 멱등
      softStatuses: [404],
    })
  }

  /**
   * 권한 확인 — POST /api/v1/entitlements/verify (구독/API/사용량/화이트라벨).
   * API 상품은 응답의 rate_limit_per_min으로 자체 Rate Limit을 적용한다.
   */
  verifyEntitlement(params: VerifyEntitlementParams): Promise<VerifyEntitlementResponse> {
    return this.request<VerifyEntitlementResponse>('/api/v1/entitlements/verify', {
      method: 'POST',
      body: {
        api_key: params.apiKey,
        ...(params.version !== undefined ? { version: params.version } : {}),
      },
      retry: true,
      softStatuses: [404],
    })
  }

  /**
   * 업데이트 확인 — POST /api/v1/updates/check.
   * 판매자가 상품 수정 페이지의 "업데이트 정보"에 설정한 최신 버전과 비교한다.
   * `update_required: true`(min_version 미만)면 강제 업데이트로 처리할 것.
   */
  checkUpdate(params: CheckUpdateParams = {}): Promise<CheckUpdateResponse> {
    return this.request<CheckUpdateResponse>('/api/v1/updates/check', {
      method: 'POST',
      body: {
        ...(params.currentVersion !== undefined ? { current_version: params.currentVersion } : {}),
      },
      retry: true, // 조회 전용 — 멱등
    })
  }

  /**
   * 키 소유 구매자 조회 — POST /api/v1/users/current.
   * 라이선스/API 키로 내 서비스에 접속한 사용자의 구매자 컨텍스트(이름·이메일)를 가져온다.
   * 키가 유효하지 않으면 던지지 않고 `found: false`를 반환한다.
   */
  currentUser(params: CurrentUserParams): Promise<CurrentUserResponse> {
    return this.request<CurrentUserResponse>('/api/v1/users/current', {
      method: 'POST',
      body: {
        ...(params.licenseKey !== undefined ? { license_key: params.licenseKey } : {}),
        ...(params.apiKey !== undefined ? { api_key: params.apiKey } : {}),
      },
      retry: true, // 조회 전용 — 멱등
      softStatuses: [404],
    })
  }

  /**
   * 애널리틱스 요약 — GET /api/v1/analytics/summary.
   * 이 상품의 KST 일별 집계(조회·찜·주문·매출·환불·검증 호출·사용량 리포트)와 기간 합계를 가져온다.
   * 요금제상 SDK Advanced(Business+)로 안내되는 기능이다.
   *
   * ```ts
   * const { totals, days } = await saemol.analytics({ period: 30 })
   * console.log(totals.revenue, totals.conversion_rate)
   * ```
   */
  analytics(params: AnalyticsSummaryParams = {}): Promise<AnalyticsSummaryResponse> {
    const query = params.period !== undefined ? `?period=${params.period}` : ''
    return this.request<AnalyticsSummaryResponse>(`/api/v1/analytics/summary${query}`, {
      method: 'GET',
      retry: true, // 조회 전용 — 멱등
    })
  }

  /**
   * 사용량 리포팅 — POST /api/v1/usage/report (사용량 측정 전달 방식).
   * `allowed: false`(정책 block + 초과)면 판매자 서버에서 사용을 차단한다.
   * idempotencyKey가 있을 때만 같은 저장 결과를 복구하며 재시도한다.
   */
  reportUsage(params: ReportUsageParams): Promise<ReportUsageResponse> {
    return this.request<ReportUsageResponse>('/api/v1/usage/report', {
      method: 'POST',
      body: {
        api_key: params.apiKey,
        quantity: params.quantity,
        ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
      },
      retry: params.idempotencyKey !== undefined,
      idempotencyKey: params.idempotencyKey,
      softStatuses: [404],
    })
  }

  /**
   * 새몰 호스티드 결제 세션 생성 — POST /api/v1/checkout/sessions.
   *
   * 앱 안에서 결제가 필요할 때 이 메서드로 링크를 받아 사용자를 보내면 된다.
   * 유료 거래 게이트가 열린 운영 환경에서는 새몰의 마켓 주문 흐름이 결제·정산·환불을
   * 처리하고, 판매자는 결제 결과를 받는다. 현재 게이트 상태는 API 오류 응답으로 확인한다.
   *
   * ⚠️ 금액을 보내지 않는다. 상품 수정 화면에 등록한 아이템 코드만 보내고
   *    가격은 새몰이 그 등록값을 쓴다 — 그래서 앱이 뚫려도 가격이 조작되지 않는다.
   *
   * ```ts
   * const { url } = await saemol.createCheckout({
   *   itemCode: 'credit_100',
   *   externalUserId: user.id,
   *   returnUrl: 'https://myapp.com/billing/done',
   * })
   * // 사용자를 url로 보낸다 (리다이렉트 또는 새 창)
   * ```
   *
   * 결제가 끝나면 `checkout.completed` 웹훅이 온다.
   * idempotencyKey가 있으면 같은 구매 시도의 세션을 복구하며 재시도한다.
   */
  /** 승인 상태 안내용 조회. 실제 결제 시 서버가 다시 검증한다. */
  getCommercePolicy(): Promise<CommercePolicyResponse> {
    return this.request('/api/v1/commerce/policy', { method: 'GET', retry: true })
  }

  createCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResponse> {
    return this.request<CreateCheckoutResponse>('/api/v1/checkout/sessions', {
      method: 'POST',
      body: {
        item_code: params.itemCode,
        ...(params.serviceOrigin !== undefined ? { service_origin: params.serviceOrigin } : {}),
        ...(params.externalUserId !== undefined ? { external_user_id: params.externalUserId } : {}),
        ...(params.returnUrl !== undefined ? { return_url: params.returnUrl } : {}),
        ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
      },
      retry: params.idempotencyKey !== undefined,
      idempotencyKey: params.idempotencyKey,
    })
  }

  /**
   * 새몰 호스티드 결제 세션 조회 — GET /api/v1/checkout/sessions/{session_id}.
   *
   * 웹훅(`checkout.completed`)이 정상 경로이고 이건 **보완**이다 —
   * 웹훅을 놓쳤거나, 결제를 마치고 앱으로 돌아온 사용자를 그 자리에서 확인할 때 쓴다.
   */
  getCheckout(params: GetCheckoutParams): Promise<CheckoutSessionResponse> {
    return this.request<CheckoutSessionResponse>(
      `/api/v1/checkout/sessions/${encodeURIComponent(params.sessionId)}`,
      { method: 'GET', retry: true },
    )
  }

  /** 내 DB의 구매 적용 트랜잭션이 커밋된 뒤 호출한다. 같은 세션의 확인은 한 번만 기록된다. */
  acknowledgeCheckout(params: GetCheckoutParams): Promise<AcknowledgeCheckoutResponse> {
    return this.request(`/api/v1/checkout/sessions/${encodeURIComponent(params.sessionId)}/acknowledge`, { method: 'POST', retry: true })
  }

  /** 본인 새몰 계정으로 로그인해 이 판매자의 주문·구독·권한을 관리하는 주소. */
  customerPortal(): Promise<CustomerPortalResponse> {
    return this.request('/api/v1/customer-portal', { method: 'GET', retry: true })
  }

  /** 최신 권한을 조회하고 만료와 상품 기능 목록을 함께 확인한다. API 장애는 예외로 전달된다. */
  async canAccess(params: AccessParams): Promise<boolean> {
    const ent = await this.verifyEntitlement(params)
    if (!ent.valid || 'reason' in ent && ent.reason || ent.status !== 'active' || !('current_period_end' in ent)) return false
    const now = Date.now()
    if ([ent.current_period_end, ent.expires_at].some(value => value !== null && (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= now))) return false
    return params.feature === undefined || ent.plan_features?.includes(params.feature) === true
  }

  // ── 공통 요청 코어 ────────────────────────────────────────

  private async request<T>(path: string, opts: RequestOptions): Promise<T> {
    if (opts.idempotencyKey !== undefined && !/^[\x21-\x7e]{1,200}$/.test(opts.idempotencyKey)) throw new TypeError('idempotencyKey는 공백 없는 1~200자 문자열이어야 합니다')
    const url = `${this.baseUrl}${path}`
    const attempts = opts.retry ? this.maxRetries + 1 : 1
    let lastError: unknown

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(this.retryDelayMs * 2 ** (attempt - 1))

      let res: Response
      try {
        res = await this.fetchFn(url, {
          method: opts.method,
          headers: {
            'Content-Type': 'application/json',
            'X-Saemol-Secret': this.secret,
            'X-Saemol-Sdk': `@saemol/sdk/${SDK_VERSION}`,
            ...(opts.idempotencyKey !== undefined ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
          },
          ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      } catch (err) {
        lastError = err
        continue // 네트워크 실패·타임아웃 → 재시도 (허용 시)
      }

      const requestId = res.headers.get('x-request-id')
      try { this.onResponse?.({ path, status: res.status, requestId, attempt: attempt + 1 }) } catch { /* observer must not affect purchase processing */ }

      if (res.ok) {
        try {
          const body: unknown = await res.json()
          if (!validApiResponse(path, body)) throw new TypeError('Saemol API 응답 형식이 올바르지 않습니다')
          return body as T
        }
        catch (error) { lastError = error; continue }
      }

      if (RETRYABLE_STATUSES.has(res.status) && attempt < attempts - 1) {
        lastError = new SaemolApiError(res.status, await parseBody(res), requestId)
        continue
      }

      const body = await parseBody(res)
      if (opts.softStatuses?.includes(res.status)) {
        if (validApiResponse(path, body)) return body as T
        lastError = new TypeError('Saemol API 거부 응답 형식이 올바르지 않습니다')
        continue
      }
      throw new SaemolApiError(res.status, body, requestId)
    }

    if (lastError instanceof SaemolApiError) throw lastError
    const timedOut = isTimeoutError(lastError)
    throw new SaemolNetworkError(
      timedOut
        ? `Saemol API 요청 타임아웃 (${this.timeoutMs}ms): ${opts.method} ${path}`
        : `Saemol API 요청 실패 (네트워크): ${opts.method} ${path}`,
      { cause: lastError, timedOut },
    )
  }
}

async function parseBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
