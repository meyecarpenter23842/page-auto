import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { friendlyEmailBrowserError, isEmailProfileInUseError } from './emailBrowserLifecycle'
import { FviaInboxesPlaywrightDriver } from './fviaInboxesPlaywrightDriver'
import { InboxesPlaywrightDriver } from './inboxesPlaywrightDriver'
import { resolveMailProviderId } from './mailProviderRegistry'

interface ProxyConfig {
  server: string
  username?: string
  password?: string
}

interface OpenPrimaryMailboxCommand {
  type: 'open-primary-mailbox'
  accountId: number
  mailbox: string
  profileDirectory: string
  executablePath?: string
  proxy?: ProxyConfig
}

interface OpenPrimaryMailboxResult {
  type: 'open-primary-mailbox-result'
  accountId: number
  status: 'started' | 'already_open' | 'profile_in_use' | 'error'
  attached: boolean
  proxyManagedExternally: boolean
  message: string
}

function unwrapMessage(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function parseCommand(event: unknown): OpenPrimaryMailboxCommand | null {
  const payload = unwrapMessage(event)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<OpenPrimaryMailboxCommand>
  if (candidate.type !== 'open-primary-mailbox') return null
  if (typeof candidate.accountId !== 'number' || !Number.isInteger(candidate.accountId) || candidate.accountId <= 0) return null
  if (typeof candidate.mailbox !== 'string' || !candidate.mailbox.trim()) return null
  if (typeof candidate.profileDirectory !== 'string' || !candidate.profileDirectory.trim()) return null
  if (candidate.executablePath !== undefined && typeof candidate.executablePath !== 'string') return null
  return candidate as OpenPrimaryMailboxCommand
}

async function readCdpEndpoint(profileDirectory: string): Promise<string | null> {
  try {
    const [portText] = (await readFile(join(profileDirectory, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
    if (portText && /^\d+$/.test(portText)) return `http://127.0.0.1:${portText}`
  } catch {
    // No externally attachable browser for this Email profile.
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

async function readLiveCdpEndpoint(profileDirectory: string): Promise<string | null> {
  const endpoint = await readCdpEndpoint(profileDirectory)
  return endpoint && await probeCdpEndpoint(endpoint) ? endpoint : null
}

async function resolvePage(context: BrowserContext): Promise<Page> {
  const existing = context.pages().find((page) => !page.isClosed())
  return existing ?? await context.newPage()
}

async function openProviderMailbox(context: BrowserContext, mailbox: string): Promise<string> {
  const providerId = resolveMailProviderId(mailbox)
  const page = await resolvePage(context)

  if (providerId === 'inboxes') {
    const result = await new InboxesPlaywrightDriver(page).ensureMailbox(mailbox)
    if (result.status !== 'ready') throw new Error(result.message)
    await page.bringToFront().catch(() => undefined)
    return `Đã mở mail chính ${mailbox} bằng Inboxes.`
  }

  if (providerId === 'fvia_inboxes') {
    const result = await new FviaInboxesPlaywrightDriver(page).ensureMailbox(mailbox)
    if (result.status !== 'ready') throw new Error(result.message)
    await page.bringToFront().catch(() => undefined)
    return `Đã mở mail chính ${mailbox} bằng FviaInboxes.`
  }

  throw new Error(`Provider của mail chính ${mailbox} chưa có surface Mở mail được audit.`)
}

async function run(): Promise<void> {
  let launchedContext: BrowserContext | null = null
  let attachedBrowser: Browser | null = null
  let attachedExternally = false
  let closing = false

  const closeAndExit = () => {
    if (closing) return
    closing = true
    setTimeout(() => process.exit(0), 25)
  }

  process.parentPort?.on('message', (event) => {
    const command = parseCommand(event)
    if (!command || closing) return

    void (async () => {
      let context: BrowserContext | null = launchedContext
      let newlyLaunched = false

      try {
        if (!context && attachedBrowser) context = attachedBrowser.contexts()[0] ?? null

        if (!context) {
          const endpoint = await readLiveCdpEndpoint(command.profileDirectory)
          if (endpoint) {
            try {
              attachedBrowser = await chromium.connectOverCDP(endpoint)
              context = attachedBrowser.contexts()[0] ?? null
              attachedExternally = Boolean(context)
            } catch {
              attachedBrowser = null
              attachedExternally = false
            }
          }
        }

        if (!context) {
          if (!command.executablePath?.trim()) throw new Error('Browser executable not found')
          try {
            launchedContext = await chromium.launchPersistentContext(command.profileDirectory, {
              headless: false,
              viewport: null,
              executablePath: command.executablePath.trim(),
              ...(command.proxy ? { proxy: command.proxy } : {})
            })
            context = launchedContext
            newlyLaunched = true
            launchedContext.once('close', () => {
              launchedContext = null
              closeAndExit()
            })
          } catch (error) {
            if (isEmailProfileInUseError(error)) {
              const result: OpenPrimaryMailboxResult = {
                type: 'open-primary-mailbox-result',
                accountId: command.accountId,
                status: 'profile_in_use',
                attached: false,
                proxyManagedExternally: true,
                message: friendlyEmailBrowserError(error)
              }
              process.parentPort?.postMessage(result)
              return
            }
            throw error
          }
        }

        const message = await openProviderMailbox(context, command.mailbox)
        const result: OpenPrimaryMailboxResult = {
          type: 'open-primary-mailbox-result',
          accountId: command.accountId,
          status: newlyLaunched ? 'started' : 'already_open',
          attached: attachedExternally,
          proxyManagedExternally: attachedExternally,
          message
        }
        process.parentPort?.postMessage(result)
      } catch (error) {
        const browserStillOpen = launchedContext !== null || (attachedBrowser?.isConnected() ?? false)
        const result: OpenPrimaryMailboxResult = {
          type: 'open-primary-mailbox-result',
          accountId: command.accountId,
          status: 'error',
          attached: attachedExternally,
          proxyManagedExternally: attachedExternally,
          message: browserStillOpen
            ? (error instanceof Error ? error.message : String(error))
            : friendlyEmailBrowserError(error)
        }
        process.parentPort?.postMessage(result)
      }
    })()
  })
}

void run().catch((error) => {
  console.error('[PAGE-AUTO primary mailbox browser worker]', friendlyEmailBrowserError(error))
  process.exitCode = 1
})
