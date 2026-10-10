import { afterEach, describe, expect, it } from 'vitest'
import {
  facebookLaunchFingerprint,
  facebookLaunchReuseDecision
} from './facebookLaunchFingerprint'
import {
  clearAllManagedBrowserEndpoints,
  getManagedBrowserEndpoint,
  setManagedBrowserEndpoint
} from './managedBrowserRegistry'

afterEach(() => clearAllManagedBrowserEndpoints())

describe('Facebook canonical launch settings', () => {
  it('changes fingerprint when proxy or UserAgent changes or is cleared', () => {
    const base = {
      profileDirectory: 'F:\\Profiles\\10001',
      userAgent: 'agent-a',
      proxy: { server: 'http://127.0.0.1:8080', username: 'user', password: 'pass' }
    }
    const fingerprint = facebookLaunchFingerprint(base)

    expect(facebookLaunchFingerprint({ ...base })).toBe(fingerprint)
    expect(facebookLaunchFingerprint({ ...base, userAgent: 'agent-b' })).not.toBe(fingerprint)
    expect(facebookLaunchFingerprint({ ...base, userAgent: null })).not.toBe(fingerprint)
    expect(facebookLaunchFingerprint({ ...base, proxy: { ...base.proxy, server: 'http://127.0.0.1:9090' } })).not.toBe(fingerprint)
    expect(facebookLaunchFingerprint({ profileDirectory: base.profileDirectory, userAgent: base.userAgent })).not.toBe(fingerprint)
  })

  it('reuses only identical launch settings and refuses stale managed Chrome endpoints', () => {
    const first = facebookLaunchFingerprint({
      profileDirectory: 'F:\\Profiles\\10001',
      userAgent: 'agent-a'
    })
    const changed = facebookLaunchFingerprint({
      profileDirectory: 'F:\\Profiles\\10001',
      userAgent: 'agent-b'
    })

    expect(facebookLaunchReuseDecision(first, first, false)).toBe('reuse')
    expect(facebookLaunchReuseDecision(first, changed, false)).toBe('replace')
    expect(facebookLaunchReuseDecision(first, changed, true)).toBe('busy')

    setManagedBrowserEndpoint(1, 'http://127.0.0.1:9222', 'F:\\Profiles\\10001', first)
    expect(getManagedBrowserEndpoint(1, 'F:\\Profiles\\10001', first)).toBe('http://127.0.0.1:9222')
    expect(getManagedBrowserEndpoint(1, 'F:\\Profiles\\10001', changed)).toBeNull()
  })
})
