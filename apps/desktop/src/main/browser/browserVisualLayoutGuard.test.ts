import { describe, expect, it } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import type { BrowserVisualBaselineMetrics } from '../../shared/browserVisualBaseline'
import {
  captureBrowserVisualLayoutBaseline,
  ensureBrowserVisualLayout,
  readBrowserVisualMetrics
} from './browserVisualLayoutGuard'

const baselineMetrics: BrowserVisualBaselineMetrics = {
  outerWidth: 900,
  outerHeight: 620,
  innerWidth: 884,
  innerHeight: 551,
  devicePixelRatio: 1.25,
  visualViewportWidth: 884,
  visualViewportHeight: 551,
  visualViewportScale: 1
}

function pageWithMetrics(sequence: BrowserVisualBaselineMetrics[]): Page {
  let index = 0
  return {
    evaluate: async () => sequence[Math.min(index++, sequence.length - 1)]
  } as unknown as Page
}

function state() {
  return { browserScale: 0.4, compact: true, manualResizeDetached: false }
}

describe('browserVisualLayoutGuard', () => {
  it('bounds renderer metric reads so a stalled evaluate cannot hold the worker queue forever', async () => {
    const page = {
      evaluate: async () => new Promise<never>(() => undefined)
    } as unknown as Page

    const startedAt = Date.now()
    const result = await readBrowserVisualMetrics(page, 20)
    expect(result).toBeNull()
    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it('captures the stable live safe-boundary metrics when no guard baseline exists yet', async () => {
    const context = {} as BrowserContext
    const facebookMetrics = {
      ...baselineMetrics,
      innerWidth: 1225,
      innerHeight: 687,
      devicePixelRatio: 0.32,
      visualViewportWidth: 1225,
      visualViewportHeight: 687.5
    }
    const page = pageWithMetrics([facebookMetrics, facebookMetrics, facebookMetrics])

    const result = await ensureBrowserVisualLayout({
      context,
      page,
      readState: state,
      recover: async () => 'recovered'
    })

    expect(result.status).toBe('captured')
    expect(result.drift).toEqual([])
    expect(result.snapshot).toMatchObject(facebookMetrics)
  })

  it('does not persist a transient post-placement frame as the canonical baseline', async () => {
    const context = {} as BrowserContext
    const transient = {
      ...baselineMetrics,
      innerWidth: 1030,
      visualViewportWidth: 1030
    }
    const page = pageWithMetrics([transient, baselineMetrics, baselineMetrics, baselineMetrics])

    const snapshot = await captureBrowserVisualLayoutBaseline(context, page, state())

    expect(snapshot).not.toBeNull()
    expect(snapshot?.innerWidth).toBe(baselineMetrics.innerWidth)
    expect(snapshot?.visualViewportWidth).toBe(baselineMetrics.visualViewportWidth)
  })

  it('recovers resize drift and verifies the measured baseline again before allowing the action', async () => {
    const context = {} as BrowserContext
    const resized = { ...baselineMetrics, outerWidth: 1060, innerWidth: 1044, visualViewportWidth: 1044 }
    const page = pageWithMetrics([
      baselineMetrics,
      baselineMetrics,
      baselineMetrics,
      resized,
      baselineMetrics
    ])
    await captureBrowserVisualLayoutBaseline(context, page, state())
    let recoverCalls = 0

    const result = await ensureBrowserVisualLayout({
      context,
      page,
      readState: state,
      recover: async () => {
        recoverCalls += 1
        return 'recovered'
      }
    })

    expect(recoverCalls).toBe(1)
    expect(result.status).toBe('recovered')
    expect(result.drift).toContain('window_bounds')
  })

  it('waits for renderer reflow to settle after native recovery instead of false-failing a stale first read', async () => {
    const context = {} as BrowserContext
    const resized = { ...baselineMetrics, outerWidth: 1060, innerWidth: 1044, visualViewportWidth: 1044 }
    const page = pageWithMetrics([
      baselineMetrics,
      baselineMetrics,
      baselineMetrics,
      resized,
      resized,
      baselineMetrics
    ])
    await captureBrowserVisualLayoutBaseline(context, page, state())

    const result = await ensureBrowserVisualLayout({
      context,
      page,
      readState: state,
      recover: async () => 'recovered'
    })

    expect(result.status).toBe('recovered')
    expect(result.drift).toContain('window_bounds')
    expect(result.snapshot?.outerWidth).toBe(baselineMetrics.outerWidth)
  })

  it('refreshes only renderer geometry after an explicitly verified Compact placement recovery', async () => {
    const context = {} as BrowserContext
    const resized = {
      ...baselineMetrics,
      outerWidth: 1060,
      innerWidth: 1044,
      visualViewportWidth: 1044
    }
    const settledAfterPlacement = {
      ...baselineMetrics,
      outerWidth: 904,
      innerWidth: 888,
      visualViewportWidth: 888
    }
    let detached = false
    const readState = () => ({ browserScale: 0.4, compact: true, manualResizeDetached: detached })
    const page = pageWithMetrics([
      baselineMetrics,
      baselineMetrics,
      baselineMetrics,
      resized,
      settledAfterPlacement,
      settledAfterPlacement,
      settledAfterPlacement
    ])
    await captureBrowserVisualLayoutBaseline(context, page, readState())
    detached = true

    const result = await ensureBrowserVisualLayout({
      context,
      page,
      readState,
      recover: async () => {
        detached = false
        return 'recovered_geometry'
      }
    })

    expect(result.status).toBe('recovered')
    expect(result.drift).toContain('window_bounds')
    expect(result.drift).toContain('manual_resize_detached')
    expect(result.snapshot?.outerWidth).toBe(904)
    expect(result.snapshot?.manualResizeDetached).toBe(false)
  })

  it('does not hide DPR/scale contract drift behind Compact geometry refresh', async () => {
    const context = {} as BrowserContext
    const resized = {
      ...baselineMetrics,
      outerWidth: 1060,
      innerWidth: 1044,
      visualViewportWidth: 1044
    }
    const wrongScale = {
      ...baselineMetrics,
      outerWidth: 904,
      innerWidth: 888,
      visualViewportWidth: 888,
      devicePixelRatio: 1
    }
    let detached = false
    const readState = () => ({ browserScale: 0.4, compact: true, manualResizeDetached: detached })
    const page = pageWithMetrics([
      baselineMetrics,
      baselineMetrics,
      baselineMetrics,
      resized,
      wrongScale,
      wrongScale,
      wrongScale
    ])
    await captureBrowserVisualLayoutBaseline(context, page, readState())
    detached = true

    const result = await ensureBrowserVisualLayout({
      context,
      page,
      readState,
      recover: async () => {
        detached = false
        return 'recovered_geometry'
      }
    })

    expect(result.status).toBe('failed')
    expect(result.drift).toContain('device_pixel_ratio')
  })

  it('can safely rebaseline a native non-compact layout instead of inventing preferred dimensions', async () => {
    const context = {} as BrowserContext
    const changed = { ...baselineMetrics, outerWidth: 1100, innerWidth: 1084, visualViewportWidth: 1084 }
    const page = pageWithMetrics([
      baselineMetrics,
      baselineMetrics,
      baselineMetrics,
      changed,
      changed,
      changed,
      changed
    ])
    const normalState = () => ({ browserScale: 1, compact: false, manualResizeDetached: false })
    await captureBrowserVisualLayoutBaseline(context, page, normalState())

    const result = await ensureBrowserVisualLayout({
      context,
      page,
      readState: normalState,
      recover: async () => 'rebaseline'
    })

    expect(result.status).toBe('rebaselined')
    expect(result.snapshot?.outerWidth).toBe(1100)
  })
})
