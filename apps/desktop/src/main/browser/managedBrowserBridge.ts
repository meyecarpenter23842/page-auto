import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { buildBrowserVisualBaselineSnapshot } from '../../shared/browserVisualBaseline'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import { sameWholeChromeScale, wholeChromeScaleForLaunch } from '../../shared/browserWholeChromeScale'
import {
  normalizeAutomationPageZoom,
  normalizeAutomationProfileZoom
} from './automationBrowserVisualContract'
import { closeBrowserTarget } from './browserClose'
import { closeConnectedChromiumProcess } from './browserProcessLifecycle'
import {
  applyBrowserPlacementToContext,
  applyBrowserWindowPlacement,
  watchForManualBrowserResize
} from './browserRuntime'
import {
  captureBrowserVisualLayoutBaseline,
  clearBrowserVisualLayoutBaseline,
  ensureBrowserVisualLayout,
  getBrowserVisualLayoutBaseline,
  readBrowserVisualMetrics,
  type BrowserVisualLayoutGuardResult,
  type BrowserVisualLayoutState
} from './browserVisualLayoutGuard'
import { runWithResizeWatcherPaused } from './resizeWatchGuard'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='

let installed = false
let persistentContext: BrowserContext | null = null
let persistentProxy: BrowserContext | null = null
let attachedBrowser: Browser | null = null
let activePlacement: BrowserWindowPlacement | null = null
let visualBaselinePlacement: BrowserWindowPlacement | null = null
let launchedWholeChromeScale: number | null = null
let manualResizeDetached = false
let stopResizeWatch: (() => void) | null = null

export type ManagedVisualBaselineSource = 'attach' | 'fallback-launch' | 'retile'

function managedCdpEndpointFromArgs(argv: string[] = process.argv): string | null {
  const raw = argv.find((item) => item.startsWith(MANAGED_CDP_ARG_PREFIX))
  if (!raw) return null
  const endpoint = raw.slice(MANAGED_CDP_ARG_PREFIX.length).trim()
  return endpoint || null
}

export function managedCdpLaunchArgs(args: string[] | undefined): string[] {
  const retained = (args ?? []).filter((arg) =>
    !arg.startsWith('--remote-debugging-address=')
    && !arg.startsWith('--remote-debugging-port=')
  )
  return [
    ...retained,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0'
  ]
}

export function managedCompactLaunchArgs(
  args: string[] | undefined,
  placement: BrowserWindowPlacement
): string[] {
  const scale = wholeChromeScaleForLaunch(placement)
  const retained = (args ?? []).filter((arg) =>
    !arg.startsWith('--window-size=')
    && !arg.startsWith('--window-position=')
    && !arg.startsWith('--force-device-scale-factor=')
    && arg !== '--start-minimized'
  )
  return [
    ...retained,
    `--window-size=${placement.width},${placement.height}`,
    `--window-position=${placement.x},${placement.y}`,
    ...(scale !== null ? [`--force-device-scale-factor=${scale}`] : [])
  ]
}

