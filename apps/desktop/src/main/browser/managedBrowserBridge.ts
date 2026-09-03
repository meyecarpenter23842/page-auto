import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import { sameWholeChromeScale, wholeChromeScaleForLaunch } from '../../shared/browserWholeChromeScale'
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

async function captureManagedVisualBaseline(
  context: BrowserContext,
  source: 'attach' | 'fallback-launch' | 'retile'
): Promise<void> {
  const page = context.pages()[0]
  if (!page) return
  const snapshot = await captureBrowserVisualLayoutBaseline(context, page, currentVisualState())
  if (!snapshot) {
    console.info(`[PAGE-AUTO visual-baseline] source=${source} metrics=unavailable`)
    return
  }
  console.info(`[PAGE-AUTO visual-baseline] source=${source} ${JSON.stringify(snapshot)}`)
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

async function recoverManagedVisualLayout(context: BrowserContext): Promise<'recovered' | 'rebaseline' | 'failed'> {
  const expected = visualBaselinePlacement
  if (!expected) {
    manualResizeDetached = false
    return 'rebaseline'
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
  return 'recovered'
}

export async function ensureManagedBrowserVisualLayout(
  context: BrowserContext,
  page: Page
): Promise<BrowserVisualLayoutGuardResult> {
  const result = await ensureBrowserVisualLayout({
    context,
    page,
    readState: currentVisualState,
    recover: () => recoverManagedVisualLayout(context)
  })
  if (result.status === 'recovered' || result.status === 'rebaselined' || result.status === 'failed') {
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
    await captureManagedVisualBaseline(persistentContext, 'retile')
  }
}

/**
 * Reuse one persistent account browser for every Group/post inside the current
 * account turn. Placement is applied once when the browser is opened/attached and
 * later only when the operator explicitly requests re-tile. A manual resize detaches
 * presentation control, while the Common Visual/Layout Guard retains the runtime
 * baseline so the next safe action boundary can recover instead of clicking blind.
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
