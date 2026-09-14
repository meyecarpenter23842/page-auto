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

function envValue(name: string): string {
  return process.env[name]?.trim() ?? ''
}

export function resolveMicrosoftOAuthClientConfig(settings: MicrosoftOAuthClientSettings): MicrosoftOAuthClientConfig {
  const bundledClientId = envValue(PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV)
  if (bundledClientId) {
    return {
      clientId: bundledClientId,
      tenant: envValue(PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV) || 'consumers',
      source: 'bundled'
    }
  }

  const legacyClientId = settings.oauthClientId.trim()
  if (legacyClientId) {
    return {
      clientId: legacyClientId,
      tenant: settings.oauthTenant.trim() || 'consumers',
      source: 'legacy_settings'
    }
  }

  throw new Error('Bản Page-Auto này chưa được đóng gói Microsoft OAuth Client ID.')
}
