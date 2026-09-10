import { chromium, type Browser, type BrowserContext } from 'playwright-core'

export interface MailboxProviderProxyConfig {
  server: string
  username?: string
  password?: string
}

export type MailboxProviderBrowserLauncher = (options: {
  executablePath: string
  headless: boolean
  proxy?: MailboxProviderProxyConfig
}) => Promise<Browser>

export interface MailboxProviderBrowserConfig {
  executablePath?: string
  proxy?: MailboxProviderProxyConfig
  /** Test seam; production uses Playwright chromium.launch. */
  launchBrowser?: MailboxProviderBrowserLauncher
}

interface MailboxProviderBrowserRuntime {
  browser: Browser
  context: BrowserContext
}

const configs = new WeakMap<BrowserContext, MailboxProviderBrowserConfig>()
const runtimes = new WeakMap<BrowserContext, Promise<MailboxProviderBrowserRuntime | null>>()
const cleanupBound = new WeakSet<BrowserContext>()

/**
 * Bind mailbox browsing to an isolated headless Chromium process owned by the
 * visible Email operator context. This keeps provider/ad pages out of the user's
 * Microsoft Chrome window while preserving the Email proxy boundary.
 */
export function configureMailboxProviderBrowser(
  operatorContext: BrowserContext,
  config: MailboxProviderBrowserConfig
): void {
  configs.set(operatorContext, { ...config })
  if (cleanupBound.has(operatorContext)) return
  cleanupBound.add(operatorContext)

  operatorContext.once('close', () => {
    const pending = runtimes.get(operatorContext)
    runtimes.delete(operatorContext)
    configs.delete(operatorContext)
    if (pending) {
      void pending
        .then(async (runtime) => {
          if (runtime) await runtime.browser.close().catch(() => undefined)
        })
        .catch(() => undefined)
    }
  })
}

export function mailboxProviderIsolationConfigured(operatorContext: BrowserContext): boolean {
  return configs.has(operatorContext)
}

async function launchMailboxProviderRuntime(
  operatorContext: BrowserContext,
  config: MailboxProviderBrowserConfig
): Promise<MailboxProviderBrowserRuntime | null> {
  const executablePath = config.executablePath?.trim()
  if (!executablePath) return null

  const launch: MailboxProviderBrowserLauncher = config.launchBrowser
    ?? (async (options) => await chromium.launch(options))
  let browser: Browser | null = null
  try {
    browser = await launch({
      executablePath,
      headless: true,
      ...(config.proxy ? { proxy: config.proxy } : {})
    })
    const context = await browser.newContext()
    browser.once('disconnected', () => {
      runtimes.delete(operatorContext)
    })
    return { browser, context }
  } catch {
    if (browser) await browser.close().catch(() => undefined)
    return null
  }
}

/**
 * When Auth V2 configured isolation, failure to launch the hidden provider browser
 * fails closed instead of falling back to operatorContext.newPage() and exposing a
 * mailbox tab. Direct/unit callers without configuration retain the legacy context.
 */
export async function resolveMailboxProviderContext(
  operatorContext: BrowserContext
): Promise<BrowserContext | null> {
  const config = configs.get(operatorContext)
  if (!config) return operatorContext

  const existing = runtimes.get(operatorContext)
  if (existing) return (await existing)?.context ?? null

  const pending = launchMailboxProviderRuntime(operatorContext, config)
  runtimes.set(operatorContext, pending)
  const runtime = await pending
  if (!runtime) runtimes.delete(operatorContext)
  return runtime?.context ?? null
}
