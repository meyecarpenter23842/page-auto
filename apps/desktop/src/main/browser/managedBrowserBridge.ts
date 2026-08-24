import { chromium, type BrowserContext } from 'playwright-core'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='

let installed = false
let persistentContext: BrowserContext | null = null
let persistentProxy: BrowserContext | null = null
let ownsPersistentContext = false

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

function rememberContext(context: BrowserContext, owned: boolean): BrowserContext {
  persistentContext = context
  persistentProxy = keepManagedBrowserOpen(context)
  ownsPersistentContext = owned
  context.once('close', () => {
    if (persistentContext !== context) return
    persistentContext = null
    persistentProxy = null
    ownsPersistentContext = false
  })
  return persistentProxy
}

/**
 * Posting workers are long-lived per account. Patch launchPersistentContext so the
 * first successful context is reused for the next Group/post instead of opening and
 * closing Chrome for every item. If Account Manager already owns the same Chrome,
 * attach through its loopback CDP endpoint first; otherwise launch the persistent
 * profile normally and keep that context alive inside this worker.
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
        if (!context) throw new Error('Chrome đang mở không có browser context mặc định.')
        return rememberContext(context, false)
      } catch {
        // Browser may have been closed manually between registry lookup and job start.
        // Fall back to launching the same persistent account profile below.
      }
    }

    const context = await originalLaunchPersistentContext(userDataDir, options)
    return rememberContext(context, true)
  }

  Object.defineProperty(chromium, 'launchPersistentContext', {
    configurable: true,
    value: managedLaunch
  })
}

export async function closeManagedPostingBrowser(): Promise<void> {
  const context = persistentContext
  const owned = ownsPersistentContext
  persistentContext = null
  persistentProxy = null
  ownsPersistentContext = false
  if (context && owned) await context.close().catch(() => undefined)
}

export { managedCdpEndpointFromArgs }
