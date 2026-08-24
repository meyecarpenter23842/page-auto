import { chromium, type Browser, type BrowserContext } from 'playwright-core'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='

let installed = false
let persistentContext: BrowserContext | null = null
let persistentProxy: BrowserContext | null = null
let attachedBrowser: Browser | null = null

function managedCdpEndpointFromArgs(argv: string[] = process.argv): string | null {
  const raw = argv.find((item) => item.startsWith(MANAGED_CDP_ARG_PREFIX))
  if (!raw) return null
  const endpoint = raw.slice(MANAGED_CDP_ARG_PREFIX.length).trim()
  return endpoint || null
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

function rememberContext(context: BrowserContext, browser: Browser | null): BrowserContext {
  persistentContext = context
  persistentProxy = keepManagedBrowserOpen(context)
  attachedBrowser = browser
  context.once('close', () => {
    if (persistentContext !== context) return
    persistentContext = null
    persistentProxy = null
    attachedBrowser = null
  })
  return persistentProxy
}

/**
 * Reuse one persistent account browser for every Group/post inside the current
 * account turn. When the scheduler ends that turn it shuts the posting worker down,
 * and closeManagedPostingBrowser closes the actual Chrome regardless of whether the
 * worker launched it or attached to an Account Manager Chrome through loopback CDP.
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
        return rememberContext(context, browser)
      } catch {
        // Browser may have been closed between registry lookup and job start.
        // Fall back to launching the same persistent account profile below.
      }
    }

    const context = await originalLaunchPersistentContext(userDataDir, options)
    return rememberContext(context, null)
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

  if (browser) {
    await browser.close().catch(() => undefined)
    return
  }
  if (context) await context.close().catch(() => undefined)
}

export { managedCdpEndpointFromArgs }
