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
