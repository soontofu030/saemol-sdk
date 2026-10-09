import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SaemolOAuth, isSubscriptionActive, hasPlanFeature } from './oauth'
import { SaemolNetworkError, SaemolOAuthError } from './errors'
import type { OAuthUserInfo } from './types'

// ─────────────────────────────────────────────────────────────
// 모의 플랫폼 — /api/v1/oauth/{token,userinfo}만 흉내 낸다.
// ─────────────────────────────────────────────────────────────

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void

interface RecordedRequest {
  method: string
  url: string
  headers: NodeJS.Dict<string | string[]>
  body: string
}

let server: Server
let baseUrl: string
let handler: Handler
let requests: RecordedRequest[]

function json(status: number, payload: unknown): Handler {
  return (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
}

const TOKENS = {
  access_token:  'at_abc',
  token_type:    'Bearer' as const,
  expires_in:    3600,
  refresh_token: 'rt_xyz',
  scope:         'entitlement' as const,
}

const USER: OAuthUserInfo = {
  sub:        'user-1',
  name:       '김구매',
  email:      'buyer@example.com',
  product_id: 'prod-1',
  scope:      'entitlement',
  entitlement: {
    valid: true, status: 'active', kind: 'subscription',
    plan_name: 'Pro', plan_features: ['core', 'advanced'],
    current_period_end: '2099-08-01T00:00:00Z', expires_at: null, is_trial: false,
  },
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
      handler(req, res, body)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
})

beforeEach(() => {
  requests = []
  handler = json(200, TOKENS)
})

function makeClient(overrides: Partial<ConstructorParameters<typeof SaemolOAuth>[0]> = {}) {
  return new SaemolOAuth({
    clientId:     'cid_1',
    clientSecret: 'csec_1',
    redirectUri:  'https://app.example.com/auth/callback',
    baseUrl,
    ...overrides,
  })
}

describe('생성자', () => {
  it('clientId·clientSecret이 없으면 즉시 실패한다', () => {
    expect(() => new SaemolOAuth({ clientId: '', clientSecret: 'x' })).toThrow(TypeError)
    expect(() => new SaemolOAuth({ clientId: 'x', clientSecret: '' })).toThrow(TypeError)
  })
})

describe('createAuthorizationUrl', () => {
  it('동의 화면 URL과 state를 만든다', () => {
    const { url, state } = makeClient().createAuthorizationUrl()
    const parsed = new URL(url)

    expect(parsed.pathname).toBe('/oauth/authorize')
    expect(parsed.searchParams.get('client_id')).toBe('cid_1')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/auth/callback')
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('state')).toBe(state)
    expect(state.length).toBeGreaterThanOrEqual(16)
  })

  it('scope를 지정하지 않으면 아예 보내지 않는다 — 플랫폼이 기본값(entitlement)을 적용', () => {
    // 신원만 받으려면 { scope: 'identity' }를 명시한다.
    const { url } = makeClient().createAuthorizationUrl()
    expect(new URL(url).searchParams.has('scope')).toBe(false)
  })

  it('client_secret을 URL에 절대 싣지 않는다', () => {
    const { url } = makeClient().createAuthorizationUrl()
    expect(url).not.toContain('csec_1')
  })

  it('호출마다 다른 state를 만든다', () => {
    const client = makeClient()
    expect(client.createAuthorizationUrl().state).not.toBe(client.createAuthorizationUrl().state)
  })

  it('scope·state·redirectUri를 덮어쓸 수 있다', () => {
    const { url, state } = makeClient().createAuthorizationUrl({
      scope: 'identity', state: 'fixed', redirectUri: 'https://other.example.com/cb',
    })
    const parsed = new URL(url)
    expect(parsed.searchParams.get('scope')).toBe('identity')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://other.example.com/cb')
    expect(state).toBe('fixed')
  })

  it('defaultScope를 주면 매 요청에 그 값을 싣는다', () => {
    const { url } = makeClient({ defaultScope: 'identity' }).createAuthorizationUrl()
    expect(new URL(url).searchParams.get('scope')).toBe('identity')
  })

  it('redirectUri가 아예 없으면 실패한다', () => {
    expect(() => new SaemolOAuth({ clientId: 'a', clientSecret: 'b', baseUrl })
      .createAuthorizationUrl()).toThrow(TypeError)
  })
})

