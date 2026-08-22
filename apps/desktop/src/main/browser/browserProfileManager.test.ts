import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accountProfileDirectory } from './browserProfileManager'

describe('accountProfileDirectory', () => {
  it('keeps every account in an isolated persistent profile folder', () => {
    expect(accountProfileDirectory('D:\\PageAutoData', 42)).toBe(
      join('D:\\PageAutoData', 'browser-profiles', 'account-42')
    )
  })
})
