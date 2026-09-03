export interface BrowserVisualBaselineMetrics {
  outerWidth: number
  outerHeight: number
  innerWidth: number
  innerHeight: number
  devicePixelRatio: number
  visualViewportWidth: number
  visualViewportHeight: number
  visualViewportScale: number
}

export interface BrowserVisualBaselineSnapshot extends BrowserVisualBaselineMetrics {
  browserScale: number
  compact: boolean
  manualResizeDetached: boolean
}

export const BROWSER_VISUAL_DRIFT_KINDS = [
  'window_bounds',
  'layout_viewport',
  'device_pixel_ratio',
  'visual_viewport',
  'visual_viewport_scale',
  'browser_scale',
  'compact_mode',
  'manual_resize_detached'
] as const

export type BrowserVisualDriftKind = (typeof BROWSER_VISUAL_DRIFT_KINDS)[number]

export interface BrowserVisualBaselineComparison {
  stable: boolean
  drift: BrowserVisualDriftKind[]
}

export interface BrowserVisualBaselineTolerance {
  outerPx: number
  innerPx: number
  visualViewportPx: number
  devicePixelRatio: number
  visualViewportScale: number
  browserScale: number
}

export const DEFAULT_BROWSER_VISUAL_BASELINE_TOLERANCE: Readonly<BrowserVisualBaselineTolerance> = {
  outerPx: 16,
  innerPx: 24,
  visualViewportPx: 24,
  devicePixelRatio: 0.03,
  visualViewportScale: 0.02,
  browserScale: 0.01
}

function finiteMetric(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function positiveScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function changed(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) > tolerance
}

/**
 * Read-only visual state contract used by the Windows Chrome baseline probe.
 *
 * Keep browser dimensions as observations. This helper deliberately does not
 * convert them into a preferred/inferred size: the common baseline is runtime
 * state, not a magic dimension such as 1250x783.
 */
export function buildBrowserVisualBaselineSnapshot(input: {
  metrics: BrowserVisualBaselineMetrics
  browserScale: number
  compact: boolean
  manualResizeDetached: boolean
}): BrowserVisualBaselineSnapshot {
  return {
    outerWidth: finiteMetric(input.metrics.outerWidth),
    outerHeight: finiteMetric(input.metrics.outerHeight),
    innerWidth: finiteMetric(input.metrics.innerWidth),
    innerHeight: finiteMetric(input.metrics.innerHeight),
    devicePixelRatio: positiveScale(input.metrics.devicePixelRatio),
    visualViewportWidth: finiteMetric(input.metrics.visualViewportWidth),
    visualViewportHeight: finiteMetric(input.metrics.visualViewportHeight),
    visualViewportScale: positiveScale(input.metrics.visualViewportScale),
    browserScale: positiveScale(input.browserScale),
    compact: input.compact,
    manualResizeDetached: input.manualResizeDetached
  }
}

export function compareBrowserVisualBaseline(
  baseline: BrowserVisualBaselineSnapshot,
  current: BrowserVisualBaselineSnapshot,
  tolerance: BrowserVisualBaselineTolerance = DEFAULT_BROWSER_VISUAL_BASELINE_TOLERANCE
): BrowserVisualBaselineComparison {
  const drift: BrowserVisualDriftKind[] = []

  if (
    changed(baseline.outerWidth, current.outerWidth, tolerance.outerPx)
    || changed(baseline.outerHeight, current.outerHeight, tolerance.outerPx)
  ) drift.push('window_bounds')

  if (
    changed(baseline.innerWidth, current.innerWidth, tolerance.innerPx)
    || changed(baseline.innerHeight, current.innerHeight, tolerance.innerPx)
  ) drift.push('layout_viewport')

  if (changed(baseline.devicePixelRatio, current.devicePixelRatio, tolerance.devicePixelRatio)) {
    drift.push('device_pixel_ratio')
  }

  if (
    changed(baseline.visualViewportWidth, current.visualViewportWidth, tolerance.visualViewportPx)
    || changed(baseline.visualViewportHeight, current.visualViewportHeight, tolerance.visualViewportPx)
  ) drift.push('visual_viewport')

  if (changed(baseline.visualViewportScale, current.visualViewportScale, tolerance.visualViewportScale)) {
    drift.push('visual_viewport_scale')
  }

  if (changed(baseline.browserScale, current.browserScale, tolerance.browserScale)) {
    drift.push('browser_scale')
  }
  if (baseline.compact !== current.compact) drift.push('compact_mode')
  if (baseline.manualResizeDetached !== current.manualResizeDetached) drift.push('manual_resize_detached')

  return { stable: drift.length === 0, drift }
}
