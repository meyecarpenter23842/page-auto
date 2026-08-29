import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  assertValidAppSettings,
  cloneDefaultAppSettings,
  parseStoredAppSettings
} from './appSettings'

describe('Facebook profile settings', () => {
  it('defaults to PAGE-AUTO managed profiles', () => {
    const settings = cloneDefaultAppSettings()
    expect(settings.browser.profileStorageMode).toBe('managed')
    expect(settings.browser.externalProfileRoot).toBeNull()
  })

  it('keeps old stored settings compatible when profile fields are absent', () => {
    const legacy = JSON.stringify({
      ...DEFAULT_APP_SETTINGS,
      browser: {
        ...DEFAULT_APP_SETTINGS.browser,
        profileStorageMode: undefined,
        externalProfileRoot: undefined
      }
    })
    const parsed = parseStoredAppSettings(legacy)
    expect(parsed.browser.profileStorageMode).toBe('managed')
    expect(parsed.browser.externalProfileRoot).toBeNull()
  })

  it('requires a root when external mode is enabled', () => {
    const settings = cloneDefaultAppSettings()
    settings.browser.profileStorageMode = 'external'
    settings.browser.externalProfileRoot = null
    expect(() => assertValidAppSettings(settings)).toThrow(/externalProfileRoot/)
  })
})
