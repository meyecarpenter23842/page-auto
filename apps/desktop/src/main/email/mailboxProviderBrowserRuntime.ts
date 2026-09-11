import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

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
  executablePath?: string | undefined
  proxy?: MailboxProviderProxyConfig | undefined
  profileDirectory?: string | undefined
  /** Test seam; production uses Playwright chromium.launch. */
  launchBrowser?: MailboxProviderBrowserLauncher | undefined
  /** Test seam for detecting a live externally attached CDP profile. */
  hasLiveCdpEndpoint?: ((profileDirectory: string) => Promise<boolean>) | undefined
}

interface MailboxProviderBrowserRuntime {
  browser: Browser
  context: BrowserContext
}

type RuntimeContextShape = {
  pages?: () => Page[]
  on?: BrowserContext['on']
}

const configs = new WeakMap<BrowserContext, MailboxProviderBrowserConfig>()
const runtimes = new WeakMap<BrowserContext, Promise<MailboxProviderBrowserRuntime | null>>()
const cleanupBound = new WeakSet<BrowserContext>()
const PROVIDER_FOREGROUND_RESTORE_DELAY_MS = 120

async function readCdpEndpoint(profileDirectory: string): Promise<string | null> {
  try {
    const [portText] = (await readFile(join(profileDirectory, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
    if (portText && /^\d+$/.test(portText)) return `http://127.0.0.1:${portText}`
  } catch {
    // App-launched Playwright persistent contexts use the pipe transport and do
    // not require a DevToolsActivePort file. Missing/stale files are not external.
  }
  return null
}

async function probeCdpEndpoint(endpoint: string, timeoutMs = 650): Promise<boolean> {
  return await new Promise<boolean>((resolveProbe) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolveProbe(value)
    }
    try {
      const req = request(new URL('/json/version', endpoint), { method: 'GET', timeout: timeoutMs }, (response) => {
        response.resume()
        finish((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 500)
      })
      req.once('timeout', () => {
        req.destroy()
        finish(false)
      })
      req.once('error', () => finish(false))
      req.end()
    } catch {
      finish(false)
    }
  })
}

async function hasLiveEmailCdpEndpoint(profileDirectory: string): Promise<boolean> {
  const endpoint = await readCdpEndpoint(profileDirectory)
  return endpoint !== null && await probeCdpEndpoint(endpoint)
}

async function externalProxyBoundaryIsUnknown(config: MailboxProviderBrowserConfig): Promise<boolean> {
  if (config.proxy) return false
  const profileDirectory = config.profileDirectory?.trim()
  if (!profileDirectory) return false
  const hasLiveCdpEndpoint = config.hasLiveCdpEndpoint ?? hasLiveEmailCdpEndpoint
  return await hasLiveCdpEndpoint(profileDirectory)
}

function newestOpenOperatorPage(operatorContext: BrowserContext): Page | null {
  const candidate = operatorContext as unknown as RuntimeContextShape
  if (typeof candidate.pages !== 'function') return null
  const pages = candidate.pages()
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index]
    if (page && !page.isClosed()) return page
  }
  return null
}

function restoreOperatorForeground(operatorContext: BrowserContext): void {
  const page = newestOpenOperatorPage(operatorContext)
  if (!page) return
  void page.bringToFront().catch(() => undefined)
}

/**
 * The isolated mailbox browser is intentionally headed for live diagnostics, but
 * its new window must not replace Microsoft as the operator-facing foreground.
 * Provider pages remain fully usable by Playwright in the background. Restore the
 * newest operator page immediately and once more after Chromium finishes showing
 * the newly created provider window.
 */
export function bindMailboxProviderForegroundGuard(
  operatorContext: BrowserContext,
  providerContext: BrowserContext
): void {
  const provider = providerContext as unknown as RuntimeContextShape
  if (typeof provider.on !== 'function') return

  provider.on('page', () => {
    restoreOperatorForeground(operatorContext)
    const timer = setTimeout(() => restoreOperatorForeground(operatorContext), PROVIDER_FOREGROUND_RESTORE_DELAY_MS)
    timer.unref?.()
  })
}

/**
 * Bind mailbox browsing to an isolated headed Chromium process owned by the
 * visible Email operator context. The provider remains outside the Microsoft
 * Chrome window, but its own window is visible so live Inboxes failures can be
 * inspected directly instead of being hidden inside a headless worker.
 */
export function configureMailboxProviderBrowser(
  operatorContext: BrowserContext,
  config: MailboxProviderBrowserConfig
): void {
  configs.set(operatorContext, {
    ...(config.executablePath ? { executablePath: config.executablePath } : {}),
    ...(config.proxy ? { proxy: config.proxy } : {}),
    ...(config.profileDirectory ? { profileDirectory: config.profileDirectory } : {}),
    ...(config.launchBrowser ? { launchBrowser: config.launchBrowser } : {}),
    ...(config.hasLiveCdpEndpoint ? { hasLiveCdpEndpoint: config.hasLiveCdpEndpoint } : {})
  })
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
      headless: false,
      ...(config.proxy ? { proxy: config.proxy } : {})
    })
    const context = await browser.newContext()
    bindMailboxProviderForegroundGuard(operatorContext, context)
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
 * When Auth V2 configured isolation, failure to launch the separate provider
 * browser fails closed instead of falling back to operatorContext.newPage() and
 * exposing a mailbox tab inside Microsoft Chrome. A live DevToolsActivePort means
 * the worker attached to an already running Email Chrome profile; without an
 * explicit proxy config we cannot safely reproduce that external network boundary
 * in the provider browser, so fail closed before any direct launch. Direct/unit
 * callers without configuration retain the legacy context.
 */
export async function resolveMailboxProviderContext(
  operatorContext: BrowserContext
): Promise<BrowserContext | null> {
  const config = configs.get(operatorContext)
  if (!config) return operatorContext
  if (await externalProxyBoundaryIsUnknown(config)) return null

  const existing = runtimes.get(operatorContext)
  if (existing) return (await existing)?.context ?? null

  const pending = launchMailboxProviderRuntime(operatorContext, config)
  runtimes.set(operatorContext, pending)
  const runtime = await pending
  if (!runtime) runtimes.delete(operatorContext)
  return runtime?.context ?? null
}
