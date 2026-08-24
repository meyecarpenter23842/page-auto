import { chromium, type BrowserContext } from 'playwright-core'
import type { BrowserSettings, SessionSettings } from '../../shared/appSettings'
import type { PostingProxyConfig } from '../../shared/posting'
import { inspectFacebookAccountIdentity } from './facebookAccountIdentity'
import {
  bootstrapFacebookSession,
  type FacebookSessionAccount,
  type FacebookSessionResult
} from './facebookSession'
import { applyBrowserContextSettings, buildBrowserLaunchOptions, waitForBrowserStartupDelay } from './browserRuntime'

interface BrowserLaunchConfig {
  proxy?: PostingProxyConfig
  userAgent?: string
}

interface BootstrapCommand {
  type: 'bootstrap'
  account: FacebookSessionAccount
  browser: BrowserSettings
  session: SessionSettings
  launch?: BrowserLaunchConfig
}

interface SessionResultMessage extends FacebookSessionResult {
  type: 'session-result'
}

interface BrowserClosedMessage {
  type: 'browser-closed'
}

function sessionError(accountId: number, error: unknown): SessionResultMessage {
  return {
    type: 'session-result',
    accountId,
    status: 'unknown',
    reason: 'unknown',
    cookie: null,
    cookieStatus: 'error',
    lastCookieCheck: Date.now(),
    message: error instanceof Error ? error.message : String(error)
  }
}

function identityFailure(
  accountId: number,
  identity: Awaited<ReturnType<typeof inspectFacebookAccountIdentity>>
): SessionResultMessage {
  return {
    type: 'session-result',
    accountId,
    status: 'needs_login',
    reason: identity.state === 'missing' ? 'login_required' : 'unknown',
    cookie: null,
    cookieStatus: 'needs_login',
    lastCookieCheck: Date.now(),
    message: identity.message
  }
}

function commandFromMessage(event: unknown): BootstrapCommand | null {
  const payload = event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<BootstrapCommand>
  if (candidate.type !== 'bootstrap' || !candidate.account || !candidate.browser || !candidate.session) return null
  return candidate as BootstrapCommand
}

async function run(): Promise<void> {
  const profileDirectory = process.argv[2]
  if (!profileDirectory) throw new Error('Missing browser profile directory.')

  let context: BrowserContext | null = null
  let lifetimeTimer: NodeJS.Timeout | null = null
  let closing = false
  let queue = Promise.resolve()

  const ensureContext = async (command: BootstrapCommand): Promise<BrowserContext> => {
    if (context) return context

    await waitForBrowserStartupDelay(command.browser)
    const launchOptions: NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]> = {
      ...buildBrowserLaunchOptions(command.browser),
      viewport: null,
      ...(command.launch?.userAgent ? { userAgent: command.launch.userAgent } : {})
    }
    if (command.launch?.proxy) {
      launchOptions.proxy = {
        server: command.launch.proxy.server,
        ...(command.launch.proxy.username ? { username: command.launch.proxy.username } : {}),
        ...(command.launch.proxy.password ? { password: command.launch.proxy.password } : {})
      }
    }

    const opened = await chromium.launchPersistentContext(profileDirectory, launchOptions)
    await applyBrowserContextSettings(opened, command.browser)
    context = opened

    if (lifetimeTimer) clearTimeout(lifetimeTimer)
    lifetimeTimer = setTimeout(() => {
      void opened.close().catch(() => undefined)
    }, command.browser.maxLifetimeMinutes * 60_000)

    opened.once('close', () => {
      context = null
      if (lifetimeTimer) {
        clearTimeout(lifetimeTimer)
        lifetimeTimer = null
      }
      if (closing) return
      closing = true
      const message: BrowserClosedMessage = { type: 'browser-closed' }
      process.parentPort?.postMessage(message)
      setTimeout(() => process.exit(0), 25)
    })
    return opened
  }

  process.parentPort?.on('message', (event) => {
    const command = commandFromMessage(event)
    if (!command || closing) return

    queue = queue.then(async () => {
      let result: SessionResultMessage
      try {
        const activeContext = await ensureContext(command)
        const page = activeContext.pages()[0] ?? await activeContext.newPage()
        const session = await bootstrapFacebookSession(activeContext, page, command.account, command.session.facebookLocale)
        if (session.status === 'valid') {
          const identity = await inspectFacebookAccountIdentity(activeContext, command.account.uid)
          result = identity.state === 'mismatch' || identity.state === 'missing'
            ? identityFailure(command.account.id, identity)
            : { type: 'session-result', ...session }
        } else {
          result = { type: 'session-result', ...session }
        }
      } catch (error) {
        result = sessionError(command.account.id, error)
      }
      process.parentPort?.postMessage(result)
    })
  })
}

void run().catch((error) => {
  console.error('[PAGE-AUTO browser worker]', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
