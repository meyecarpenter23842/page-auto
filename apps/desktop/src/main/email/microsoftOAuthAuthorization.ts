import { createHash, randomBytes } from 'node:crypto'

const GRAPH_MAIL_READ_SCOPE = 'offline_access https://graph.microsoft.com/Mail.Read'
export const MICROSOFT_OAUTH_LOOPBACK_REDIRECT_URI = 'http://localhost'

export interface MicrosoftAuthorizationConfig {
  clientId: string
  tenant: string
}

export interface MicrosoftAuthorizationRequest {
  authorizationUrl: string
  redirectUri: string
  state: string
  codeVerifier: string
}

export type MicrosoftOAuthLoopbackResult =
  | { kind: 'code'; code: string }
  | { kind: 'error'; error: string }

export interface MicrosoftAuthorizationTokenResult {
  accessToken: string
  refreshToken: string
}

interface MicrosoftTokenResponse {
  access_token?: string
  refresh_token?: string
  error?: string
}

function oauthEndpoint(tenant: string, path: 'authorize' | 'token'): string {
  const safeTenant = encodeURIComponent(tenant.trim() || 'consumers')
  return `https://login.microsoftonline.com/${safeTenant}/oauth2/v2.0/${path}`
}

function normalizeConfig(input: MicrosoftAuthorizationConfig): MicrosoftAuthorizationConfig {
  const clientId = input.clientId.trim()
  if (!clientId) throw new Error('Chưa cấu hình Microsoft OAuth Client ID cho Hotmail Auto.')
  return { clientId, tenant: input.tenant.trim() || 'consumers' }
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function formBody(values: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) body.set(key, value)
  return body
}

export function createMicrosoftAuthorizationRequest(
  configInput: MicrosoftAuthorizationConfig,
  redirectUri = MICROSOFT_OAUTH_LOOPBACK_REDIRECT_URI
): MicrosoftAuthorizationRequest {
  const config = normalizeConfig(configInput)
  const codeVerifier = base64Url(randomBytes(32))
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())
  const state = base64Url(randomBytes(24))
  const url = new URL(oauthEndpoint(config.tenant, 'authorize'))
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', GRAPH_MAIL_READ_SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('prompt', 'select_account')
  return {
    authorizationUrl: url.toString(),
    redirectUri,
    state,
    codeVerifier
  }
}

export function parseMicrosoftOAuthLoopbackUrl(
  value: string,
  expectedState: string
): MicrosoftOAuthLoopbackResult | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' || url.hostname.toLowerCase() !== 'localhost') return null

  const state = url.searchParams.get('state') ?? ''
  if (!state || state !== expectedState) throw new Error('Microsoft OAuth state không khớp; callback đã bị từ chối.')

  const error = url.searchParams.get('error')
  if (error) return { kind: 'error', error }
  const code = url.searchParams.get('code')
  return code ? { kind: 'code', code } : null
}

export async function exchangeMicrosoftAuthorizationCode(
  configInput: MicrosoftAuthorizationConfig,
  input: { code: string; codeVerifier: string; redirectUri: string }
): Promise<MicrosoftAuthorizationTokenResult> {
  const config = normalizeConfig(configInput)
  const response = await fetch(oauthEndpoint(config.tenant, 'token'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({
      client_id: config.clientId,
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      scope: GRAPH_MAIL_READ_SCOPE
    })
  })

  const text = await response.text()
  let payload: MicrosoftTokenResponse = {}
  try { payload = text ? JSON.parse(text) as MicrosoftTokenResponse : {} } catch { payload = {} }
  if (!response.ok) throw new Error(`Microsoft OAuth ${payload.error ?? `http_${response.status}`}.`)
  if (!payload.access_token) throw new Error('Microsoft OAuth không trả access token.')
  if (!payload.refresh_token) throw new Error('Microsoft OAuth không trả refresh token.')
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token }
}
