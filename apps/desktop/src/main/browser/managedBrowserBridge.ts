import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import { sameWholeChromeScale, wholeChromeScaleForLaunch } from '../../shared/browserWholeChromeScale'
import {
  applyBrowserPlacementToContext,
  applyBrowserWindowPlacement,
  watchForManualBrowserResize
} from './browserRuntime'
import { runWithResizeWatcherPaused } from './resizeWatchGuard'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='

let installed = false
let persistentContext: BrowserContext | null = null
let persistentProxy: BrowserContext | null = null
let attachedBrowser: Browser | null = null
let activePlacement: BrowserWindowPlacement | null = null
let launchedWholeChromeScale: number | null = null
let stopResizeWatch: (() => void) | null = null

function managedCdpEndpointFromArgs(argv: string[] = process.argv): string | null {
  const raw = argv.find((item) => item.startsWith(MANAGED_CDP_ARG_PREFIX))
  if (!raw) return null
  const endpoint = raw.slice(MANAGED_CDP_ARG_PREFIX.length).trim()
  return endpoint || null
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

function armResizeWatch(context: BrowserContext): void {
  stopWatchingResize()
  const placement = activePlacement
  if (!placement) return
  stopResizeWatch = watchForManualBrowserResize(context, () => {
    if (persistentContext !== context) return
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
    persistentContext = null
    persistentProxy = null
    attachedBrowser = null
    activePlacement = null
    launchedWholeChromeScale = null
  })
  return persistentProxy
}

/** Set the launch placement only while the account browser has not been opened yet. */
export function setManagedBrowserPlacement(placement: BrowserWindowPlacement | null): void {
  if (persistentContext) return
  activePlacement = placement
}

/** Explicit user re-tile action. Scale changes require closing/reopening Chrome. */
export async function retileManagedPostingBrowser(placement: BrowserWindowPlacement | null): Promise<void> {
  if (persistentContext && !scaleMatchesRunningChrome(placement)) {
    logReopenRequired(placement)
    return
  }
  activePlacement = placement
  if (persistentContext) await applyCurrentPlacement(persistentContext)
}

/**
 * Reuse one persistent account browser for every Group/post inside the current
 * account turn. Placement is applied once when the browser is opened/attached and
 * later only when the operator explicitly requests re-tile. A manual resize clears
 * compact control for that window until the next explicit re-tile.
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
        return proxy
      } catch {
        // Browser may have been closed between registry lookup and job start.
        // Fall back to launching the same persistent account profile below.
      }
    }

    const compactOptions = activePlacement
      ? { ...options, args: managedCompactLaunchArgs(options?.args, activePlacement) }
      : options
    const context = await originalLaunchPersistentContext(userDataDir, compactOptions)
    const proxy = rememberContext(context, null, requestedScale)
    if (requestedScale !== null && activePlacement) {
      console.info(
        `[PAGE-AUTO compact-scale] factor=${requestedScale} logical=${activePlacement.width}x${activePlacement.height}`
      )
    }
    await applyCurrentPlacement(context)
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
  persistentContext = null
  persistentProxy = null
  attachedBrowser = null
  activePlacement = null
  launchedWholeChromeScale = null

  if (browser) {
    await browser.close().catch(() => undefined)
    return
  }
  if (context) await context.close().catch(() => undefined)
}

export { managedCdpEndpointFromArgs }
