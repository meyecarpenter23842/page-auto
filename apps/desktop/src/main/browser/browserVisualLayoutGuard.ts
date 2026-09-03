import type { BrowserContext, Page } from 'playwright-core'
import {
  buildBrowserVisualBaselineSnapshot,
  compareBrowserVisualBaseline,
  type BrowserVisualBaselineMetrics,
  type BrowserVisualBaselineSnapshot,
  type BrowserVisualDriftKind
} from '../../shared/browserVisualBaseline'

const DEFAULT_METRIC_TIMEOUT_MS = 1_500
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
  const metrics = await readBrowserVisualMetrics(page, timeoutMs)
  if (!metrics) return null
  const snapshot = snapshotFromMetrics(metrics, state)
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
    baselines.set(input.context, current)
    return {
      status: 'captured',
      message: 'Visual/Layout Guard đã chụp runtime baseline hiện tại.',
      drift: [],
      snapshot: current
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
    const nextMetrics = await readBrowserVisualMetrics(input.page, timeoutMs)
    if (!nextMetrics) {
      return {
        status: 'failed',
        message: 'Visual/Layout Guard không đọc được Chrome sau khi chuẩn hóa baseline.',
        drift: comparison.drift,
        snapshot: null
      }
    }
    const next = snapshotFromMetrics(nextMetrics, input.readState())
    baselines.set(input.context, next)
    return {
      status: 'rebaselined',
      message: 'Visual/Layout Guard đã nhận runtime layout mới làm baseline an toàn.',
      drift: comparison.drift,
      snapshot: next
    }
  }

  const recoveredMetrics = await readBrowserVisualMetrics(input.page, timeoutMs)
  if (!recoveredMetrics) {
    return {
      status: 'failed',
      message: 'Visual/Layout Guard không đọc được Chrome sau recovery.',
      drift: comparison.drift,
      snapshot: null
    }
  }
  const recovered = snapshotFromMetrics(recoveredMetrics, input.readState())
  const recoveredComparison = compareBrowserVisualBaseline(baseline, recovered)
  if (!recoveredComparison.stable) {
    return {
      status: 'failed',
      message: `Visual/Layout Guard vẫn còn drift sau recovery: ${recoveredComparison.drift.join(', ')}.`,
      drift: recoveredComparison.drift,
      snapshot: recovered
    }
  }

  return {
    status: 'recovered',
    message: 'Visual/Layout Guard đã recover layout về runtime baseline.',
    drift: comparison.drift,
    snapshot: recovered
  }
}
