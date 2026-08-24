import { afterEach, describe, expect, it } from 'vitest'
import {
  clearAllManagedBrowserEndpoints,
  clearManagedBrowserEndpoint,
  getManagedBrowserEndpoint,
  setManagedBrowserEndpoint
} from './managedBrowserRegistry'

afterEach(() => clearAllManagedBrowserEndpoints())

describe('managedBrowserRegistry', () => {
  it('keeps endpoints isolated by account and clears closed browsers', () => {
    setManagedBrowserEndpoint(101, 'http://127.0.0.1:9222')
    setManagedBrowserEndpoint(202, 'http://127.0.0.1:9333')

    expect(getManagedBrowserEndpoint(101)).toBe('http://127.0.0.1:9222')
    expect(getManagedBrowserEndpoint(202)).toBe('http://127.0.0.1:9333')

    clearManagedBrowserEndpoint(101)
    expect(getManagedBrowserEndpoint(101)).toBeNull()
    expect(getManagedBrowserEndpoint(202)).toBe('http://127.0.0.1:9333')
  })
})
