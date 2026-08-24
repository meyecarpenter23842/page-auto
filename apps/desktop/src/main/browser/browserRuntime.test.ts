import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import {
  applyBrowserWindowPlacement,
  buildBrowserLaunchOptions,
  compactDeviceMetrics,
  effectiveCompactContentScale,
  fitCompactViewportToInnerArea
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

  it('fits the logical desktop viewport to the real inner area instead of letterboxing', () => {
    expect(effectiveCompactContentScale(placement, 320, 120)).toBe(0.15)
    const fit = fitCompactViewportToInnerArea(placement, 320, 120)
    expect(fit).toEqual({ width: 2133, height: 800, scale: 0.15 })
    expect(fit.width * fit.scale).toBeCloseTo(320, 0)
    expect(fit.height * fit.scale).toBeCloseTo(120, 5)
    expect(compactDeviceMetrics(placement, fit.scale, fit.width, fit.height)).toEqual({
      width: 2133,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 2133,
      screenHeight: 800,
      scale: 0.15
    })
  })

  it('expands height instead when the compact content area is relatively narrow', () => {
    const fit = fitCompactViewportToInnerArea(placement, 200, 200)
    expect(fit.scale).toBe(0.156)
    expect(fit.width).toBe(1282)
    expect(fit.height).toBeGreaterThan(800)
    expect(fit.height * fit.scale).toBeCloseTo(200, 0)
  })

  it('allows very small supported slots to scale below the old 0.08 crop floor', () => {
    expect(effectiveCompactContentScale(placement, 56, 200)).toBe(0.044)
  })

  it('keeps the CDP session attached while compact emulation is active and detaches when cleared', async () => {
    const send = vi.fn(async (method: string) => method === 'Browser.getWindowForTarget' ? { windowId: 7 } : {})
    const detach = vi.fn(async () => undefined)
    const session = { send, detach }
    const context = {
      newCDPSession: vi.fn(async () => session)
    } as unknown as Parameters<typeof applyBrowserWindowPlacement>[0]
    const page = {
      once: vi.fn(),
      waitForTimeout: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => ({ width: 320, height: 120 }))
    } as unknown as Parameters<typeof applyBrowserWindowPlacement>[1]

    await applyBrowserWindowPlacement(context, page, placement)
    expect(detach).not.toHaveBeenCalled()
    const fit = fitCompactViewportToInnerArea(placement, 320, 120)
    expect(send).toHaveBeenCalledWith(
      'Emulation.setDeviceMetricsOverride',
      compactDeviceMetrics(placement, fit.scale, fit.width, fit.height)
    )

    await applyBrowserWindowPlacement(context, page, null)
    expect(context.newCDPSession).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('Emulation.clearDeviceMetricsOverride')
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('uses the installed Chrome channel when no custom executable is saved', () => {
    const options = buildBrowserLaunchOptions({ ...DEFAULT_APP_SETTINGS.browser, executablePath: null })
    expect(options.channel).toBe('chrome')
    expect(options.executablePath).toBeUndefined()
  })
})
