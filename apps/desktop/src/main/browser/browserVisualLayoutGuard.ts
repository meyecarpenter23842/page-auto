import type { BrowserContext, Page } from 'playwright-core'
import {
  buildBrowserVisualBaselineSnapshot,
  compareBrowserVisualBaseline,
  type BrowserVisualBaselineMetrics,
  type BrowserVisualBaselineSnapshot,
  type BrowserVisualDriftKind
} from '../../shared/browserVisualBaseline'

const DEFAULT_METRIC_TIMEOUT_MS = 1_500
const DEFAULT_LAYOUT_SETTLE_TIMEOUT_MS = 1_500
const LAYOUT_SETTLE_INTERVAL_MS = 100
const STABLE_COMPARISONS_REQUIRED = 2
const baselines = new WeakMap<BrowserContext, BrowserVisualBaselineSnapshot>()

export interface BrowserVisualLayoutState {
  browserScale: number
  compact: boolean
  manualResizeDetached: boolean
}

export type BrowserVisualRecoveryDecision = 'recovered' | 'rebaseline' | 'failed'

export interface BrowserVisualLayoutGuardResult {
  status: 'captured' | 'ready' | 'recovered' | 'rebaselined' | 'failed'
  message: string
  drift: BrowserVisualDriftKind[]
  snapshot: BrowserVisualBaselineSnapshot | null
}

function metricsTimeout(timeoutMs: number): Promise<null> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(null), Math.max(1, timeoutMs))
  })
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(1, timeoutMs))
  })
}

/** Renderer reads must never be allowed to hold an automation worker queue forever. */
export async function readBrowserVisualMetrics(
  page: Page,
  timeoutMs: number = DEFAULT_METRIC_TIMEOUT_MS
): Promise<BrowserVisualBaselineMetrics | null> {
  const evaluation = page.evaluate(() => {
    const visualViewport = window.visualViewport
    return {
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      visualViewportWidth: visualViewport?.width ?? window.innerWidth,
      visualViewportHeight: visualViewport?.height ?? window.innerHeight,
      visualViewportScale: visualViewport?.scale ?? 1
    }
  }).catch(() => null)

  return Promise.race([evaluation, metricsTimeout(timeoutMs)])
}

function snapshotFromMetrics(
  metrics: BrowserVisualBaselineMetrics,
  state: BrowserVisualLayoutState
): BrowserVisualBaselineSnapshot {
  return buildBrowserVisualBaselineSnapshot({
    metrics,
    browserScale: state.browserScale,
    compact: state.compact,
    manualResizeDetached: state.manualResizeDetached
  })
}

async function waitForStableVisualSnapshot(input: {
  page: Page
  readState: () => BrowserVisualLayoutState
  metricTimeoutMs: number
  initialSnapshot?: BrowserVisualBaselineSnapshot | null
}): Promise<BrowserVisualBaselineSnapshot | null> {
  const deadline = Date.now() + DEFAULT_LAYOUT_SETTLE_TIMEOUT_MS
  let previous = input.initialSnapshot ?? null
  let stableComparisons = 0

  while (true) {
    const remainingMs = Math.max(1, deadline - Date.now())
    const metrics = await readBrowserVisualMetrics(
      input.page,
      Math.min(input.metricTimeoutMs, remainingMs)
    )
    if (metrics) {
      const snapshot = snapshotFromMetrics(metrics, input.readState())
      if (previous) {
        const comparison = compareBrowserVisualBaseline(previous, snapshot)
        stableComparisons = comparison.stable ? stableComparisons + 1 : 0
        if (stableComparisons >= STABLE_COMPARISONS_REQUIRED) return snapshot
      }
      previous = snapshot
    } else {
      stableComparisons = 0
    }

    const remainingAfterReadMs = deadline - Date.now()
    if (remainingAfterReadMs <= 0) return null
    await delay(Math.min(LAYOUT_SETTLE_INTERVAL_MS, remainingAfterReadMs))
  }
}

async function waitForRecoveredVisualLayout(input: {
  page: Page
  readState: () => BrowserVisualLayoutState
  baseline: BrowserVisualBaselineSnapshot
  metricTimeoutMs: number
}): Promise<{
  stable: boolean
  snapshot: BrowserVisualBaselineSnapshot | null
  drift: BrowserVisualDriftKind[]
}> {
  const deadline = Date.now() + DEFAULT_LAYOUT_SETTLE_TIMEOUT_MS
  let latestSnapshot: BrowserVisualBaselineSnapshot | null = null
  let latestDrift: BrowserVisualDriftKind[] = []

  while (true) {
    const remainingMs = Math.max(1, deadline - Date.now())
    const metrics = await readBrowserVisualMetrics(
      input.page,
      Math.min(input.metricTimeoutMs, remainingMs)
    )
    if (metrics) {
      const snapshot = snapshotFromMetrics(metrics, input.readState())
      const comparison = compareBrowserVisualBaseline(input.baseline, snapshot)
      latestSnapshot = snapshot
      latestDrift = comparison.drift
      if (comparison.stable) {
        return { stable: true, snapshot, drift: [] }
      }
    }

    const remainingAfterReadMs = deadline - Date.now()
    if (remainingAfterReadMs <= 0) break
    await delay(Math.min(LAYOUT_SETTLE_INTERVAL_MS, remainingAfterReadMs))
  }

  return {
    stable: false,
    snapshot: latestSnapshot,
    drift: latestDrift
  }
}

