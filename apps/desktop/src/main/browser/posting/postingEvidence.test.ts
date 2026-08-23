import { describe, expect, it } from 'vitest'
import { safeFailureUrl } from './postingEvidence'

describe('safeFailureUrl', () => {
  it('removes query and hash before a failure URL is logged', () => {
    expect(safeFailureUrl('https://www.facebook.com/groups/123?token=secret#section')).toBe('https://www.facebook.com/groups/123')
  })

  it('rejects non-http protocols and malformed input', () => {
    expect(safeFailureUrl('javascript:alert(1)')).toBeNull()
    expect(safeFailureUrl('not a url')).toBeNull()
  })
})
