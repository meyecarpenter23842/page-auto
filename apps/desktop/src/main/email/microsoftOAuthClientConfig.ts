export interface MicrosoftOAuthClientConfig {
  clientId: string
  tenant: string
  source: 'bundled' | 'legacy_settings'
}

export interface MicrosoftOAuthClientSettings {
  oauthClientId: string
  oauthTenant: string
}

export const PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV = 'PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID'
export const PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV = 'PAGE_AUTO_MICROSOFT_OAUTH_TENANT'

const MICROSOFT_APPLICATION_CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function envValue(name: string): string {
  return process.env[name]?.trim() ?? ''
}

export function isMicrosoftOAuthClientId(value: string): boolean {
  return MICROSOFT_APPLICATION_CLIENT_ID.test(value.trim())
}

export function resolveMicrosoftOAuthClientConfig(settings: MicrosoftOAuthClientSettings): MicrosoftOAuthClientConfig {
  const bundledClientId = envValue(PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV)
  if (bundledClientId && isMicrosoftOAuthClientId(bundledClientId)) {
    return {
      clientId: bundledClientId,
      tenant: envValue(PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV) || 'consumers',
      source: 'bundled'
    }
  }

  const legacyClientId = settings.oauthClientId.trim()
  if (legacyClientId && isMicrosoftOAuthClientId(legacyClientId)) {
    return {
      clientId: legacyClientId,
      tenant: settings.oauthTenant.trim() || 'consumers',
      source: 'legacy_settings'
    }
  }

  if (bundledClientId || legacyClientId) {
    throw new Error('Microsoft OAuth Client ID không hợp lệ. PAGE-AUTO cần Application (client) ID dạng GUID của app Microsoft đã đăng ký; không dùng placeholder như CLIENT_ID_THAT.')
  }

  throw new Error('Bản Page-Auto này chưa có Microsoft OAuth Client ID hợp lệ.')
}
