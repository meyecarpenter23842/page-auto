import { describe, expect, it } from 'vitest'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import { managedCdpEndpointFromArgs, managedCompactLaunchArgs } from './managedBrowserBridge'

const manualPlacement: BrowserWindowPlacement = {
  displayId: 1,
  slotIndex: 0,
  x: 100,
  y: 80,
  width: 500,
  height: 400,
  contentScale: 0.391,
  viewportWidth: 1280,
  viewportHeight: 800
}

describe('managedBrowserBridge', () => {
  it('reads the managed Chrome endpoint from posting-worker arguments', () => {
    expect(managedCdpEndpointFromArgs(['electron', 'posting-worker.js'])).toBeNull()
    expect(managedCdpEndpointFromArgs([
      'electron',
      'posting-worker.js',
      '--page-auto-managed-cdp=http://127.0.0.1:9222'
    ])).toBe('http://127.0.0.1:9222')
  })

  it('keeps manual Compact native and does not add whole-Chrome scale', () => {
    const args = managedCompactLaunchArgs(['--start-minimized', '--mute-audio'], manualPlacement)
    expect(args).toContain('--window-size=500,400')
    expect(args).toContain('--window-position=100,80')
    expect(args).toContain('--mute-audio')
    expect(args.some((arg) => arg.startsWith('--force-device-scale-factor='))).toBe(false)
    expect(args).not.toContain('--start-minimized')
  })

  it('rewrites posting fallback launch args for whole-Chrome Auto Fit', () => {
    const placement: BrowserWindowPlacement = {
      ...manualPlacement,
      x: 765,
      y: 515,
      width: 1250,
      height: 783,
      contentScale: 0.4,
      wholeChromeScale: 0.4
    }
    const args = managedCompactLaunchArgs([
      '--window-size=500,313',
      '--window-position=306,206',
      '--force-device-scale-factor=0.5',
      '--mute-audio'
    ], placement)

    expect(args).toContain('--window-size=1250,783')
    expect(args).toContain('--window-position=765,515')
    expect(args).toContain('--force-device-scale-factor=0.4')
    expect(args).toContain('--mute-audio')
    expect(args).not.toContain('--window-size=500,313')
    expect(args).not.toContain('--force-device-scale-factor=0.5')
  })
})
