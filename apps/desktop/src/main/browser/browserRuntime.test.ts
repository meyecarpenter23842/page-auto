import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import {
  buildBrowserLaunchOptions,
  compactDeviceMetrics,
  effectiveCompactContentScale
} from './browserRuntime'

const placement: BrowserWindowPlacement = {
  displayId: 1,
  slotIndex: 2,
  x: 640,
  y: 0,
  width: 320,
  height: 200,
  contentScale: 0.25,
  viewportWidth: 1280,
  viewportHeight: 800
}

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

  it('launches a compact browser in the computed slot and keeps it visible', () => {
    const options = buildBrowserLaunchOptions(
      { ...DEFAULT_APP_SETTINGS.browser, mode: 'minimized' },
      placement
    )
    expect(options.args).toContain('--window-size=320,200')
    expect(options.args).toContain('--window-position=640,0')
    expect(options.args).not.toContain('--start-minimized')
    expect(options.args.some((arg) => arg.startsWith('--force-device-scale-factor='))).toBe(false)
  })

  it('uses the real inner content area so Chrome toolbar height cannot crop the scaled page', () => {
    expect(effectiveCompactContentScale(placement, 320, 120)).toBe(0.15)
    expect(compactDeviceMetrics(placement, 0.15)).toEqual({
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1280,
      screenHeight: 800,
      scale: 0.15
    })
  })

  it('uses the installed Chrome channel when no custom executable is saved', () => {
    const options = buildBrowserLaunchOptions({ ...DEFAULT_APP_SETTINGS.browser, executablePath: null })
    expect(options.channel).toBe('chrome')
    expect(options.executablePath).toBeUndefined()
  })
})
