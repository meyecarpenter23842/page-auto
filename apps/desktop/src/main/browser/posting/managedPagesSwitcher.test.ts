import { describe, expect, it } from 'vitest'
import {
  isManagedPagesSwitchLabel,
  managedPageHrefMatchesUid,
  managedPageUidFromHref,
  managedPagesAbsenceConfirmed
} from './managedPagesSwitcher'

describe('managed Pages UID matching', () => {
  it('matches the exact Page UID exposed by profile.php links', () => {
    expect(managedPageHrefMatchesUid(
      '61560036557782',
      'https://www.facebook.com/profile.php?id=61560036557782&__tn__=%3C'
    )).toBe(true)
    expect(managedPageHrefMatchesUid(
      '61560036557782',
      '/profile.php?id=61560036557782'
    )).toBe(true)
  })

  it('rejects a different id even when the expected UID appears elsewhere in the URL', () => {
    expect(managedPageHrefMatchesUid(
      '61560036557782',
      'https://www.facebook.com/profile.php?id=123&next=61560036557782'
    )).toBe(false)
    expect(managedPageHrefMatchesUid(
      '61560036557782',
      'https://example.com/profile.php?id=61560036557782'
    )).toBe(false)
  })

  it('supports Facebook paths whose first segment is exactly the Page UID', () => {
    expect(managedPageHrefMatchesUid(
      '61560036557782',
      'https://www.facebook.com/61560036557782/'
    )).toBe(true)
    expect(managedPageHrefMatchesUid(
      '61560036557782',
      'https://www.facebook.com/615600365577820/'
    )).toBe(false)
  })

  it('keeps unrecognized or vanity links out of absence evidence', () => {
    expect(managedPageUidFromHref('https://www.facebook.com/61560036557782/')).toBe('61560036557782')
    expect(managedPageUidFromHref('/profile.php?id=61560036557782')).toBe('61560036557782')
    expect(managedPageUidFromHref('https://www.facebook.com/my-vanity-page')).toBeNull()
    expect(managedPageUidFromHref('https://example.com/61560036557782')).toBeNull()
  })
})

describe('managed Pages absence evidence', () => {
  const completeEvidence = {
    surfaceRecognized: true,
    explicitEmptyState: false,
    atBottom: true,
    loading: false,
    stableBottomPasses: 2,
    observedPageUidCount: 3
  }

  it('requires a recognized, stable, fully enumerated managed-Pages surface', () => {
    expect(managedPagesAbsenceConfirmed(completeEvidence)).toBe(true)
    expect(managedPagesAbsenceConfirmed({ ...completeEvidence, surfaceRecognized: false })).toBe(false)
    expect(managedPagesAbsenceConfirmed({ ...completeEvidence, atBottom: false })).toBe(false)
    expect(managedPagesAbsenceConfirmed({ ...completeEvidence, loading: true })).toBe(false)
    expect(managedPagesAbsenceConfirmed({ ...completeEvidence, stableBottomPasses: 1 })).toBe(false)
  })

  it('keeps partial or unrecognized link-format surfaces unknown instead of excluding an account', () => {
    expect(managedPagesAbsenceConfirmed({ ...completeEvidence, observedPageUidCount: 0 })).toBe(false)
  })

  it('accepts an explicit no-Pages empty state as positive absence evidence', () => {
    expect(managedPagesAbsenceConfirmed({
      surfaceRecognized: true,
      explicitEmptyState: true,
      atBottom: false,
      loading: false,
      stableBottomPasses: 0,
      observedPageUidCount: 0
    })).toBe(true)
  })
})

describe('managed Pages switch labels', () => {
  it('recognizes English, Vietnamese and Indonesian switch actions', () => {
    expect(isManagedPagesSwitchLabel('Switch Now')).toBe(true)
    expect(isManagedPagesSwitchLabel('Switch to this Page')).toBe(true)
    expect(isManagedPagesSwitchLabel('Chuyển sang trang này')).toBe(true)
    expect(isManagedPagesSwitchLabel('Beralih sekarang')).toBe(true)
    expect(isManagedPagesSwitchLabel('Beralih ke halaman ini')).toBe(true)
    expect(isManagedPagesSwitchLabel('Copy link')).toBe(false)
  })
})
