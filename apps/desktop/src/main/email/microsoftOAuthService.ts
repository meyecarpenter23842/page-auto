import type { HotmailOAuthResult, HotmailOAuthStatus } from '../../shared/hotmail'
import type { HotmailRepository } from '../database/hotmailRepository'
import type { TokenProtector } from './tokenProtector'

interface PendingDeviceFlow {
  deviceCode: string
  expiresAt: number
}

interface DeviceCodeResponse {
  device_code?: unknown
  user_code?: unknown
  verification_uri?: unknown
  expires_in?: unknown
  message?: unknown
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  error?: unknown
  error_description?: unknown
}

const MAIL_SCOPE = 'offline_access https://graph.microsoft.com/Mail.Read'

function oauthResult(status: HotmailOAuthStatus, message: string): HotmailOAuthResult {
  return { status, userCode: null, verificationUri: null, expiresAt: null, message }
}

function formBody(values: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) body.set(key, value)
  return body
}

export class MicrosoftOAuthService {
  private readonly pending = new Map<number, PendingDeviceFlow>()

  constructor(
    private readonly repository: HotmailRepository,
    private readonly protector: TokenProtector
  ) {}

  async start(accountId: number): Promise<HotmailOAuthResult> {
    const settings = this.repository.getSettings()
    if (!settings.oauthClientId) return oauthResult('error', 'Chưa cấu hình Microsoft OAuth Client ID.')

    const tenant = encodeURIComponent(settings.oauthTenant || 'consumers')
    const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({ client_id: settings.oauthClientId, scope: MAIL_SCOPE }),
      signal: AbortSignal.timeout(20_000)
    })
    const payload = await response.json() as DeviceCodeResponse
    if (!response.ok
      || typeof payload.device_code !== 'string'
      || typeof payload.user_code !== 'string'
      || typeof payload.verification_uri !== 'string'
      || typeof payload.expires_in !== 'number') {
      const message = typeof payload.message === 'string' ? payload.message : `Microsoft OAuth HTTP ${response.status}.`
      this.repository.setOAuthState(accountId, 'error', null, message)
      return oauthResult('error', message)
    }

    const expiresAt = Date.now() + payload.expires_in * 1000
    this.pending.set(accountId, { deviceCode: payload.device_code, expiresAt })
    this.repository.setOAuthState(accountId, 'pending', null, null)
    return {
      status: 'pending',
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      expiresAt,
      message: 'Mở trang Microsoft, nhập mã hiển thị rồi bấm Hoàn tất OAuth.'
    }
  }

  async poll(accountId: number): Promise<HotmailOAuthResult> {
    const pending = this.pending.get(accountId)
    if (!pending) return oauthResult('error', 'Không có phiên OAuth đang chờ cho account này.')
    if (Date.now() >= pending.expiresAt) {
      this.pending.delete(accountId)
      this.repository.setOAuthState(accountId, 'expired', null, 'Device code đã hết hạn.')
      return oauthResult('expired', 'Mã OAuth đã hết hạn; hãy kết nối lại.')
    }

    const settings = this.repository.getSettings()
    if (!settings.oauthClientId) return oauthResult('error', 'Chưa cấu hình Microsoft OAuth Client ID.')
    const tenant = encodeURIComponent(settings.oauthTenant || 'consumers')
    const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        client_id: settings.oauthClientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: pending.deviceCode
      }),
      signal: AbortSignal.timeout(20_000)
    })
    const payload = await response.json() as TokenResponse

    if (!response.ok) {
      const error = typeof payload.error === 'string' ? payload.error : 'oauth_error'
      if (error === 'authorization_pending' || error === 'slow_down') {
        return {
          status: 'pending',
          userCode: null,
          verificationUri: null,
          expiresAt: pending.expiresAt,
          message: 'Microsoft chưa xác nhận đăng nhập/consent. Hoàn tất trên trình duyệt rồi thử lại.'
        }
      }
      const status: HotmailOAuthStatus = error === 'expired_token' ? 'expired' : 'error'
      const message = typeof payload.error_description === 'string' ? payload.error_description : error
      this.pending.delete(accountId)
      this.repository.setOAuthState(accountId, status, null, message)
      return oauthResult(status, message)
    }

    if (typeof payload.refresh_token !== 'string' || !payload.refresh_token) {
      this.repository.setOAuthState(accountId, 'error', null, 'Microsoft không trả refresh token.')
      return oauthResult('error', 'Microsoft không trả refresh token; kiểm tra offline_access/public client flow.')
    }

    const protectedToken = this.protector.protect(payload.refresh_token)
    this.repository.setOAuthState(accountId, 'valid', protectedToken, null)
    this.pending.delete(accountId)
    return oauthResult('valid', 'OAuth Microsoft đã kết nối với quyền Mail.Read.')
  }

  async getAccessToken(accountId: number): Promise<string> {
    const settings = this.repository.getSettings()
    if (!settings.oauthClientId) throw new Error('Chưa cấu hình Microsoft OAuth Client ID.')
    const secret = this.repository.getRefreshTokenSecret(accountId)
    if (!secret) {
      this.repository.setOAuthState(accountId, 'missing', null, 'Chưa có refresh token.')
      throw new Error('Account chưa kết nối OAuth Microsoft.')
    }

    const refreshToken = this.protector.unprotect(secret)
    const tenant = encodeURIComponent(settings.oauthTenant || 'consumers')
    const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({
        client_id: settings.oauthClientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: MAIL_SCOPE
      }),
      signal: AbortSignal.timeout(20_000)
    })
    const payload = await response.json() as TokenResponse
    if (!response.ok || typeof payload.access_token !== 'string') {
      const error = typeof payload.error === 'string' ? payload.error : 'oauth_refresh_failed'
      const status: HotmailOAuthStatus = error === 'invalid_grant' ? 'expired' : 'error'
      const message = typeof payload.error_description === 'string' ? payload.error_description : error
      this.repository.setOAuthState(accountId, status, null, message)
      throw new Error(message)
    }

    if (typeof payload.refresh_token === 'string' && payload.refresh_token) {
      this.repository.setOAuthState(accountId, 'valid', this.protector.protect(payload.refresh_token), null)
    } else {
      this.repository.setOAuthState(accountId, 'valid', null, null)
    }
    return payload.access_token
  }
}
