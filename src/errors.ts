/** SDK가 던지는 모든 에러의 공통 베이스. */
export class SaemolError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'SaemolError'
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause
  }
}

/**
 * 플랫폼 API가 에러 상태코드를 반환했을 때 (연동 설정 문제 — 시크릿 불일치·잘못된 요청 등).
 * 키가 유효하지 않은 정상 케이스(404)는 던지지 않고 `valid: false` 응답으로 반환된다.
 */
export class SaemolApiError extends SaemolError {
  /** HTTP 상태코드 */
  readonly status: number
  /** API가 반환한 reason 필드 (있는 경우) */
  readonly reason: string | null
  /** 파싱된 응답 본문 (JSON이 아니면 null) */
  readonly body: unknown

  constructor(status: number, body: unknown) {
    const reason =
      body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string'
        ? (body as { reason: string }).reason
        : null
    super(`Saemol API 요청 실패 (HTTP ${status})${reason ? `: ${reason}` : ''}`)
    this.name = 'SaemolApiError'
    this.status = status
    this.reason = reason
    this.body = body
  }
}

/** 네트워크 실패·타임아웃 (재시도 소진 후). `cause`에 원본 에러가 담긴다. */
export class SaemolNetworkError extends SaemolError {
  /** 타임아웃으로 인한 실패 여부 */
  readonly timedOut: boolean

  constructor(message: string, options: { cause?: unknown; timedOut?: boolean } = {}) {
    super(message, { cause: options.cause })
    this.name = 'SaemolNetworkError'
    this.timedOut = options.timedOut ?? false
  }
}

/** 웹훅 검증 실패. `code`로 원인을 구분한다. */
export class SaemolWebhookError extends SaemolError {
  readonly code:
    | 'missing_header'        // X-Saemol-* 헤더 누락
    | 'invalid_timestamp'     // 타임스탬프 형식 오류
    | 'timestamp_out_of_tolerance' // 리플레이 윈도(기본 5분) 초과
    | 'invalid_signature'     // HMAC 서명 불일치
    | 'invalid_payload'       // 본문 JSON 파싱·형식 오류

  constructor(code: SaemolWebhookError['code'], message: string) {
    super(message)
    this.name = 'SaemolWebhookError'
    this.code = code
  }
}

/**
 * OAuth 2.0 / SSO 플로우 실패.
 *
 * `code`는 RFC 6749의 오류 코드(플랫폼이 반환)와 SDK가 자체 판정하는 코드를 함께 담는다.
 * 플랫폼에 새 코드가 생겨도 문자열로 그대로 전달된다 — switch의 default를 둘 것.
 */
export class SaemolOAuthError extends SaemolError {
  readonly code:
    | 'access_denied'          // 구매자가 동의 화면에서 거부
    | 'invalid_request'        // 필수 파라미터 누락·형식 오류
    | 'invalid_client'         // client_id/client_secret 불일치
    | 'invalid_grant'          // 코드·리프레시 토큰이 만료·폐기·재사용됨
    | 'unsupported_grant_type'
    | 'invalid_token'          // 액세스 토큰이 만료·폐기됨 (userinfo 401)
    | 'state_mismatch'         // CSRF 방어 — 보낸 state와 돌아온 state가 다름
    | 'missing_code'           // 콜백에 code가 없음
    | (string & {})            // 플랫폼이 새로 추가한 코드
  /** HTTP 상태코드 (네트워크 단계 이전 실패면 null) */
  readonly status: number | null

  constructor(code: SaemolOAuthError['code'], message: string, status: number | null = null) {
    super(message)
    this.name = 'SaemolOAuthError'
    this.code = code
    this.status = status
  }
}
