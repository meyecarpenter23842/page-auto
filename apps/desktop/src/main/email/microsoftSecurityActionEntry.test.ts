import { describe, expect, it } from 'vitest'
import {
  isMicrosoftAccountHubUrl,
  isMicrosoftSecurityAuthResumeUrl,
  selectMicrosoftAccountHomePageIndex
} from './microsoftSecurityActionEntry'

describe('microsoftSecurityActionEntry', () => {
  it('treats account.microsoft.com as the security session hub', () => {
    expect(isMicrosoftAccountHubUrl('https://account.microsoft.com/?ref=MeControl')).toBe(true)
    expect(isMicrosoftAccountHubUrl('https://account.microsoft.com/security')).toBe(true)
    expect(isMicrosoftAccountHubUrl('https://outlook.live.com/mail/0/')).toBe(false)
  })

  it('preserves a logged-in Outlook tab and opens Security in a separate page', () => {
    expect(selectMicrosoftAccountHomePageIndex([
      { url: 'https://outlook.live.com/mail/0/', closed: false }
    ])).toBeNull()
  })

  it('reuses the sole initial blank page instead of creating an unnecessary tab', () => {
    expect(selectMicrosoftAccountHomePageIndex([
      { url: 'about:blank', closed: false }
    ])).toBe(0)
  })

  it('reuses an existing Microsoft account hub page without touching Outlook', () => {
    expect(selectMicrosoftAccountHomePageIndex([
      { url: 'https://outlook.live.com/mail/0/', closed: false },
      { url: 'https://account.microsoft.com/security', closed: false }
    ])).toBe(1)
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
