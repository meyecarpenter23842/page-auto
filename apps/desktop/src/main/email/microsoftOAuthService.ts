import type { HotmailOAuthStartResult, HotmailOAuthStatus } from '../../shared/hotmail'
import type { EmailSecretCipher } from './emailSecretStore'

const GRAPH_MAIL_READ_SCOPE = 'offline_access https://graph.microsoft.com/Mail.Read'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval?: number
  message?: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

interface OAuthErrorResponse {
  error?: string
  error_description?: string
}

export interface MicrosoftOAuthConfig {
  clientId: string
  tenant: string
}

export interface OAuthTokenSink {
  saveRefreshToken(ciphertext: string, status: HotmailOAuthStatus): void
  setOAuthStatus(status: HotmailOAuthStatus, error?: string | null): void
}

export interface OAuthTokenSource {
  refreshTokenCiphertext: string | null
}

function endpoint(tenant: string, path: 'devicecode' | 'token'): string {
  const safeTenant = encodeURIComponent(tenant.trim() || 'consumers')
  return `https://login.microsoftonline.com/${safeTenant}/oauth2/v2.0/${path}`
}

function formBody(values: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) body.set(key, value)
  return body
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  let value: unknown = {}
  try { value = text ? JSON.parse(text) : {} } catch { value = {} }
  if (!response.ok) {
    const error = value as OAuthErrorResponse
    const code = error.error ?? `http_${response.status}`
    throw new Error(`Microsoft OAuth ${code}.`)
  }
  return value as T
}

function requireClientId(config: MicrosoftOAuthConfig): MicrosoftOAuthConfig {
  const clientId = config.clientId.trim()
  if (!clientId) throw new Error('Chưa cấu hình Microsoft OAuth Client ID cho Hotmail Auto.')
  return { clientId, tenant: config.tenant.trim() || 'consumers' }
}

export class MicrosoftOAuthService {
  private readonly pending = new Map<number, AbortController>()

  constructor(private readonly cipher: EmailSecretCipher) {}

  async startDeviceCode(
    accountId: number,
    configInput: MicrosoftOAuthConfig,
    sink: OAuthTokenSink
  ): Promise<HotmailOAuthStartResult> {
    const config = requireClientId(configInput)
    this.pending.get(accountId)?.abort()

    const response = await fetch(endpoint(config.tenant, 'devicecode'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({ client_id: config.clientId, scope: GRAPH_MAIL_READ_SCOPE })
    })
    const device = await parseJson<DeviceCodeResponse>(response)
    const expiresAt = Date.now() + Math.max(1, device.expires_in) * 1000
    sink.setOAuthStatus('pending')

    const controller = new AbortController()
    this.pending.set(accountId, controller)
    void this.pollDeviceCode(accountId, config, device, sink, controller).finally(() => {
      if (this.pending.get(accountId) === controller) this.pending.delete(accountId)
    })

    return {
      accountId,
      started: true,
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresAt,
      message: device.message ?? `Mở ${device.verification_uri} và nhập mã ${device.user_code}.`
    }
  }

  async getAccessToken(
    source: OAuthTokenSource,
    configInput: MicrosoftOAuthConfig,
    onRefreshToken?: (ciphertext: string) => void
  ): Promise<string> {
    const config = requireClientId(configInput)
    const ciphertext = source.refreshTokenCiphertext
    if (!ciphertext) throw new Error('Account chưa có Microsoft OAuth refresh token.')
    const refreshToken = this.cipher.decrypt(ciphertext)
    const response = await fetch(endpoint(config.tenant, 'token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        client_id: config.clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: GRAPH_MAIL_READ_SCOPE
      })
    })
    const token = await parseJson<TokenResponse>(response)
    if (!token.access_token) throw new Error('Microsoft OAuth không trả access token.')
    if (token.refresh_token) onRefreshToken?.(this.cipher.encrypt(token.refresh_token))
    return token.access_token
  }

  dispose(): void {
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
  }

  private async pollDeviceCode(
    accountId: number,
    config: MicrosoftOAuthConfig,
    device: DeviceCodeResponse,
    sink: OAuthTokenSink,
    controller: AbortController
  ): Promise<void> {
    const deadline = Date.now() + Math.max(1, device.expires_in) * 1000
    let intervalMs = Math.max(5, device.interval ?? 5) * 1000

    while (!controller.signal.aborted && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
      if (controller.signal.aborted) return

      let response: Response
      try {
        response = await fetch(endpoint(config.tenant, 'token'), {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: formBody({
            client_id: config.clientId,
            grant_type: DEVICE_GRANT,
            device_code: device.device_code
          }),
          signal: controller.signal
        })
      } catch (error) {
        if (controller.signal.aborted) return
        sink.setOAuthStatus('error', error instanceof Error ? error.message : 'OAuth network error')
        return
      }

      const raw = await response.text()
      let payload: TokenResponse & OAuthErrorResponse = {} as TokenResponse & OAuthErrorResponse
      try { payload = raw ? JSON.parse(raw) as TokenResponse & OAuthErrorResponse : payload } catch { /* ignored */ }

      if (response.ok && payload.access_token) {
        if (!payload.refresh_token) {
          sink.setOAuthStatus('error', 'Microsoft không trả refresh token.')
          return
        }
        sink.saveRefreshToken(this.cipher.encrypt(payload.refresh_token), 'valid')
        return
      }

      switch (payload.error) {
        case 'authorization_pending':
          continue
        case 'slow_down':
          intervalMs += 5_000
          continue
        case 'expired_token':
          sink.setOAuthStatus('expired', 'Mã OAuth đã hết hạn.')
          return
        case 'authorization_declined':
          sink.setOAuthStatus('error', 'Người dùng đã từ chối cấp quyền Mail.Read.')
          return
        default:
          sink.setOAuthStatus('error', `Microsoft OAuth ${payload.error ?? `http_${response.status}`}.`)
          return
      }
    }

    if (!controller.signal.aborted) sink.setOAuthStatus('expired', 'Mã OAuth đã hết hạn.')
  }
}
