import { SaemolApiError, SaemolNetworkError } from './errors.js'
import type {
  CheckUpdateParams,
  CheckUpdateResponse,
  CurrentUserParams,
  CurrentUserResponse,
  HealthResponse,
  ReportUsageParams,
  ReportUsageResponse,
  VerifyEntitlementParams,
  VerifyEntitlementResponse,
  VerifyLicenseParams,
  VerifyLicenseResponse,
} from './types.js'

export const SDK_VERSION = '0.1.0'

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
  /** 멱등 호출(health·verify)의 최대 재시도 횟수 (기본 2) — reportUsage는 중복 집계 방지를 위해 재시도하지 않음 */
  maxRetries?: number
  /** 재시도 대기 ms — 시도마다 2배씩 증가 (기본 300) */
  retryDelayMs?: number
  /** fetch 주입 (테스트·폴리필용, 기본: 전역 fetch — Node 18+) */
  fetch?: typeof globalThis.fetch
}

interface RequestOptions {
  method: 'GET' | 'POST'
  body?: Record<string, unknown>
  /** 멱등 호출만 재시도 */
  retry: boolean
  /** 이 상태코드는 에러로 던지지 않고 본문을 그대로 반환 (예: 404 = 유효하지 않은 키) */
  softStatuses?: number[]
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
  private readonly retryDelayMs: number
  private readonly fetchFn: typeof globalThis.fetch

  constructor(options: SaemolOptions) {
    if (!options?.secret) throw new TypeError('Saemol: secret은 필수입니다 (상품 수정 페이지의 연동 정보 카드에서 확인)')
    this.secret = options.secret
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
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
   * 사용량 리포팅 — POST /api/v1/usage/report (사용량 기반 상품).
   * `allowed: false`(정책 block + 초과)면 판매자 서버에서 사용을 차단한다.
   * 중복 집계를 막기 위해 재시도하지 않는다 — 실패 시 호출자가 재전송 여부를 판단할 것.
   */
  reportUsage(params: ReportUsageParams): Promise<ReportUsageResponse> {
    return this.request<ReportUsageResponse>('/api/v1/usage/report', {
      method: 'POST',
      body: {
        api_key: params.apiKey,
        quantity: params.quantity,
        ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
      },
      retry: false,
      softStatuses: [404],
    })
  }

  // ── 공통 요청 코어 ────────────────────────────────────────

  private async request<T>(path: string, opts: RequestOptions): Promise<T> {
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
          },
          ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      } catch (err) {
        lastError = err
        continue // 네트워크 실패·타임아웃 → 재시도 (허용 시)
      }

      if (res.ok) return (await res.json()) as T

      if (RETRYABLE_STATUSES.has(res.status) && attempt < attempts - 1) {
        lastError = new SaemolApiError(res.status, await parseBody(res))
        continue
      }

      const body = await parseBody(res)
      if (opts.softStatuses?.includes(res.status)) return body as T
      throw new SaemolApiError(res.status, body)
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