describe('exchangeCode', () => {
  it('authorization_code로 토큰을 교환한다', async () => {
    const tokens = await makeClient().exchangeCode({ code: 'code_1' })

    expect(tokens).toEqual(TOKENS)
    expect(requests[0].method).toBe('POST')
    expect(requests[0].url).toBe('/api/v1/oauth/token')
    expect(JSON.parse(requests[0].body)).toEqual({
      grant_type:    'authorization_code',
      client_id:     'cid_1',
      client_secret: 'csec_1',
      code:          'code_1',
      redirect_uri:  'https://app.example.com/auth/callback',
    })
  })

  it('code가 없으면 요청 없이 missing_code로 실패한다', async () => {
    await expect(makeClient().exchangeCode({ code: '' }))
      .rejects.toMatchObject({ name: 'SaemolOAuthError', code: 'missing_code' })
    expect(requests).toHaveLength(0)
  })

  it('invalid_client를 안내 메시지와 함께 던진다', async () => {
    handler = json(401, { error: 'invalid_client' })
    await expect(makeClient().exchangeCode({ code: 'c' })).rejects.toSatisfy((err: unknown) =>
      err instanceof SaemolOAuthError &&
      err.code === 'invalid_client' &&
      err.status === 401 &&
      err.message.includes('client_secret'))
  })

  it('invalid_grant(코드 재사용·만료)를 구분해 던진다', async () => {
    handler = json(400, { error: 'invalid_grant' })
    await expect(makeClient().exchangeCode({ code: 'used' }))
      .rejects.toMatchObject({ code: 'invalid_grant', status: 400 })
  })

  it('플랫폼이 새로 추가한 오류 코드도 그대로 전달한다', async () => {
    handler = json(400, { error: 'some_future_error' })
    await expect(makeClient().exchangeCode({ code: 'c' }))
      .rejects.toMatchObject({ code: 'some_future_error' })
  })

  it('네트워크 실패는 SaemolNetworkError로 감싼다', async () => {
    const dead = makeClient({ baseUrl: 'http://127.0.0.1:1' })
    await expect(dead.exchangeCode({ code: 'c' })).rejects.toBeInstanceOf(SaemolNetworkError)
  })
})

describe('refresh', () => {
  it('refresh_token으로 갱신한다', async () => {
    handler = json(200, { ...TOKENS, access_token: 'at_new', refresh_token: 'rt_new' })
    const tokens = await makeClient().refresh({ refreshToken: 'rt_xyz' })

    expect(tokens.access_token).toBe('at_new')
    // 회전 — 새 리프레시 토큰을 반드시 저장해야 한다
    expect(tokens.refresh_token).toBe('rt_new')
    expect(JSON.parse(requests[0].body)).toEqual({
      grant_type:    'refresh_token',
      client_id:     'cid_1',
      client_secret: 'csec_1',
      refresh_token: 'rt_xyz',
    })
  })

  it('refreshToken이 없으면 요청 없이 실패한다', async () => {
    await expect(makeClient().refresh({ refreshToken: '' }))
      .rejects.toMatchObject({ code: 'invalid_request' })
    expect(requests).toHaveLength(0)
  })
})

describe('getUserInfo', () => {
  it('Bearer 토큰으로 구매자를 조회한다', async () => {
    handler = json(200, USER)
    const user = await makeClient().getUserInfo({ accessToken: 'at_abc' })

    expect(user.sub).toBe('user-1')
    expect(user.entitlement?.plan_name).toBe('Pro')
    expect(requests[0].method).toBe('GET')
    expect(requests[0].url).toBe('/api/v1/oauth/userinfo')
    expect(requests[0].headers.authorization).toBe('Bearer at_abc')
  })

  it('401이면 invalid_token으로 갱신을 안내한다', async () => {
    handler = json(401, { error: 'invalid_token' })
    await expect(makeClient().getUserInfo({ accessToken: 'expired' })).rejects.toSatisfy(
      (err: unknown) => err instanceof SaemolOAuthError && err.code === 'invalid_token' && err.message.includes('refresh()'))
  })

  it('accessToken이 없으면 요청 없이 실패한다', async () => {
    await expect(makeClient().getUserInfo({ accessToken: '' })).rejects.toMatchObject({ code: 'invalid_token' })
    expect(requests).toHaveLength(0)
  })
})

