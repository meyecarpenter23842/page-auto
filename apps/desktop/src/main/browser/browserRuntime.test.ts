import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import { buildBrowserLaunchOptions } from './browserRuntime'

describe('buildBrowserLaunchOptions', () => {
  it('maps saved browser settings to real Chrome launch options', () => {
    const options = buildBrowserLaunchOptions({
      ...DEFAULT_APP_SETTINGS.browser,
      executablePath: 'C:\\Chrome\\chrome.exe',
      mode: 'minimized',
      windowWidth: 1440,
      windowHeight: 900,
      muteAudio: true,
      disableGpu: true,
      startupTimeoutMs: 42_000
    })

    expect(options.executablePath).toBe('C:\\Chrome\\chrome.exe')
    expect(options.channel).toBeUndefined()
    expect(options.timeout).toBe(42_000)
    expect(options.args).toContain('--start-minimized')
    expect(options.args).toContain('--window-size=1440,900')
    expect(options.args).toContain('--mute-audio')
    expect(options.args).toContain('--disable-gpu')
  })

  it('uses the installed Chrome channel when no custom executable is saved', () => {
    const options = buildBrowserLaunchOptions({ ...DEFAULT_APP_SETTINGS.browser, executablePath: null })
    expect(options.channel).toBe('chrome')
    expect(options.executablePath).toBeUndefined()
  })
})
