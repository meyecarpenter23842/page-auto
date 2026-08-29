import { afterEach, describe, expect, it } from 'vitest'
import {
  clearAllManagedBrowserEndpoints,
  getManagedBrowserEndpoint,
  setManagedBrowserEndpoint
} from './managedBrowserRegistry'

afterEach(() => clearAllManagedBrowserEndpoints())

describe('managedBrowserRegistry profile ownership', () => {
  it('returns an endpoint only for the expected Facebook profile directory', () => {
    setManagedBrowserEndpoint(7, 'http://127.0.0.1:9222', 'F:\\FacebookProfiles\\10007')

    expect(getManagedBrowserEndpoint(7, 'F:\\FacebookProfiles\\10007')).toBe('http://127.0.0.1:9222')
    expect(getManagedBrowserEndpoint(7, 'F:\\OtherRoot\\10007')).toBeNull()
  })

  it('keeps legacy account-only reads compatible when no expected path is supplied', () => {
    setManagedBrowserEndpoint(8, 'http://127.0.0.1:9333', 'F:\\FacebookProfiles\\10008')
    expect(getManagedBrowserEndpoint(8)).toBe('http://127.0.0.1:9333')
  })
})
