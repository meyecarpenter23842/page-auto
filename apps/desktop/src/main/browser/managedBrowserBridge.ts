import { chromium, type BrowserContext } from 'playwright-core'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='

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

export function installManagedBrowserReuse(): void {
  const endpoint = managedCdpEndpointFromArgs()
  if (!endpoint) return

  const originalLaunchPersistentContext = chromium.launchPersistentContext.bind(chromium)
  const managedLaunch: typeof chromium.launchPersistentContext = async (userDataDir, options) => {
    try {
      const browser = await chromium.connectOverCDP(endpoint, {
        timeout: options?.timeout ?? 30_000
      })
      const context = browser.contexts()[0]
      if (!context) throw new Error('Chrome đang mở không có browser context mặc định.')
      return keepManagedBrowserOpen(context)
    } catch {
      return originalLaunchPersistentContext(userDataDir, options)
    }
  }

  Object.defineProperty(chromium, 'launchPersistentContext', {
    configurable: true,
    value: managedLaunch
  })
}

export { managedCdpEndpointFromArgs }
