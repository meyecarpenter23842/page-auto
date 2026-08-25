import { describe, expect, it } from 'vitest'
import { isManagedPagesSwitchLabel, managedPageHrefMatchesUid } from './managedPagesSwitcher'

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