function keepManagedBrowserOpen(context: BrowserContext): BrowserContext {
  return new Proxy(context, {
    get(target, property) {
      if (property === 'close') return async () => undefined
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

function stopWatchingResize(): void {
  stopResizeWatch?.()
  stopResizeWatch = null
}

function currentVisualState(): BrowserVisualLayoutState {
  return {
    browserScale: launchedWholeChromeScale ?? 1,
    compact: visualBaselinePlacement !== null,
    manualResizeDetached
  }
}

/**
 * Launch/attach observations are diagnostic only. Chrome can apply origin-specific
 * zoom/DPR and final viewport metrics only after navigation to Facebook. The first
 * safe action boundary first normalizes the configured placement + page zoom contract,
 * then captures that deterministic live layout as the guard baseline. Explicit retile
 * also normalizes before replacing the baseline.
 */
export function managedVisualObservationPersistsBaseline(source: ManagedVisualBaselineSource): boolean {
  return source === 'retile'
}

async function captureManagedVisualBaseline(
  context: BrowserContext,
  source: ManagedVisualBaselineSource
): Promise<void> {
  const page = context.pages()[0]
  if (!page) return

  const state = currentVisualState()
  const persistBaseline = managedVisualObservationPersistsBaseline(source)
  const snapshot = persistBaseline
    ? await captureBrowserVisualLayoutBaseline(context, page, state)
    : await readBrowserVisualMetrics(page).then((metrics) => metrics
      ? buildBrowserVisualBaselineSnapshot({
          metrics,
          browserScale: state.browserScale,
          compact: state.compact,
          manualResizeDetached: state.manualResizeDetached
        })
      : null)

  if (!snapshot) {
    console.info(`[PAGE-AUTO visual-baseline] source=${source} persisted=${persistBaseline} metrics=unavailable`)
    return
  }
  console.info(
    `[PAGE-AUTO visual-baseline] source=${source} persisted=${persistBaseline} ${JSON.stringify(snapshot)}`
  )
}

function armResizeWatch(context: BrowserContext): void {
  stopWatchingResize()
  const placement = activePlacement
  if (!placement) return
  stopResizeWatch = watchForManualBrowserResize(context, () => {
    if (persistentContext !== context) return
    manualResizeDetached = true
    activePlacement = null
    stopResizeWatch = null
  }, 350, { width: placement.width, height: placement.height })
}

function scaleMatchesRunningChrome(placement: BrowserWindowPlacement | null): boolean {
  return sameWholeChromeScale(launchedWholeChromeScale, wholeChromeScaleForLaunch(placement))
}

function logReopenRequired(placement: BrowserWindowPlacement | null): void {
  console.info(
    `[PAGE-AUTO compact-scale] reopen-required running=${launchedWholeChromeScale ?? 1} requested=${wholeChromeScaleForLaunch(placement) ?? 1}`
  )
}

async function applyCurrentPlacement(context: BrowserContext): Promise<void> {
  if (!scaleMatchesRunningChrome(activePlacement)) {
    logReopenRequired(activePlacement)
    return
  }
  await runWithResizeWatcherPaused(
    stopWatchingResize,
    () => applyBrowserPlacementToContext(context, activePlacement),
    () => armResizeWatch(context)
  )
}

async function normalizeManagedPageZoom(
  context: BrowserContext,
  page: Page,
  phase: 'initial' | 'recovery' | 'retile'
): Promise<boolean> {
  const zoom = await normalizeAutomationPageZoom(context, page)
  if (zoom.status === 'ready') return true

  console.info(
    `[PAGE-AUTO visual-contract] phase=${phase} pageZoom=${zoom.before ?? 'unknown'}->${zoom.after ?? 'unknown'} status=${zoom.status}`
  )
  return zoom.status === 'normalized'
}

async function normalizeInitialManagedVisualLayout(
  context: BrowserContext,
  page: Page
): Promise<boolean> {
  const expected = visualBaselinePlacement
  if (expected) {
    if (!scaleMatchesRunningChrome(expected)) {
      logReopenRequired(expected)
      return false
    }
    activePlacement = expected
    manualResizeDetached = false
    await runWithResizeWatcherPaused(
      stopWatchingResize,
      () => applyBrowserPlacementToContext(context, expected),
      () => armResizeWatch(context)
    )
  }
  return normalizeManagedPageZoom(context, page, 'initial')
}

async function recoverManagedVisualLayout(
  context: BrowserContext,
  page: Page
): Promise<'recovered' | 'rebaseline' | 'failed'> {
  const expected = visualBaselinePlacement
  if (!expected) {
    manualResizeDetached = false
    return await normalizeManagedPageZoom(context, page, 'recovery') ? 'rebaseline' : 'failed'
  }
  if (!scaleMatchesRunningChrome(expected)) {
    logReopenRequired(expected)
    return 'failed'
  }

  activePlacement = expected
  manualResizeDetached = false
  await runWithResizeWatcherPaused(
    stopWatchingResize,
    () => applyBrowserPlacementToContext(context, expected),
    () => armResizeWatch(context)
  )
  return await normalizeManagedPageZoom(context, page, 'recovery') ? 'recovered' : 'failed'
}

function visualContractFailure(message: string): BrowserVisualLayoutGuardResult {
  return {
    status: 'failed',
    message,
    drift: [],
    snapshot: null
  }
}

export async function ensureManagedBrowserVisualLayout(
  context: BrowserContext,
  page: Page
): Promise<BrowserVisualLayoutGuardResult> {
  if (!getBrowserVisualLayoutBaseline(context)) {
    const normalized = await normalizeInitialManagedVisualLayout(context, page).catch(() => false)
    if (!normalized) {
      const failed = visualContractFailure(
        'Common Visual/Layout Guard không thể chuẩn hóa Chrome về placement/zoom automation trước action.'
      )
      console.info('[PAGE-AUTO visual-guard] status=failed drift=visual_contract')
      return failed
    }
  }

  const result = await ensureBrowserVisualLayout({
    context,
    page,
    readState: currentVisualState,
    recover: () => recoverManagedVisualLayout(context, page)
  })
  if (
    result.status === 'captured'
    || result.status === 'recovered'
    || result.status === 'rebaselined'
    || result.status === 'failed'
  ) {
    console.info(`[PAGE-AUTO visual-guard] status=${result.status} drift=${result.drift.join(',') || 'none'}`)
  }
  return result
}

function rememberContext(
  context: BrowserContext,
  browser: Browser | null,
  launchScale: number | null
): BrowserContext {
  persistentContext = context
  persistentProxy = keepManagedBrowserOpen(context)
  attachedBrowser = browser
  launchedWholeChromeScale = launchScale
  context.on('page', (page) => {
    if (!scaleMatchesRunningChrome(activePlacement)) return
    void applyBrowserWindowPlacement(context, page, activePlacement).catch(() => undefined)
  })
  context.once('close', () => {
    if (persistentContext !== context) return
    stopWatchingResize()
    clearBrowserVisualLayoutBaseline(context)
    persistentContext = null
    persistentProxy = null
    attachedBrowser = null
    activePlacement = null
    visualBaselinePlacement = null
    launchedWholeChromeScale = null
    manualResizeDetached = false
  })
  return persistentProxy
}

/** Set the launch placement only while the account browser has not been opened yet. */
export function setManagedBrowserPlacement(placement: BrowserWindowPlacement | null): void {
  if (persistentContext) return
  activePlacement = placement
  visualBaselinePlacement = placement
  manualResizeDetached = false
}

/** Explicit user re-tile action. Scale changes require closing/reopening Chrome. */
export async function retileManagedPostingBrowser(placement: BrowserWindowPlacement | null): Promise<void> {
  if (persistentContext && !scaleMatchesRunningChrome(placement)) {
    logReopenRequired(placement)
    return
  }
  activePlacement = placement
  visualBaselinePlacement = placement
  manualResizeDetached = false
  if (persistentContext) {
    await applyCurrentPlacement(persistentContext)
    const page = persistentContext.pages()[0]
    if (page && !await normalizeManagedPageZoom(persistentContext, page, 'retile')) return
    await captureManagedVisualBaseline(persistentContext, 'retile')
  }
}

/**
 * Reuse one persistent account browser for every Group/post inside the current account turn.
 * Launch still derives window size/whole-Chrome scale from BrowserWindowPlacement. The first
 * safe action boundary additionally forces native placement and 100% page zoom before baseline
 * capture; later resize/zoom drift is recovered back to that same contract. Manual Account
 * Manager browsers remain owned by their profile worker and are not changed by this bridge.
 */
export function installManagedBrowserReuse(): void {
  if (installed) return
  installed = true

  const endpoint = managedCdpEndpointFromArgs()
  const originalLaunchPersistentContext = chromium.launchPersistentContext.bind(chromium)
  const managedLaunch: typeof chromium.launchPersistentContext = async (userDataDir, options) => {
    if (persistentProxy && persistentContext) return persistentProxy

    const requestedScale = wholeChromeScaleForLaunch(activePlacement)
    if (endpoint) {
      try {
        const browser = await chromium.connectOverCDP(endpoint, {
          timeout: options?.timeout ?? 30_000
        })
        const context = browser.contexts()[0]
        if (!context) {
          await browser.close().catch(() => undefined)
          throw new Error('Chrome đang mở không có browser context mặc định.')
        }
        const proxy = rememberContext(context, browser, requestedScale)
        await applyCurrentPlacement(context)
        await captureManagedVisualBaseline(context, 'attach')
        return proxy
      } catch {
        // Browser may have been closed between registry lookup and job start.
        // Fall back to launching the same persistent account profile below.
      }
    }

    const profileZoom = await normalizeAutomationProfileZoom(String(userDataDir)).catch(() => null)
    if (profileZoom?.changed) {
      console.info('[PAGE-AUTO visual-contract] persisted Facebook/default page zoom reset before automation launch')
    }

    const compactArgs = activePlacement
      ? managedCompactLaunchArgs(options?.args, activePlacement)
      : (options?.args ?? [])
    const persistentOptions = {
      ...options,
      args: managedCdpLaunchArgs(compactArgs)
    }
    const context = await originalLaunchPersistentContext(userDataDir, persistentOptions)
    const proxy = rememberContext(context, null, requestedScale)
    if (requestedScale !== null && activePlacement) {
      console.info(
        `[PAGE-AUTO compact-scale] factor=${requestedScale} logical=${activePlacement.width}x${activePlacement.height}`
      )
    }
    await applyCurrentPlacement(context)
    await captureManagedVisualBaseline(context, 'fallback-launch')
    return proxy
  }

  Object.defineProperty(chromium, 'launchPersistentContext', {
    configurable: true,
    value: managedLaunch
  })
}

export async function closeManagedPostingBrowser(): Promise<void> {
  const context = persistentContext
  const browser = attachedBrowser
  stopWatchingResize()
  if (context) clearBrowserVisualLayoutBaseline(context)
  persistentContext = null
  persistentProxy = null
  attachedBrowser = null
  activePlacement = null
  visualBaselinePlacement = null
  launchedWholeChromeScale = null
  manualResizeDetached = false

  if (browser) {
    await closeConnectedChromiumProcess(browser, 'Chrome managed của automation worker')
    return
  }
  await closeBrowserTarget(context, 'Persistent Chrome của automation worker')
}

export { managedCdpEndpointFromArgs }
