import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  browserActionDelayRange,
  parseStoredAppSettings,
  randomBrowserActionDelayMs
} from './appSettings'

describe('browser action pacing settings', () => {
  it('defaults to 1-3 seconds and keeps legacy stored settings compatible', () => {
    const parsed = parseStoredAppSettings(JSON.stringify({
      schemaVersion: 1,
      browser: { pageSettleDelayMs: 1500 }
    }))

    expect(browserActionDelayRange(parsed.browser)).toEqual({ minMs: 1000, maxMs: 3000 })
  })

  it('samples inside the configured range', () => {
    const browser = {
      ...DEFAULT_APP_SETTINGS.browser,
      actionDelayMinMs: 1200,
      actionDelayMaxMs: 2800
    }

    expect(randomBrowserActionDelayMs(browser, () => 0)).toBe(1200)
    expect(randomBrowserActionDelayMs(browser, () => 0.5)).toBe(2000)
    expect(randomBrowserActionDelayMs(browser, () => 1)).toBe(2800)
  })
})
