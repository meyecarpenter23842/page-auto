import { describe, expect, it } from 'vitest'
import { workerProfileReuseDecision } from './workerProfileOwnership'

describe('worker profile ownership', () => {
  it('reuses a worker for the same profile path', () => {
    expect(workerProfileReuseDecision(
      'F:\\FacebookProfiles\\10001\\',
      'f:\\facebookprofiles\\10001',
      false
    )).toBe('reuse')
  })

  it('replaces an idle worker when the profile path changes', () => {
    expect(workerProfileReuseDecision(
      'F:\\FacebookProfiles\\10001',
      'G:\\FacebookProfiles\\10001',
      false
    )).toBe('replace')
  })

  it('refuses to switch profile ownership while the worker is busy', () => {
    expect(workerProfileReuseDecision(
      'F:\\FacebookProfiles\\10001',
      'G:\\FacebookProfiles\\10001',
      true
    )).toBe('busy')
  })

  it('replaces a managed-profile worker when switching to external Root\\UID', () => {
    expect(workerProfileReuseDecision(
      'C:\\PageAuto\\data\\browser-profiles\\account-7',
      'F:\\FacebookProfiles\\10007',
      false
    )).toBe('replace')
  })
})