describe('handleCallback', () => {
  /** 토큰 교환 → userinfo 순서로 두 번 응답한다 */
  function tokenThenUser() {
    let call = 0
    handler = (req, res, body) => {
      call += 1
      ;(call === 1 ? json(200, TOKENS) : json(200, USER))(req, res, body)
    }
  }

  it('state 검증 + 코드 교환 + 사용자 조회를 한 번에 처리한다', async () => {
    tokenThenUser()
    const session = await makeClient().handleCallback({
      url: 'https://app.example.com/auth/callback?code=c1&state=s1',
      expectedState: 's1',
    })

    expect(session.tokens.access_token).toBe('at_abc')
    expect(session.user.sub).toBe('user-1')
    expect(requests.map(r => r.url)).toEqual(['/api/v1/oauth/token', '/api/v1/oauth/userinfo'])
  })

  it('state가 다르면 토큰 교환 전에 중단한다', async () => {
    await expect(makeClient().handleCallback({
      url: '?code=c1&state=attacker', expectedState: 's1',
    })).rejects.toMatchObject({ code: 'state_mismatch' })
    expect(requests).toHaveLength(0)
  })

  it('state가 아예 없어도 expectedState를 넘겼으면 거부한다', async () => {
    await expect(makeClient().handleCallback({ url: '?code=c1', expectedState: 's1' }))
      .rejects.toMatchObject({ code: 'state_mismatch' })
  })

  it('expectedState가 누락되면 네트워크 요청 없이 거부한다', async () => {
    await expect(makeClient().handleCallback({ url: '?code=c1' } as never)).rejects.toMatchObject({ code: 'state_mismatch' })
    expect(requests).toHaveLength(0)
  })

  it('동의 거부(access_denied)를 그대로 알려준다', async () => {
    await expect(makeClient().handleCallback({ url: '?error=access_denied&state=s1', expectedState: 's1' }))
      .rejects.toSatisfy((err: unknown) =>
        err instanceof SaemolOAuthError && err.code === 'access_denied' && err.message.includes('거부'))
    expect(requests).toHaveLength(0)
  })

  it('code가 없으면 missing_code로 실패한다', async () => {
    await expect(makeClient().handleCallback({ url: '?foo=bar&state=s1', expectedState: 's1' }))
      .rejects.toMatchObject({ code: 'missing_code' })
  })

  it('URL·URLSearchParams·쿼리 문자열을 모두 받는다', async () => {
    for (const url of [
      'https://app.example.com/cb?code=c1',
      new URL('https://app.example.com/cb?code=c1'),
      new URLSearchParams('code=c1'),
      '?code=c1',
      'code=c1',
    ]) {
      requests = []
      tokenThenUser()
      const query = url instanceof URL ? url.searchParams : url instanceof URLSearchParams ? url : new URLSearchParams(url.includes('?') ? url.split('?')[1] : url)
      query.set('state', 's1')
      const session = await makeClient().handleCallback({ url: query, expectedState: 's1' })
      expect(session.user.sub).toBe('user-1')
    }
  })
})

describe('판정 헬퍼', () => {
  const identityOnly: OAuthUserInfo = {
    sub: 'u', name: null, email: null, product_id: 'p', scope: 'identity',
  }

  it('isSubscriptionActive — 활성 구독만 true', () => {
    expect(isSubscriptionActive(USER)).toBe(true)
    expect(isSubscriptionActive(identityOnly)).toBe(false)
    expect(isSubscriptionActive({ ...USER, entitlement: null })).toBe(false)
    expect(isSubscriptionActive({
      ...USER, entitlement: { ...USER.entitlement!, valid: false, status: 'expired' },
    })).toBe(false)
    expect(isSubscriptionActive(null)).toBe(false)
    expect(isSubscriptionActive(undefined)).toBe(false)
  })

  it('hasPlanFeature — 플랜에 포함된 기능만 true', () => {
    expect(hasPlanFeature(USER, 'advanced')).toBe(true)
    expect(hasPlanFeature(USER, 'api')).toBe(false)
    expect(hasPlanFeature(identityOnly, 'advanced')).toBe(false)
    expect(hasPlanFeature(null, 'advanced')).toBe(false)
  })

  it('hasPlanFeature — 구독이 끊기면 기능도 닫힌다', () => {
    const expired = { ...USER, entitlement: { ...USER.entitlement!, valid: false, status: 'revoked' } }
    expect(hasPlanFeature(expired, 'advanced')).toBe(false)
  })
})
