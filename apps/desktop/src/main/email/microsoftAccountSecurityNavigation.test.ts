import { describe, expect, it } from 'vitest'
import {
  isMicrosoftAccountHostUrl,
  isMicrosoftFidoCreateUrl,
  isMicrosoftPasswordChangeUrl,
  isMicrosoftSecurityHubUrl,
  isMicrosoftSignInManagementUrl
} from './microsoftAccountSecurityNavigation'

describe('microsoftAccountSecurityNavigation', () => {
  it('recognizes the stable Microsoft account and security hub routes', () => {
    expect(isMicrosoftAccountHostUrl('https://account.microsoft.com/?ref=MeControl')).toBe(true)
    expect(isMicrosoftSecurityHubUrl('https://account.microsoft.com/security')).toBe(true)
    expect(isMicrosoftSecurityHubUrl('https://account.microsoft.com/privacy')).toBe(false)
  })

  it('recognizes live action destinations without using them as entry routes', () => {
    expect(isMicrosoftSignInManagementUrl('https://account.live.com/proofs/manage/additional')).toBe(true)
    expect(isMicrosoftPasswordChangeUrl('https://account.live.com/password/Change')).toBe(true)
  })

  it('detects the passkey/FIDO detour so the worker can stop instead of continuing the wrong action', () => {
    expect(isMicrosoftFidoCreateUrl('https://login.microsoft.com/consumers/fido/create?mkt=en-US')).toBe(true)
    expect(isMicrosoftFidoCreateUrl('https://login.live.com/oauth20_authorize.srf')).toBe(false)
  })
})
