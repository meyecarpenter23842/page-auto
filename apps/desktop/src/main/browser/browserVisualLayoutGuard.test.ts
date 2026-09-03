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

  it('captures the live safe-boundary metrics when no guard baseline exists yet', async () => {
    const context = {} as BrowserContext
    const facebookMetrics = {
      ...baselineMetrics,
      innerWidth: 1225,
      innerHeight: 687,
      devicePixelRatio: 0.32,
      visualViewportWidth: 1225,
      visualViewportHeight: 687.5
    }
    const page = pageWithMetrics([facebookMetrics])

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

  it('recovers resize drift and verifies the measured baseline again before allowing the action', async () => {
    const context = {} as BrowserContext
    const resized = { ...baselineMetrics, outerWidth: 1060, innerWidth: 1044, visualViewportWidth: 1044 }
    const page = pageWithMetrics([baselineMetrics, resized, baselineMetrics])
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

  it('can safely rebaseline a native non-compact layout instead of inventing preferred dimensions', async () => {
    const context = {} as BrowserContext
    const changed = { ...baselineMetrics, outerWidth: 1100, innerWidth: 1084, visualViewportWidth: 1084 }
    const page = pageWithMetrics([baselineMetrics, changed, changed])
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
