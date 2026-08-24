import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import { applyBrowserPlacementToContext, applyBrowserWindowPlacement } from './browserRuntime'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='

let installed = false
let persistentContext: BrowserContext | null = null
let persistentProxy: BrowserContext | null = null
let attachedBrowser: Browser | null = null
let activePlacement: BrowserWindowPlacement | null = null

function managedCdpEndpointFromArgs(argv: string[] = process.argv): string | null {
  const raw = argv.find((item) => item.startsWith(MANAGED_CDP_ARG_PREFIX))
  if (!raw) return null
  const endpoint = raw.slice(MANAGED_CDP_ARG_PREFIX.length).trim()
  return endpoint || null
}

function compactLaunchArgs(args: string[] | undefined, placement: BrowserWindowPlacement | null): string[] | undefined {
  if (!placement) return args
  const retained = (args ?? []).filter((arg) =>
    !arg.startsWith('--window-size=') && !arg.startsWith('--window-position=')
  )
  return [
    ...retained,
    `--window-size=${placement.width},${placement.height}`,
    `--window-position=${placement.x},${placement.y}`
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

async function applyCurrentPlacement(context: BrowserContext): Promise<void> {
  await applyBrowserPlacementToContext(context, activePlacement)
}

function rememberContext(context: BrowserContext, browser: Browser | null): BrowserContext {
  persistentContext = context
  persistentProxy = keepManagedBrowserOpen(context)
  attachedBrowser = browser
  context.on('page', (page) => {
    void applyBrowserWindowPlacement(context, page, activePlacement).catch(() => undefined)
  })
  context.once('close', () => {
    if (persistentContext !== context) return
    persistentContext = null
    persistentProxy = null
    attachedBrowser = null
    activePlacement = null
  })
  return persistentProxy
}

/** Set the launch placement only while the account browser has not been opened yet. */
export function setManagedBrowserPlacement(placement: BrowserWindowPlacement | null): void {
  if (persistentContext) return
  activePlacement = placement
}

/** Explicit user re-tile action. This is the only operation that repositions an existing posting browser. */
export async function retileManagedPostingBrowser(placement: BrowserWindowPlacement | null): Promise<void> {
  activePlacement = placement
  if (persistentContext) await applyCurrentPlacement(persistentContext)
}

/**
 * Reuse one persistent account browser for every Group/post inside the current
 * account turn. Placement is applied once when the browser is opened/attached and
 * later only when the operator explicitly requests re-tile.
 */
export function installManagedBrowserReuse(): void {
  if (installed) return
  installed = true

  const endpoint = managedCdpEndpointFromArgs()
  const originalLaunchPersistentContext = chromium.launchPersistentContext.bind(chromium)
  const managedLaunch: typeof chromium.launchPersistentContext = async (userDataDir, options) => {
    if (persistentProxy && persistentContext) return persistentProxy

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
        const proxy = rememberContext(context, browser)
        await applyCurrentPlacement(context)
        return proxy
      } catch {
        // Browser may have been closed between registry lookup and job start.
        // Fall back to launching the same persistent account profile below.
      }
    }

    const compactOptions = activePlacement
      ? { ...options, args: compactLaunchArgs(options?.args, activePlacement) }
      : options
    const context = await originalLaunchPersistentContext(userDataDir, compactOptions)
    const proxy = rememberContext(context, null)
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
  persistentContext = null
  persistentProxy = null
  attachedBrowser = null
  activePlacement = null

  if (browser) {
    await browser.close().catch(() => undefined)
    return
  }
  if (context) await context.close().catch(() => undefined)
}

export { managedCdpEndpointFromArgs }
