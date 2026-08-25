import type { BrowserContext, CDPSession, Page } from 'playwright-core'
import type { BrowserSettings } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'

export interface BrowserLaunchShape {
  headless: false
  args: string[]
  timeout: number
  ignoreDefaultArgs: string[]
  executablePath?: string
  channel?: 'chrome'
}

export interface CompactDeviceMetrics {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: false
  screenWidth: number
  screenHeight: number
  scale: number
}

export interface CompactViewportFit {
  width: number
  height: number
  scale: number
}

export interface BrowserOuterSize {
  width: number
  height: number
}

export interface BrowserNativeBoundsRecord {
  requested: BrowserOuterSize
  actual: BrowserOuterSize
  clamped: boolean
}

const MIN_COMPACT_SCALE = 0.001
const MANUAL_RESIZE_TOLERANCE_PX = 12
const RESIZE_WATCH_SETTLE_MS = 700
const NATIVE_BOUNDS_MIN_SETTLE_MS = 300
const NATIVE_BOUNDS_SETTLE_INTERVAL_MS = 100
const NATIVE_BOUNDS_SETTLE_TIMEOUT_MS = 1_200
const compactSessions = new WeakMap<Page, CDPSession>()
const placementQueues = new WeakMap<BrowserContext, Promise<void>>()

async function compactSessionFor(context: BrowserContext, page: Page): Promise<CDPSession> {
  const existing = compactSessions.get(page)
  if (existing) return existing

  const session = await context.newCDPSession(page)
  compactSessions.set(page, session)
  page.once('close', () => {
    if (compactSessions.get(page) !== session) return
    compactSessions.delete(page)
    void session.detach().catch(() => undefined)
  })
  return session
}

async function releaseCompactSession(page: Page, session: CDPSession): Promise<void> {
  if (compactSessions.get(page) === session) compactSessions.delete(page)
  await session.detach().catch(() => undefined)
}

export function effectiveCompactContentScale(
  placement: BrowserWindowPlacement,
  innerWidth: number,
  _innerHeight: number
): number {
  const widthScale = Math.max(1, innerWidth) / Math.max(1, placement.viewportWidth)
  const scale = Math.min(1, widthScale)
  return Math.max(MIN_COMPACT_SCALE, Math.round(scale * 1000) / 1000)
}

export function fitCompactViewportToInnerArea(
  placement: BrowserWindowPlacement,
  innerWidth: number,
  innerHeight: number
): CompactViewportFit {
  const safeInnerWidth = Math.max(1, innerWidth)
  const safeInnerHeight = Math.max(1, innerHeight)
  const scale = effectiveCompactContentScale(placement, safeInnerWidth, safeInnerHeight)
  return {
    width: scale < 1 ? placement.viewportWidth : Math.max(1, Math.round(safeInnerWidth)),
    height: Math.max(1, Math.round(safeInnerHeight / scale)),
    scale
  }
}

export function compactDeviceMetrics(
  placement: BrowserWindowPlacement,
  actualScale: number = placement.contentScale,
  viewportWidth: number = placement.viewportWidth,
  viewportHeight: number = placement.viewportHeight
): CompactDeviceMetrics {
  return {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: viewportWidth,
    screenHeight: viewportHeight,
    scale: actualScale
  }
}

export function compactWindowSizeChanged(
  baseline: BrowserOuterSize,
  current: BrowserOuterSize,
  tolerancePx: number = MANUAL_RESIZE_TOLERANCE_PX
): boolean {
  return Math.abs(current.width - baseline.width) > tolerancePx
    || Math.abs(current.height - baseline.height) > tolerancePx
}

export function browserNativeBoundsRecord(
  requested: BrowserOuterSize,
  actual: BrowserOuterSize
): BrowserNativeBoundsRecord {
  return {
    requested: { ...requested },
    actual: { ...actual },
    clamped: requested.width !== actual.width || requested.height !== actual.height
  }
}

