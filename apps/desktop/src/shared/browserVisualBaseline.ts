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

function finiteMetric(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function positiveScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
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
