import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import {
  applyBrowserWindowPlacement,
  buildBrowserLaunchOptions,
  compactDeviceMetrics,
  compactWindowSizeChanged,
  effectiveCompactContentScale,
  fitCompactViewportToInnerArea,
  watchForManualBrowserResize
} from './browserRuntime'

const placement: BrowserWindowPlacement = {
  displayId: 1,
  slotIndex: 2,
  x: 640,
  y: 0,
  width: 500,
  height: 500,
  contentScale: 0.391,
  viewportWidth: 1280,
  viewportHeight: 800
}

afterEach(() => {
  vi.useRealTimers()
})

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
    expect(options.args).toContain('--no-default-browser-check')
    expect(options.ignoreDefaultArgs).toEqual(['--enable-automation', '--no-sandbox'])
  })

  it('launches a compact browser in the computed slot and keeps it visible', () => {
    const options = buildBrowserLaunchOptions(
      { ...DEFAULT_APP_SETTINGS.browser, mode: 'minimized' },
      placement
    )
    expect(options.args).toContain('--window-size=500,500')
    expect(options.args).toContain('--window-position=640,0')
    expect(options.args).not.toContain('--start-minimized')
    expect(options.ignoreDefaultArgs).toContain('--enable-automation')
    expect(options.ignoreDefaultArgs).toContain('--no-sandbox')
  })

  it('keeps the legacy scale helpers deterministic for stored-layout compatibility', () => {
    expect(effectiveCompactContentScale(placement, 320, 120)).toBe(0.25)
    const fit = fitCompactViewportToInnerArea(placement, 320, 120)
    expect(fit).toEqual({ width: 1280, height: 480, scale: 0.25 })
    expect(compactDeviceMetrics(placement, fit.scale, fit.width, fit.height)).toEqual({
      width: 1280,
      height: 480,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1280,
      screenHeight: 480,
      scale: 0.25
    })
  })

  it('uses the tile width as the legacy scale anchor instead of shrinking for a short content height', () => {
    const fit = fitCompactViewportToInnerArea(placement, 640, 200)
    expect(fit).toEqual({ width: 1280, height: 400, scale: 0.5 })
    expect(fit.width * fit.scale).toBeCloseTo(640, 5)
    expect(fit.height * fit.scale).toBeCloseTo(200, 5)
  })

  it('recognizes a real manual resize but ignores small Windows bound jitter', () => {
    expect(compactWindowSizeChanged({ width: 500, height: 300 }, { width: 508, height: 292 })).toBe(false)
    expect(compactWindowSizeChanged({ width: 500, height: 300 }, { width: 620, height: 420 })).toBe(true)
  })

  it('tiles native Chrome without enabling device-metrics emulation', async () => {
    const send = vi.fn(async (method: string) => method === 'Browser.getWindowForTarget' ? { windowId: 7 } : {})
    const detach = vi.fn(async () => undefined)
    const session = { send, detach }
    const context = {
      newCDPSession: vi.fn(async () => session)
    } as unknown as Parameters<typeof applyBrowserWindowPlacement>[0]
    const page = {
      once: vi.fn()
    } as unknown as Parameters<typeof applyBrowserWindowPlacement>[1]

    await applyBrowserWindowPlacement(context, page, placement)

    expect(send).toHaveBeenCalledWith('Emulation.clearDeviceMetricsOverride')
    expect(send).toHaveBeenCalledWith('Browser.setWindowBounds', {
      windowId: 7,
      bounds: {
        left: placement.x,
        top: placement.y,
        width: placement.width,
        height: placement.height,
        windowState: 'normal'
      }
    })
    expect(send).not.toHaveBeenCalledWith(
      'Emulation.setDeviceMetricsOverride',
      expect.anything()
    )
    expect(detach).not.toHaveBeenCalled()

    await applyBrowserWindowPlacement(context, page, null)
    expect(context.newCDPSession).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('Browser.setWindowBounds', {
      windowId: 7,
      bounds: { windowState: 'normal' }
    })
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('clears compact state after the operator resizes the native Chrome window', async () => {
    vi.useFakeTimers()
    let boundsRead = 0
    const send = vi.fn(async (method: string) => {
      if (method === 'Browser.getWindowForTarget') return { windowId: 7 }
      if (method === 'Browser.getWindowBounds') {
        boundsRead += 1
        return boundsRead === 1
          ? { bounds: { width: 500, height: 300 } }
          : { bounds: { width: 700, height: 500 } }
      }
      return {}
    })
    const detach = vi.fn(async () => undefined)
    const session = { send, detach }
    const page = {
      once: vi.fn()
    }
    const context = {
      pages: vi.fn(() => [page]),
      newCDPSession: vi.fn(async () => session)
    } as unknown as Parameters<typeof watchForManualBrowserResize>[0]
    const detached = vi.fn()

    const stop = watchForManualBrowserResize(context, detached, 100)
    await vi.advanceTimersByTimeAsync(100)
    expect(detached).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    await Promise.resolve()

    expect(detached).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('Emulation.clearDeviceMetricsOverride')
    expect(detach).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not mistake post-retile window settling for a manual resize', async () => {
    vi.useFakeTimers()
    let boundsRead = 0
    const send = vi.fn(async (method: string) => {
      if (method === 'Browser.getWindowForTarget') return { windowId: 7 }
      if (method === 'Browser.getWindowBounds') {
        boundsRead += 1
        if (boundsRead === 1) return { bounds: { width: 470, height: 270 } }
        if (boundsRead <= 3) return { bounds: { width: 500, height: 300 } }
        return { bounds: { width: 700, height: 500 } }
      }
      return {}
    })
    const detach = vi.fn(async () => undefined)
    const session = { send, detach }
    const page = { once: vi.fn() }
    const context = {
      pages: vi.fn(() => [page]),
      newCDPSession: vi.fn(async () => session)
    } as unknown as Parameters<typeof watchForManualBrowserResize>[0]
    const detached = vi.fn()

    const stop = watchForManualBrowserResize(context, detached, 100, { width: 500, height: 300 })
    await vi.advanceTimersByTimeAsync(300)
    expect(detached).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    await Promise.resolve()
    expect(detached).toHaveBeenCalledTimes(1)
    expect(detach).toHaveBeenCalledTimes(1)
    stop()
  })

  it('uses the installed Chrome channel when no custom executable is saved', () => {
    const options = buildBrowserLaunchOptions({ ...DEFAULT_APP_SETTINGS.browser, executablePath: null })
    expect(options.channel).toBe('chrome')
    expect(options.executablePath).toBeUndefined()
  })
})