async function readBrowserWindowBounds(session: CDPSession, windowId: number): Promise<BrowserOuterSize | null> {
  const result = await session.send('Browser.getWindowBounds', { windowId }).catch(() => null) as {
    bounds?: { width?: number; height?: number }
  } | null
  const width = result?.bounds?.width
  const height = result?.bounds?.height
  if (typeof width !== 'number' || typeof height !== 'number') return null
  return { width, height }
}

async function readStableBrowserWindowBounds(
  session: CDPSession,
  windowId: number,
  timeoutMs: number = NATIVE_BOUNDS_SETTLE_TIMEOUT_MS,
  intervalMs: number = NATIVE_BOUNDS_SETTLE_INTERVAL_MS
): Promise<BrowserOuterSize | null> {
  const startedAt = Date.now()
  const deadline = startedAt + Math.max(NATIVE_BOUNDS_MIN_SETTLE_MS, timeoutMs)
  let previous: BrowserOuterSize | null = null
  let latest: BrowserOuterSize | null = null
  let stableReads = 0

  while (Date.now() <= deadline) {
    const current = await readBrowserWindowBounds(session, windowId)
    if (current) {
      latest = current
      if (previous && previous.width === current.width && previous.height === current.height) {
        stableReads += 1
      } else {
        stableReads = 0
      }
      previous = current

      if (Date.now() - startedAt >= NATIVE_BOUNDS_MIN_SETTLE_MS && stableReads >= 1) {
        return current
      }
    }

    if (Date.now() >= deadline) break
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(25, intervalMs)))
  }

  return latest
}

async function readBrowserOuterSize(context: BrowserContext, page: Page): Promise<BrowserOuterSize | null> {
  const session = await compactSessionFor(context, page)
  const targetWindow = await session.send('Browser.getWindowForTarget').catch(() => null) as { windowId?: number } | null
  if (targetWindow?.windowId === undefined) return null
  return readBrowserWindowBounds(session, targetWindow.windowId)
}

export function watchForManualBrowserResize(
  context: BrowserContext,
  onDetached: () => void,
  intervalMs: number = 350,
  expectedSize: BrowserOuterSize | null = null
): () => void {
  let stopped = false
  let cancelled = false
  let busy = false
  let baseline: BrowserOuterSize | null = expectedSize ? { ...expectedSize } : null
  let settlingToExpected = expectedSize !== null
  let settleReadsRemaining = expectedSize
    ? Math.max(2, Math.ceil(RESIZE_WATCH_SETTLE_MS / Math.max(100, intervalMs)))
    : 0

  const timer = setInterval(() => {
    if (stopped || cancelled || busy) return
    busy = true
    void (async () => {
      const page = context.pages()[0]
      if (!page) return
      const current = await readBrowserOuterSize(context, page).catch(() => null)
      if (cancelled || !current) return

      if (settlingToExpected && baseline) {
        if (!compactWindowSizeChanged(baseline, current)) {
          baseline = current
          settlingToExpected = false
          return
        }
        settleReadsRemaining -= 1
        if (settleReadsRemaining > 0) return
        baseline = current
        settlingToExpected = false
        return
      }

      if (!baseline) {
        baseline = current
        return
      }
      if (!compactWindowSizeChanged(baseline, current)) return

      stopped = true
      clearInterval(timer)
      if (cancelled) return
      await applyBrowserPlacementToContext(context, null).catch(() => undefined)
      if (!cancelled) onDetached()
    })().finally(() => {
      busy = false
    })
  }, Math.max(100, intervalMs))
  timer.unref?.()

  return () => {
    cancelled = true
    if (stopped) return
    stopped = true
    clearInterval(timer)
  }
}

