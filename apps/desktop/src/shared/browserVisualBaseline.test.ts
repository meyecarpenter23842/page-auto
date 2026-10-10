import { describe, expect, it } from 'vitest'
import { buildBrowserVisualBaselineSnapshot } from './browserVisualBaseline'

describe('browserVisualBaseline', () => {
  it('preserves measured Chrome dimensions instead of forcing a preferred baseline size', () => {
    const snapshot = buildBrowserVisualBaselineSnapshot({
      metrics: {
        outerWidth: 903,
        outerHeight: 617,
        innerWidth: 887,
        innerHeight: 548,
        devicePixelRatio: 1.25,
        visualViewportWidth: 887,
        visualViewportHeight: 548,
        visualViewportScale: 1
      },
      browserScale: 0.4,
      compact: true,
      manualResizeDetached: false
    })

    expect(snapshot).toEqual({
      outerWidth: 903,
      outerHeight: 617,
      innerWidth: 887,
      innerHeight: 548,
      devicePixelRatio: 1.25,
      visualViewportWidth: 887,
      visualViewportHeight: 548,
      visualViewportScale: 1,
      browserScale: 0.4,
      compact: true,
      manualResizeDetached: false
    })
  })

  it('keeps compact mode and manual resize detachment as independent state', () => {
    const metrics = {
      outerWidth: 660,
      outerHeight: 520,
      innerWidth: 644,
      innerHeight: 451,
      devicePixelRatio: 1,
      visualViewportWidth: 644,
      visualViewportHeight: 451,
      visualViewportScale: 1
    }

    expect(buildBrowserVisualBaselineSnapshot({
      metrics,
      browserScale: 1,
      compact: false,
      manualResizeDetached: false
    })).toMatchObject({ compact: false, manualResizeDetached: false })

    expect(buildBrowserVisualBaselineSnapshot({
      metrics,
      browserScale: 0.4,
      compact: true,
      manualResizeDetached: true
    })).toMatchObject({ compact: true, manualResizeDetached: true })
  })

  it('normalizes invalid scalar observations without inventing window dimensions', () => {
    const snapshot = buildBrowserVisualBaselineSnapshot({
      metrics: {
        outerWidth: Number.NaN,
        outerHeight: Number.POSITIVE_INFINITY,
        innerWidth: 0,
        innerHeight: 0,
        devicePixelRatio: Number.NaN,
        visualViewportWidth: Number.NaN,
        visualViewportHeight: Number.NaN,
        visualViewportScale: 0
      },
      browserScale: Number.NaN,
      compact: false,
      manualResizeDetached: false
    })

    expect(snapshot.outerWidth).toBe(0)
    expect(snapshot.outerHeight).toBe(0)
    expect(snapshot.visualViewportWidth).toBe(0)
    expect(snapshot.visualViewportHeight).toBe(0)
    expect(snapshot.devicePixelRatio).toBe(1)
    expect(snapshot.visualViewportScale).toBe(1)
    expect(snapshot.browserScale).toBe(1)
  })
})
