import { describe, expect, it } from 'vitest'
import {
  classifyPageIdentityUid,
  formatPageIdentityDiagnostics,
  resolvePageIdentityAction,
  safePageIdentityUrl,
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

  it('prefers UID evidence inside the chooser and only uses Page name on the all-profiles surface', () => {
    expect(resolvePageIdentityAction(evidence({
      stage: 'account_menu',
      targetUidCount: 1,
      seeAllProfilesCount: 1
    }))).toBe('select_target_uid')

    expect(resolvePageIdentityAction(evidence({
      stage: 'account_menu',
      targetNameCount: 1
    }))).toBe('fail')

    expect(resolvePageIdentityAction(evidence({
      stage: 'all_profiles',
      targetNameCount: 1
    }))).toBe('select_target_name')
  })

  it('fails deterministically when a stage has no supported control', () => {
    expect(resolvePageIdentityAction(evidence())).toBe('fail')
    expect(resolvePageIdentityAction(evidence({ stage: 'account_menu' }))).toBe('fail')
    expect(resolvePageIdentityAction(evidence({ stage: 'all_profiles' }))).toBe('fail')
  })
})

describe('Page identity diagnostics', () => {
  it('strips query/hash and reports i_user state instead of a raw foreign UID', () => {
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
      targetNameAvailable: true,
      url: 'https://www.facebook.com/profile.php?id=90001&token=secret#x'
    })

    expect(message).toContain('i_user=other')
    expect(message).toContain('controls{direct=1,account=1,seeAll=1,uid=0,name=2}')
    expect(message).toContain('https://www.facebook.com/profile.php')
    expect(message).not.toContain('token=secret')
  })
})