export function getBrowserVisualLayoutBaseline(context: BrowserContext): BrowserVisualBaselineSnapshot | null {
  return baselines.get(context) ?? null
}

export function clearBrowserVisualLayoutBaseline(context: BrowserContext): void {
  baselines.delete(context)
}

export async function captureBrowserVisualLayoutBaseline(
  context: BrowserContext,
  page: Page,
  state: BrowserVisualLayoutState,
  timeoutMs: number = DEFAULT_METRIC_TIMEOUT_MS
): Promise<BrowserVisualBaselineSnapshot | null> {
  const snapshot = await waitForStableVisualSnapshot({
    page,
    readState: () => state,
    metricTimeoutMs: timeoutMs
  })
  if (!snapshot) return null
  baselines.set(context, snapshot)
  return snapshot
}

export async function ensureBrowserVisualLayout(input: {
  context: BrowserContext
  page: Page
  readState: () => BrowserVisualLayoutState
  recover?: (drift: readonly BrowserVisualDriftKind[]) => Promise<BrowserVisualRecoveryDecision>
  metricTimeoutMs?: number
}): Promise<BrowserVisualLayoutGuardResult> {
  const timeoutMs = input.metricTimeoutMs ?? DEFAULT_METRIC_TIMEOUT_MS
  const metrics = await readBrowserVisualMetrics(input.page, timeoutMs)
  if (!metrics) {
    return {
      status: 'failed',
      message: 'Visual/Layout Guard không đọc được trạng thái Chrome trong thời gian cho phép.',
      drift: [],
      snapshot: null
    }
  }

  const current = snapshotFromMetrics(metrics, input.readState())
  const baseline = baselines.get(input.context)
  if (!baseline) {
    const stableBaseline = await waitForStableVisualSnapshot({
      page: input.page,
      readState: input.readState,
      metricTimeoutMs: timeoutMs,
      initialSnapshot: current
    })
    if (!stableBaseline) {
      return {
        status: 'failed',
        message: 'Visual/Layout Guard không thể chụp baseline vì renderer vẫn đang thay đổi.',
        drift: [],
        snapshot: current
      }
    }
    baselines.set(input.context, stableBaseline)
    return {
      status: 'captured',
      message: 'Visual/Layout Guard đã chụp runtime baseline ổn định hiện tại.',
      drift: [],
      snapshot: stableBaseline
    }
  }

  const comparison = compareBrowserVisualBaseline(baseline, current)
  if (comparison.stable) {
    return {
      status: 'ready',
      message: 'Visual/Layout Guard xác nhận layout ổn định.',
      drift: [],
      snapshot: current
    }
  }

  if (!input.recover) {
    return {
      status: 'failed',
      message: `Visual/Layout Guard phát hiện drift nhưng không có recovery: ${comparison.drift.join(', ')}.`,
      drift: comparison.drift,
      snapshot: current
    }
  }

  const decision = await input.recover(comparison.drift)
  if (decision === 'failed') {
    return {
      status: 'failed',
      message: `Visual/Layout Guard không thể recover drift: ${comparison.drift.join(', ')}.`,
      drift: comparison.drift,
      snapshot: current
    }
  }
  if (decision === 'rebaseline') {
    const next = await waitForStableVisualSnapshot({
      page: input.page,
      readState: input.readState,
      metricTimeoutMs: timeoutMs
    })
    if (!next) {
      return {
        status: 'failed',
        message: 'Visual/Layout Guard không thể chụp baseline ổn định sau khi chuẩn hóa layout.',
        drift: comparison.drift,
        snapshot: null
      }
    }
    baselines.set(input.context, next)
    return {
      status: 'rebaselined',
      message: 'Visual/Layout Guard đã nhận runtime layout ổn định mới làm baseline an toàn.',
      drift: comparison.drift,
      snapshot: next
    }
  }

  // Native Chrome bounds can settle before renderer metrics finish reflowing. Verify the
  // recovered baseline with bounded polling so a successful placement is not false-failed
  // just because window.outer/inner/visualViewport still report transient stale frames.
  const recovered = await waitForRecoveredVisualLayout({
    page: input.page,
    readState: input.readState,
    baseline,
    metricTimeoutMs: timeoutMs
  })
  if (!recovered.stable) {
    if (!recovered.snapshot) {
      return {
        status: 'failed',
        message: 'Visual/Layout Guard không đọc được Chrome sau recovery.',
        drift: comparison.drift,
        snapshot: null
      }
    }
    return {
      status: 'failed',
      message: `Visual/Layout Guard vẫn còn drift sau recovery: ${recovered.drift.join(', ')}.`,
      drift: recovered.drift,
      snapshot: recovered.snapshot
    }
  }

  return {
    status: 'recovered',
    message: 'Visual/Layout Guard đã recover layout về runtime baseline.',
    drift: comparison.drift,
    snapshot: recovered.snapshot
  }
}
