import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMicrosoftAuthorizationRequest,
  exchangeMicrosoftAuthorizationCode,
  MICROSOFT_OAUTH_LOOPBACK_REDIRECT_URI,
  parseMicrosoftOAuthLoopbackUrl
} from './microsoftOAuthAuthorization'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('microsoftOAuthAuthorization', () => {
  it('builds a public-client authorization-code request with PKCE', () => {
    const request = createMicrosoftAuthorizationRequest({ clientId: 'client-123', tenant: 'consumers' })
    const url = new URL(request.authorizationUrl)

    expect(url.origin).toBe('https://login.microsoftonline.com')
    expect(url.pathname).toBe('/consumers/oauth2/v2.0/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(MICROSOFT_OAUTH_LOOPBACK_REDIRECT_URI)
    expect(url.searchParams.get('scope')).toContain('Mail.Read')
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(request.codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(request.state).toBeTruthy()
  })

  it('accepts only the expected localhost callback state', () => {
    expect(parseMicrosoftOAuthLoopbackUrl('https://example.com/?code=nope', 'state-1')).toBeNull()
    expect(parseMicrosoftOAuthLoopbackUrl('http://localhost/?code=abc&state=state-1', 'state-1')).toEqual({
      kind: 'code',
      code: 'abc'
    })
    expect(() => parseMicrosoftOAuthLoopbackUrl('http://localhost/?code=abc&state=wrong', 'state-1'))
      .toThrow(/state không khớp/i)
  })

  it('exchanges the code without a client secret and requires a refresh token', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code_verifier')).toBe('verifier')
      expect(body.get('client_secret')).toBeNull()
      return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeMicrosoftAuthorizationCode(
      { clientId: 'client-123', tenant: 'consumers' },
      { code: 'code-123', codeVerifier: 'verifier', redirectUri: MICROSOFT_OAUTH_LOOPBACK_REDIRECT_URI }
    )).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