export function buildBrowserLaunchOptions(
  settings: BrowserSettings,
  placement: BrowserWindowPlacement | null = null
): BrowserLaunchShape {
  const executablePath = settings.executablePath?.trim()
  const args = placement
    ? [
        `--window-size=${placement.width},${placement.height}`,
        `--window-position=${placement.x},${placement.y}`
      ]
    : [`--window-size=${settings.windowWidth},${settings.windowHeight}`]

  // Remove only UI/security-problematic Playwright defaults: --enable-automation
  // shows the automation infobar and --no-sandbox disables Chrome's normal Windows
  // sandbox. Remote debugging stays enabled, so this is not stealth/evasion behavior.
  args.push('--no-default-browser-check')

  if (!placement && settings.mode === 'minimized') args.push('--start-minimized')
  if (settings.muteAudio) args.push('--mute-audio')
  if (settings.disableGpu) args.push('--disable-gpu')

  return {
    headless: false,
    args,
    timeout: settings.startupTimeoutMs,
    ignoreDefaultArgs: ['--enable-automation', '--no-sandbox'],
    ...(executablePath ? { executablePath } : { channel: 'chrome' as const })
  }
}

export async function applyBrowserContextSettings(
  context: BrowserContext,
  settings: BrowserSettings
): Promise<void> {
  context.setDefaultNavigationTimeout(settings.navigationTimeoutMs)
  context.setDefaultTimeout(settings.navigationTimeoutMs)

  if (settings.disableImageLoading) {
    await context.route('**/*', async (route) => {
      if (route.request().resourceType() === 'image') {
        await route.abort().catch(() => undefined)
        return
      }
      await route.continue().catch(() => undefined)
    })
  }
}

/**
 * Compact mode only controls the native Chrome window bounds.
 *
 * Older builds also used Emulation.setDeviceMetricsOverride to keep a desktop-width
 * logical viewport and visually scale it into the compact tile. That makes Compact ON
 * use a different layout/hit-test model from Compact OFF and has proven unsafe for
 * Facebook's live composer. Always clear stale emulation and let Chrome/Facebook reflow
 * natively at the real compact window size.
 *
 * Chrome/Windows may clamp a requested native size. After every Compact placement we
 * wait for Browser.getWindowBounds to settle and report requested vs actual instead of
 * treating an initial transient bound as the final native window size.
 */
export async function applyBrowserWindowPlacement(
  context: BrowserContext,
  page: Page,
  placement: BrowserWindowPlacement | null
): Promise<void> {
  const session = await compactSessionFor(context, page)
  const targetWindow = await session.send('Browser.getWindowForTarget').catch(() => null) as { windowId?: number } | null

  await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)

  if (!placement) {
    if (targetWindow?.windowId !== undefined) {
      await session.send('Browser.setWindowBounds', {
        windowId: targetWindow.windowId,
        bounds: { windowState: 'normal' }
      }).catch(() => undefined)
    }
    await releaseCompactSession(page, session)
    return
  }

  if (targetWindow?.windowId !== undefined) {
    const applied = await session.send('Browser.setWindowBounds', {
      windowId: targetWindow.windowId,
      bounds: {
        left: placement.x,
        top: placement.y,
        width: placement.width,
        height: placement.height,
        windowState: 'normal'
      }
    }).then(() => true).catch(() => false)

    if (applied) {
      const actual = await readStableBrowserWindowBounds(session, targetWindow.windowId)
      if (actual) {
        const record = browserNativeBoundsRecord(
          { width: placement.width, height: placement.height },
          actual
        )
        console.info(
          `[PAGE-AUTO compact] requested=${record.requested.width}x${record.requested.height} `
          + `actual=${record.actual.width}x${record.actual.height} clamped=${record.clamped}`
        )
      }
    }
  }
}

export async function applyBrowserPlacementToContext(
  context: BrowserContext,
  placement: BrowserWindowPlacement | null
): Promise<void> {
  const previous = placementQueues.get(context) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(async () => {
    for (const page of context.pages()) {
      await applyBrowserWindowPlacement(context, page, placement).catch(() => undefined)
    }
  })
  placementQueues.set(context, next)
  try {
    await next
  } finally {
    if (placementQueues.get(context) === next) placementQueues.delete(context)
  }
}

export async function waitForBrowserStartupDelay(settings: BrowserSettings): Promise<void> {
  if (settings.startupDelayMs <= 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, settings.startupDelayMs))
}