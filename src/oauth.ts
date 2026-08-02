import { randomBytes } from 'node:crypto'
import { SaemolNetworkError, SaemolOAuthError } from './errors.js'
import type {
  CreateAuthorizationUrlParams,
  ExchangeCodeParams,
  GetUserInfoParams,
  HandleCallbackParams,
  OAuthScope,
  OAuthSession,
  OAuthTokens,
  OAuthUserInfo,
  RefreshTokensParams,
} from './types.js'

const DEFAULT_BASE_URL = 'https://saemol.com'
const DEFAULT_TIMEOUT_MS = 10_000

export interface SaemolOAuthOptions {
  /** OAuth Client ID — 상품 수정 페이지의 연동 정보 카드에서 확인 */
  clientId: string
  /** OAuth Client Secret — 서버에만 보관할 것 (브라우저 노출 금지) */
  clientSecret: string
  /**
   * 콜백 주소. 상품 설정의 **OAuth Redirect URI에 등록한 값과 정확히 일치**해야 한다
   * (부분 일치·와일드카드 불가 — 오픈 리다이렉트 방지).
   * 여기서 정해두면 이후 호출에서 매번 넘기지 않아도 된다.
   */
  redirectUri?: string
  /**
   * 모든 인가 요청에 붙일 기본 scope. 요청별로 createAuthorizationUrl({ scope })로
   * 덮어쓸 수 있다.
   *
   * 생략하면 요청에 scope 파라미터를 싣지 않으며, 플랫폼이 `entitlement`(로그인 + 구독)를
   * 기본으로 적용한다. 신원만 받는 로그인 화면이라면 `'identity'`를 지정한다.
   */
  defaultScope?: OAuthScope
  /** 플랫폼 주소 (기본: https://saemol.com) */
  baseUrl?: string
  /** 요청당 타임아웃 ms (기본 10초) */
  timeoutMs?: number
  /** fetch 주입 (테스트·폴리필용) */
  fetch?: typeof globalThis.fetch
}

/**
 * 새몰 SSO / OAuth 2.0 클라이언트 — "새몰 계정으로 로그인".
 *
 * 구매자가 별도 회원가입 없이 새몰 계정으로 판매자 서비스에 로그인하고,
 * 판매자는 그 응답만으로 구독 여부·플랜까지 한 번에 확인한다.
 * (API Key 방식과 달리 구매자가 키를 복사·입력할 필요가 없다.)
 *
 * 상품의 **인증 연동 방식**이 "새몰 계정으로 로그인"이어야 동작한다.
 * 신원만 받을지 구독 정보까지 받을지는 인가 요청의 scope로 정한다:
 *  - scope 'identity'    → 신원 확인만 (로그인)
 *  - scope 'entitlement' → 신원 + 구독 정보 (미지정 시 기본값)
 *
 * ```ts
 * const oauth = new SaemolOAuth({
 *   clientId:     process.env.SAEMOL_CLIENT_ID!,
 *   clientSecret: process.env.SAEMOL_CLIENT_SECRET!,
 *   redirectUri:  'https://app.example.com/auth/callback',
 * })
 *
 * // 1) 로그인 버튼 — state를 세션에 저장해 두고 리다이렉트
 * const { url, state } = oauth.createAuthorizationUrl()
 * session.oauthState = state
 * redirect(url)
 *
 * // 2) 콜백 — 한 번의 호출로 state 검증 + 토큰 교환 + 사용자 조회
 * const { user, tokens } = await oauth.handleCallback({
 *   url: request.url,
 *   expectedState: session.oauthState,
 * })
 * if (!isSubscriptionActive(user)) return showPricing()
 * await createSession({ saemolUserId: user.sub, refreshToken: tokens.refresh_token })
 * ```
 */
export class SaemolOAuth {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly redirectUri?: string
  private readonly defaultScope?: OAuthScope
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchFn: typeof globalThis.fetch

