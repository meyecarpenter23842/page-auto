import { describe, expect, it } from 'vitest'
import {
  classifyPageIdentityUid,
  formatPageIdentityDiagnostics,
  isAccountMenuAccessibleName,
  isDirectSwitchAccessibleName,
  isTargetProfileAccessibleName,
  pageIdentityActionRequiresSurfaceVerification,
  pageIdentitySurfaceAdvanced,
  resolvePageIdentityAction,
  safePageIdentityUrl,
  shouldRetryPageIdentityAfterControlFailure,
  shouldRetryPageIdentityFromHome,
  targetIdentityScope,
  type PageIdentityEvidence,
  type PageIdentitySurfaceSnapshot
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

function surface(overrides: Partial<PageIdentitySurfaceSnapshot> = {}): PageIdentitySurfaceSnapshot {
  return {
    url: 'https://www.facebook.com/',
    chooserRootCount: 1,
    dialogCount: 0,
    chooserMarkerCount: 1,
    targetUidCount: 0,
    targetNameCount: 0,
    seeAllProfilesCount: 1,
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

  it('selects a target already visible in the account menu before opening See all profiles', () => {
    expect(resolvePageIdentityAction(evidence({
      stage: 'account_menu',
      targetUidCount: 1,
      targetNameCount: 1,
      seeAllProfilesCount: 1
    }))).toBe('select_target_uid')

    expect(resolvePageIdentityAction(evidence({
      stage: 'account_menu',
      targetNameCount: 1,
      seeAllProfilesCount: 1
    }))).toBe('select_target_name')
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

  it('runs Home fallback after account-menu failure, but only once', () => {
    expect(shouldRetryPageIdentityAfterControlFailure('open_account_menu', 'page_surface', false)).toBe(true)
    expect(shouldRetryPageIdentityAfterControlFailure('open_account_menu', 'page_surface', true)).toBe(false)
    expect(shouldRetryPageIdentityAfterControlFailure('select_target_name', 'account_menu', false)).toBe(false)
  })

  it('requires verified post-conditions before advancing chooser surfaces', () => {
    expect(pageIdentityActionRequiresSurfaceVerification('open_account_menu')).toBe(true)
    expect(pageIdentityActionRequiresSurfaceVerification('click_see_all_profiles')).toBe(true)
    expect(pageIdentityActionRequiresSurfaceVerification('select_target_uid')).toBe(false)
    expect(pageIdentityActionRequiresSurfaceVerification('click_direct_switch')).toBe(false)
  })

  it('keeps Page UID/name lookup scoped until all-profiles is verified', () => {
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

  it('keeps all supported direct-switch labels actionable', () => {
    expect(isDirectSwitchAccessibleName('Switch now')).toBe(true)
    expect(isDirectSwitchAccessibleName('Switch into this Page')).toBe(true)
    expect(isDirectSwitchAccessibleName('Switch to this Page')).toBe(true)
    expect(isDirectSwitchAccessibleName('Chuyển sang Trang này')).toBe(true)
  })

  it('matches Page rows that append Page/Profile metadata but not unrelated similar names', () => {
    expect(isTargetProfileAccessibleName('Hưng Phát', 'Hưng Phát')).toBe(true)
    expect(isTargetProfileAccessibleName('Hưng Phát', 'Hưng Phát · Page')).toBe(true)
    expect(isTargetProfileAccessibleName('Hưng Phát', 'Hưng Phát - Trang')).toBe(true)
    expect(isTargetProfileAccessibleName('Hưng Phát', 'Hưng Phát Profile')).toBe(true)
    expect(isTargetProfileAccessibleName('Hưng Phát', 'Hưng Phát Store')).toBe(false)
    expect(isTargetProfileAccessibleName('Hưng Phát', 'Shop Hưng Phát')).toBe(false)
  })

  it('fails deterministically when a stage has no supported control after fallback is exhausted', () => {
    expect(resolvePageIdentityAction(evidence())).toBe('fail')
    expect(resolvePageIdentityAction(evidence({ stage: 'account_menu' }))).toBe('fail')
    expect(resolvePageIdentityAction(evidence({ stage: 'all_profiles' }))).toBe('fail')
  })
})

describe('Page identity chooser transitions', () => {
  it('accepts a target appearing in the same chooser root after See all profiles', () => {
    expect(pageIdentitySurfaceAdvanced(
      surface(),
      surface({ targetNameCount: 1 })
    )).toBe(true)
  })

  it('accepts a new chooser/dialog surface with chooser evidence', () => {
    expect(pageIdentitySurfaceAdvanced(
      surface({ chooserRootCount: 1, dialogCount: 0 }),
      surface({ chooserRootCount: 2, dialogCount: 1, chooserMarkerCount: 1 })
    )).toBe(true)
  })

  it('accepts a verified full-page chooser route transition', () => {
    expect(pageIdentitySurfaceAdvanced(
      surface({ url: 'https://www.facebook.com/' }),
      surface({ url: 'https://www.facebook.com/profiles/select/', targetUidCount: 1 })
    )).toBe(true)
  })

  it('accepts See all profiles being consumed into a target list even when the root shape is unchanged', () => {
    expect(pageIdentitySurfaceAdvanced(
      surface({ seeAllProfilesCount: 1, targetNameCount: 1 }),
      surface({ seeAllProfilesCount: 0, targetNameCount: 1 })
    )).toBe(true)
  })

  it('rejects a no-op See all profiles click that leaves the same old menu visible', () => {
    expect(pageIdentitySurfaceAdvanced(surface(), surface())).toBe(false)
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
