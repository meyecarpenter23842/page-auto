import { describe, expect, it } from 'vitest'
import {
  isMicrosoftAccountHubUrl,
  isMicrosoftSecurityAuthResumeUrl
} from './microsoftSecurityActionEntry'

describe('microsoftSecurityActionEntry', () => {
  it('treats account.microsoft.com as the security session hub', () => {
    expect(isMicrosoftAccountHubUrl('https://account.microsoft.com/?ref=MeControl')).toBe(true)
    expect(isMicrosoftAccountHubUrl('https://account.microsoft.com/security')).toBe(true)
    expect(isMicrosoftAccountHubUrl('https://outlook.live.com/mail/0/')).toBe(false)
  })

  it('does not resume Outlook as a security-action auth flow', () => {
    expect(isMicrosoftSecurityAuthResumeUrl('https://outlook.live.com/mail/0/')).toBe(false)
    expect(isMicrosoftSecurityAuthResumeUrl('https://account.microsoft.com/security')).toBe(false)
  })

  it('resumes only Microsoft login/recovery routes that can block security navigation', () => {
    expect(isMicrosoftSecurityAuthResumeUrl('https://login.live.com/oauth20_authorize.srf')).toBe(true)
    expect(isMicrosoftSecurityAuthResumeUrl('https://login.microsoft.com/consumers/fido/create?mkt=en-US')).toBe(false)
    expect(isMicrosoftSecurityAuthResumeUrl('https://account.live.com/identity/confirm')).toBe(true)
  })
})
