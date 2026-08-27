import { describe, expect, it } from 'vitest'
import { microsoftAccountPickerEntryMatchesCanonicalEmail } from './emailLoginPolicy'

describe('Microsoft account picker canonical Email matching', () => {
  it('accepts the canonical Email and rejects other saved accounts', () => {
    expect(microsoftAccountPickerEntryMatchesCanonicalEmail('Example User\ncanonical@example.com', ' CANONICAL@example.com ')).toBe(true)
    expect(microsoftAccountPickerEntryMatchesCanonicalEmail('Other User\nother@example.com', 'canonical@example.com')).toBe(false)
    expect(microsoftAccountPickerEntryMatchesCanonicalEmail('Other User\ncanonical@example.com.evil', 'canonical@example.com')).toBe(false)
  })
})