  constructor(options: SaemolOAuthOptions) {
    if (!options?.clientId) {
      throw new TypeError('SaemolOAuth: clientId는 필수입니다 (상품 수정 페이지의 연동 정보 카드에서 확인)')
    }
    if (!options.clientSecret) {
      throw new TypeError('SaemolOAuth: clientSecret은 필수입니다 (서버에만 보관할 것)')
    }
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.redirectUri = options.redirectUri
    this.defaultScope = options.defaultScope
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchFn = options.fetch ?? globalThis.fetch
  }

  /**
   * 동의 화면 URL을 만든다 — "새몰 계정으로 로그인" 버튼이 여는 주소.
   *
   * `state`를 넘기지 않으면 SDK가 암호학적 난수로 만들어 함께 반환한다.
   * 반환된 state를 세션에 저장했다가 콜백에서 `expectedState`로 넘길 것 (CSRF 방어).
   *
   * scope를 지정하지 않으면 파라미터 자체를 보내지 않아, 플랫폼이 기본값(entitlement —
   * 로그인 + 구독)을 적용한다. 신원만 받으려면 { scope: 'identity' }.
   */
  createAuthorizationUrl(params: CreateAuthorizationUrlParams = {}): { url: string; state: string } {
    const redirectUri = this.resolveRedirectUri(params.redirectUri)
    const state = params.state ?? randomBytes(16).toString('base64url')

    const qs = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    })

    // 명시했을 때만 싣는다 — 생략하면 플랫폼이 기본값(entitlement)을 적용한다
    const scope = params.scope ?? this.defaultScope
    if (scope) qs.set('scope', scope)

    return { url: `${this.baseUrl}/oauth/authorize?${qs.toString()}`, state }
  }

  /** 인가 코드 → 토큰 교환. 코드는 1회용이며 짧게 만료된다. */
  async exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    if (!params?.code) throw new SaemolOAuthError('missing_code', '인가 코드(code)가 없습니다')

    return this.tokenRequest({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: params.code,
      redirect_uri: this.resolveRedirectUri(params.redirectUri),
    })
  }

  /**
   * 리프레시 토큰으로 갱신. **액세스·리프레시 토큰이 모두 회전(rotation)되므로**
   * 응답의 `refresh_token`을 반드시 새로 저장할 것 — 이전 값은 즉시 무효가 된다.
   */
  async refresh(params: RefreshTokensParams): Promise<OAuthTokens> {
    if (!params?.refreshToken) {
      throw new SaemolOAuthError('invalid_request', 'refreshToken이 없습니다')
    }

    return this.tokenRequest({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: params.refreshToken,
    })
  }

  /**
   * 액세스 토큰으로 로그인한 구매자를 조회한다.
   * scope가 'entitlement'면 이 상품의 구독 상태·플랜이 함께 온다.
   */
  async getUserInfo(params: GetUserInfoParams): Promise<OAuthUserInfo> {
    if (!params?.accessToken) {
      throw new SaemolOAuthError('invalid_token', 'accessToken이 없습니다')
    }

    const res = await this.send(`${this.baseUrl}/api/v1/oauth/userinfo`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    })

    const body = await parseBody(res)
    if (!res.ok) {
      throw new SaemolOAuthError(
        errorCodeOf(body, 'invalid_token'),
        res.status === 401
          ? '액세스 토큰이 만료되었거나 폐기되었습니다 — refresh()로 갱신하세요'
          : `userinfo 조회 실패 (HTTP ${res.status})`,
        res.status,
      )
    }

    return body as OAuthUserInfo
  }

  /**
   * 콜백 한 방 처리 — 오류 파라미터 확인 → state 검증 → 코드 교환 → 사용자 조회.
   *
   * 판매자가 직접 짜야 했던 4단계를 한 번의 호출로 줄인다.
   */
  async handleCallback(params: HandleCallbackParams): Promise<OAuthSession> {
    const query = toSearchParams(params.url)

    // 동의 거부 등 — 플랫폼이 redirect_uri?error=… 로 되돌린 경우
    const error = query.get('error')
    if (error) {
      throw new SaemolOAuthError(
        error,
        error === 'access_denied'
          ? '구매자가 계정 연동을 거부했습니다'
          : `인가 실패: ${error}`,
      )
    }

    // CSRF 방어 — expectedState를 넘긴 경우에만 검사한다
    if (params.expectedState !== undefined) {
      const returned = query.get('state')
      if (!returned || returned !== params.expectedState) {
        throw new SaemolOAuthError(
          'state_mismatch',
          'state가 일치하지 않습니다 — 요청이 위조되었을 수 있어 로그인을 중단했습니다',
        )
      }
    }

    const code = query.get('code')
    if (!code) throw new SaemolOAuthError('missing_code', '콜백에 인가 코드(code)가 없습니다')

    const tokens = await this.exchangeCode({ code, redirectUri: params.redirectUri })
    const user = await this.getUserInfo({ accessToken: tokens.access_token })

    return { tokens, user }
  }

  // ── 내부 ──────────────────────────────────────────────────

  private resolveRedirectUri(override?: string): string {
    const uri = override ?? this.redirectUri
    if (!uri) {
      throw new TypeError(
        'SaemolOAuth: redirectUri가 필요합니다 — 생성자나 호출 인자로 넘기고, ' +
        '상품 설정의 OAuth Redirect URI에 정확히 같은 값을 등록하세요',
      )
    }
    return uri
  }

  private async tokenRequest(payload: Record<string, string>): Promise<OAuthTokens> {
    const res = await this.send(`${this.baseUrl}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const body = await parseBody(res)
    if (!res.ok) {
      const code = errorCodeOf(body, 'invalid_request')
      throw new SaemolOAuthError(code, describeTokenError(code, res.status), res.status)
    }

    return body as OAuthTokens
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      throw new SaemolNetworkError(
        timedOut
          ? `Saemol OAuth 요청 타임아웃 (${this.timeoutMs}ms): ${url}`
          : `Saemol OAuth 요청 실패 (네트워크): ${url}`,
        { cause: err, timedOut },
      )
    }
  }
}

// ── 판정 헬퍼 — 판매자 코드에서 가장 자주 쓰는 두 가지 ────────

/**
 * 지금 이 구매자에게 서비스를 열어줘도 되는지.
 * scope='identity'(SSO 전용)면 구독 정보가 없으므로 항상 false —
 * 신원만 확인하는 서비스라면 이 함수를 쓰지 말 것.
 */
export function isSubscriptionActive(user: OAuthUserInfo | null | undefined): boolean {
  return user?.entitlement?.valid === true
}

/**
 * 이 구매자의 플랜에 특정 기능이 포함되는지 —
 * 판매자가 상품 설정의 `plan_features`에 등록한 이름으로 확인한다.
 *
 * ```ts
 * if (hasPlanFeature(user, 'advanced')) enableAdvancedExport()
 * ```
 */
export function hasPlanFeature(user: OAuthUserInfo | null | undefined, feature: string): boolean {
  if (!isSubscriptionActive(user)) return false
  return user?.entitlement?.plan_features?.includes(feature) === true
}

// ── 유틸 ──────────────────────────────────────────────────

function toSearchParams(url: string | URL | URLSearchParams): URLSearchParams {
  if (url instanceof URLSearchParams) return url
  if (url instanceof URL) return url.searchParams
  // 전체 URL·'?a=b'·'a=b' 모두 허용
  const idx = url.indexOf('?')
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : url)
}

async function parseBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function errorCodeOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error
  }
  return fallback
}

function describeTokenError(code: string, status: number): string {
  switch (code) {
    case 'invalid_client':
      return 'client_id 또는 client_secret이 일치하지 않습니다 — 상품 수정 페이지의 연동 정보를 확인하세요'
    case 'invalid_grant':
      return '인가 코드나 리프레시 토큰이 만료·폐기되었거나 이미 사용되었습니다 — 로그인을 다시 시작하세요'
    case 'invalid_request':
      return '요청 파라미터가 올바르지 않습니다 — redirect_uri가 인가 요청 때와 정확히 같은지 확인하세요'
    case 'unsupported_grant_type':
      return '지원하지 않는 grant_type입니다'
    default:
      return `토큰 요청 실패 (HTTP ${status}): ${code}`
  }
}
