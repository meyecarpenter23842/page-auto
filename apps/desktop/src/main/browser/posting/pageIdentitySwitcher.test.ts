import { describe, expect, it } from 'vitest'
import {
  classifyPageIdentityUid,
  formatPageIdentityDiagnostics,
  isAccountMenuAccessibleName,
  isDirectSwitchAccessibleName,
  pageIdentityActionRequiresSurfaceVerification,
  resolvePageIdentityAction,
  safePageIdentityUrl,
  shouldRetryPageIdentityAfterControlFailure,
  shouldRetryPageIdentityFromHome,
  targetIdentityScope,
  type PageIdentityEvidence
} from './pageIdentitySwitcher'

function evidence(overrides: Partial<PageIdentityEvidence> = {}): PageIdentityEvidence {
  return {
    stage: 'page_surface',
    uidState: 'missing',
    directSwitchCount: 0,
    accountMenuCount: 0,
    seeAllProfilesCount: 0,
    targetUidCount: 0,
    targetNameCount: 0,
    directAttempted: false,
    ...overrides
  }
}

describe('Page identity state machine', () => {
  it('requires exact i_user match before reporting success', () => {
    expect(classifyPageIdentityUid('90001', null)).toBe('missing')
    expect(classifyPageIdentityUid('90001', '12345')).toBe('other')
    expect(classifyPageIdentityUid('90001', '90001')).toBe('match')
    expect(resolvePageIdentityAction(evidence({ uidState: 'match' }))).toBe('success')
  })

  it('uses direct switch first, then falls back to the account/profile chooser', () => {
    expect(resolvePageIdentityAction(evidence({ directSwitchCount: 1, accountMenuCount: 1 }))).toBe('click_direct_switch')
    expect(resolvePageIdentityAction(evidence({ directAttempted: true, directSwitchCount: 1, accountMenuCount: 1 }))).toBe('open_account_menu')
    expect(resolvePageIdentityAction(evidence({ seeAllProfilesCount: 1 }))).toBe('click_see_all_profiles')
  })

  it('keeps Switch to this Page in the supported direct-switch names', () => {
    expect(isDirectSwitchAccessibleName('Switch now')).toBe(true)
    expect(isDirectSwitchAccessibleName('Switch into this Page')).toBe(true)
    expect(isDirectSwitchAccessibleName('Switch to this Page')).toBe(true)
    expect(isDirectSwitchAccessibleName('Chuyển sang trang này')).toBe(true)
    expect(isDirectSwitchAccessibleName('Accounts Center')).toBe(false)
  })

  it('retries a control-less Page surface or empty first account menu through Facebook home exactly once', () => {
    const emptySurface = evidence()
    const emptyAccountMenu = evidence({ stage: 'account_menu' })
    expect(shouldRetryPageIdentityFromHome(emptySurface, false)).toBe(true)
    expect(shouldRetryPageIdentityFromHome(emptyAccountMenu, false)).toBe(true)
    expect(shouldRetryPageIdentityFromHome(emptySurface, true)).toBe(false)
    expect(shouldRetryPageIdentityFromHome(emptyAccountMenu, true)).toBe(false)
    expect(shouldRetryPageIdentityFromHome(evidence({ stage: 'all_profiles' }), false)).toBe(false)
    expect(shouldRetryPageIdentityFromHome(evidence({ uidState: 'match' }), false)).toBe(false)
  })

  it('runs Home fallback after all account-menu click candidates fail, but only once', () => {
    expect(shouldRetryPageIdentityAfterControlFailure('open_account_menu', 'page_surface', false)).toBe(true)
    expect(shouldRetryPageIdentityAfterControlFailure('open_account_menu', 'page_surface', true)).toBe(false)
    expect(shouldRetryPageIdentityAfterControlFailure('select_target_name', 'account_menu', false)).toBe(false)
  })

  it('requires verified post-conditions before advancing menu surfaces', () => {
    expect(pageIdentityActionRequiresSurfaceVerification('open_account_menu')).toBe(true)
    expect(pageIdentityActionRequiresSurfaceVerification('click_see_all_profiles')).toBe(true)
    expect(pageIdentityActionRequiresSurfaceVerification('select_target_uid')).toBe(false)
    expect(pageIdentityActionRequiresSurfaceVerification('click_direct_switch')).toBe(false)
  })

  it('prefers UID, then See all profiles, then exact Page name in the account menu', () => {
    expect(resolvePageIdentityAction(evidence({
      stage: 'account_menu',
      targetUidCount: 1,
      seeAllProfilesCount: 1,
      targetNameCount: 1
    }))).toBe('select_target_uid')

    expect(resolvePageIdentityAction(evidence({
      stage: 'account_menu',
      seeAllProfilesCount: 1,
      targetNameCount: 1
    }))).toBe('click_see_all_profiles')

    expect(resolvePageIdentityAction(evidence({
      stage: 'account_menu',
      targetNameCount: 1
    }))).toBe('select_target_name')

    expect(resolvePageIdentityAction(evidence({
      stage: 'all_profiles',
      targetNameCount: 1
    }))).toBe('select_target_name')
  })

  it('keeps Page UID/name lookup scoped to the active chooser until all-profiles is verified', () => {
    expect(targetIdentityScope('page_surface')).toBe('none')
    expect(targetIdentityScope('account_menu')).toBe('overlay-only')
    expect(targetIdentityScope('all_profiles')).toBe('verified-all-profiles-surface')
  })

  it('accepts real profile-menu accessible-name suffixes without matching generic account settings', () => {
    expect(isAccountMenuAccessibleName('Account')).toBe(true)
    expect(isAccountMenuAccessibleName('Your profile')).toBe(true)
    expect(isAccountMenuAccessibleName('Your profile, 2 notifications')).toBe(true)
    expect(isAccountMenuAccessibleName('Account menu, 1 notification')).toBe(true)
    expect(isAccountMenuAccessibleName('Account settings')).toBe(false)
    expect(isAccountMenuAccessibleName('Accounts Center')).toBe(false)
  })

  it('fails deterministically when a stage has no supported control after fallback is exhausted', () => {
    expect(resolvePageIdentityAction(evidence())).toBe('fail')
    expect(resolvePageIdentityAction(evidence({ stage: 'account_menu' }))).toBe('fail')
    expect(resolvePageIdentityAction(evidence({ stage: 'all_profiles' }))).toBe('fail')
  })
})

describe('Page identity diagnostics', () => {
  it('strips query/hash, reports i_user state, and includes attempted candidate strategies', () => {
    expect(safePageIdentityUrl('https://www.facebook.com/profile.php?id=90001&token=secret#x')).toBe('https://www.facebook.com/profile.php')
    const message = formatPageIdentityDiagnostics({
      stage: 'all_profiles',
      uidState: 'other',
      directSwitchCount: 1,
      accountMenuCount: 1,
      seeAllProfilesCount: 1,
      targetUidCount: 0,
      targetNameCount: 2,
      directAttempted: true,
      homeFallbackAttempted: true,
      targetNameAvailable: true,
      candidateAttempts: ['open_account_menu:account-semantic-button[0]:no-postcondition'],
      url: 'https://www.facebook.com/profile.php?id=90001&token=secret#x'
    })

    expect(message).toContain('i_user=other')
    expect(message).toContain('controls{direct=1,account=1,seeAll=1,uid=0,name=2}')
    expect(message).toContain('homeFallback=yes')
    expect(message).toContain('attempts=open_account_menu:account-semantic-button[0]:no-postcondition')
    expect(message).toContain('https://www.facebook.com/profile.php')
    expect(message).not.toContain('token=secret')
  })
})
