import { afterEach, describe, expect, it } from 'vitest'
import {
  isMicrosoftOAuthClientId,
  PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV,
  PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV,
  resolveMicrosoftOAuthClientConfig
} from './microsoftOAuthClientConfig'

const ORIGINAL_CLIENT_ID = process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV]
const ORIGINAL_TENANT = process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV]

const BUNDLED_CLIENT_ID = '11111111-2222-3333-4444-555555555555'
const LEGACY_CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV]
  else process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV] = ORIGINAL_CLIENT_ID

  if (ORIGINAL_TENANT === undefined) delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV]
  else process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV] = ORIGINAL_TENANT
})

describe('isMicrosoftOAuthClientId', () => {
  it('accepts Microsoft Application client IDs and rejects placeholders', () => {
    expect(isMicrosoftOAuthClientId(BUNDLED_CLIENT_ID)).toBe(true)
    expect(isMicrosoftOAuthClientId('CLIENT_ID_THAT')).toBe(false)
    expect(isMicrosoftOAuthClientId('bundled-client')).toBe(false)
  })
})

describe('resolveMicrosoftOAuthClientConfig', () => {
  it('prefers the Page-Auto bundled client over legacy UI settings', () => {
    process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV] = BUNDLED_CLIENT_ID
    process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV] = 'consumers'

    expect(resolveMicrosoftOAuthClientConfig({ oauthClientId: LEGACY_CLIENT_ID, oauthTenant: 'legacy-tenant' })).toEqual({
      clientId: BUNDLED_CLIENT_ID,
      tenant: 'consumers',
      source: 'bundled'
    })
  })

  it('ignores an invalid bundled placeholder when a valid legacy client exists', () => {
    process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV] = 'CLIENT_ID_THAT'
    process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV] = 'consumers'

    expect(resolveMicrosoftOAuthClientConfig({ oauthClientId: ` ${LEGACY_CLIENT_ID} `, oauthTenant: '' })).toEqual({
      clientId: LEGACY_CLIENT_ID,
      tenant: 'consumers',
      source: 'legacy_settings'
    })
  })

  it('keeps valid legacy settings as a compatibility fallback', () => {
    delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV]
    delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV]

    expect(resolveMicrosoftOAuthClientConfig({ oauthClientId: ` ${LEGACY_CLIENT_ID} `, oauthTenant: '' })).toEqual({
      clientId: LEGACY_CLIENT_ID,
      tenant: 'consumers',
      source: 'legacy_settings'
    })
  })

  it('rejects placeholder or malformed client IDs before Microsoft OAuth opens', () => {
    process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV] = 'CLIENT_ID_THAT'
    process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV] = 'consumers'

    expect(() => resolveMicrosoftOAuthClientConfig({ oauthClientId: '', oauthTenant: '' }))
      .toThrow('Microsoft OAuth Client ID không hợp lệ')
  })

  it('fails clearly when no client is bundled or saved', () => {
    delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_CLIENT_ID_ENV]
    delete process.env[PAGE_AUTO_MICROSOFT_OAUTH_TENANT_ENV]

    expect(() => resolveMicrosoftOAuthClientConfig({ oauthClientId: '', oauthTenant: '' }))
      .toThrow('Bản Page-Auto này chưa có Microsoft OAuth Client ID hợp lệ.')
  })
})
