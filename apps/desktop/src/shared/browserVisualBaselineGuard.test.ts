import { describe, expect, it } from 'vitest'
import {
  buildBrowserVisualBaselineSnapshot,
  compareBrowserVisualBaseline,
  type BrowserVisualBaselineMetrics
} from './browserVisualBaseline'

const metrics: BrowserVisualBaselineMetrics = {
  outerWidth: 903,
  outerHeight: 617,
  innerWidth: 887,
  innerHeight: 548,
  devicePixelRatio: 1.25,
  visualViewportWidth: 887,
  visualViewportHeight: 548,
  visualViewportScale: 1
}

function snapshot(overrides: Partial<BrowserVisualBaselineMetrics> = {}) {
  return buildBrowserVisualBaselineSnapshot({
    metrics: { ...metrics, ...overrides },
    browserScale: 0.4,
    compact: true,
    manualResizeDetached: false
  })
}

describe('compareBrowserVisualBaseline', () => {
  it('ignores small native Chrome jitter instead of requiring one magic window size', () => {
    const result = compareBrowserVisualBaseline(snapshot(), snapshot({
      outerWidth: 914,
      innerHeight: 559,
      visualViewportWidth: 899
    }))
    expect(result).toEqual({ stable: true, drift: [] })
  })

  it('detects resize and zoom-related visual drift from the measured runtime baseline', () => {
    const resized = compareBrowserVisualBaseline(snapshot(), snapshot({
      outerWidth: 1030,
      innerWidth: 1014,
      visualViewportWidth: 1014
    }))
    expect(resized.stable).toBe(false)
    expect(resized.drift).toEqual(expect.arrayContaining(['window_bounds', 'layout_viewport', 'visual_viewport']))

    const zoomed = compareBrowserVisualBaseline(snapshot(), snapshot({ devicePixelRatio: 1.5 }))
    expect(zoomed).toMatchObject({ stable: false })
    expect(zoomed.drift).toContain('device_pixel_ratio')
  })

  it('keeps manual resize detachment typed separately from compact mode', () => {
    const baseline = snapshot()
    const current = { ...baseline, manualResizeDetached: true }
    expect(compareBrowserVisualBaseline(baseline, current)).toEqual({
      stable: false,
      drift: ['manual_resize_detached']
    })
  })
})
