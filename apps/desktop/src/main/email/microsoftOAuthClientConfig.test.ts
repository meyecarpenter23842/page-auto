import { afterEach, describe, expect, it } from 'vitest'
import {
  PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV,
  PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV,
  resolveMicrosoftOAuthClientConfig
} from './microsoftOAuthClientConfig'

const ORIGINAL_CLIENT_ID = process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV]
const ORIGINAL_TENANT = process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV]

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV]
  else process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV] = ORIGINAL_CLIENT_ID

  if (ORIGINAL_TENANT === undefined) delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV]
  else process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV] = ORIGINAL_TENANT
})

describe('resolveMicrosoftOAuthClientConfig', () => {
  it('prefers the Page-Auto bundled client over legacy UI settings', () => {
    process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV] = 'bundled-client'
    process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV] = 'consumers'

    expect(resolveMicrosoftOAuthClientConfig({ oauthClientId: 'legacy-client', oauthTenant: 'legacy-tenant' })).toEqual({
      clientId: 'bundled-client',
      tenant: 'consumers',
      source: 'bundled'
    })
  })

  it('keeps legacy settings as a compatibility fallback', () => {
    delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV]
    delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV]

    expect(resolveMicrosoftOAuthClientConfig({ oauthClientId: ' legacy-client ', oauthTenant: '' })).toEqual({
      clientId: 'legacy-client',
      tenant: 'consumers',
      source: 'legacy_settings'
    })
  })

  it('fails with an app-build error when no client is bundled or saved', () => {
    delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV]
    delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV]

    expect(() => resolveMicrosoftOAuthClientConfig({ oauthClientId: '', oauthTenant: '' }))
      .toThrow('Bản Page-Auto này chưa được đóng gói Microsoft OAuth Client ID.')
  })
})
