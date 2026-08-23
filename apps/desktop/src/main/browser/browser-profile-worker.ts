import { chromium, type BrowserContext } from 'playwright-core'
import type { PostingProxyConfig } from '../../shared/posting'
import {
  bootstrapFacebookSession,
  type FacebookSessionAccount,
  type FacebookSessionResult
} from './facebookSession'

interface BrowserLaunchConfig {
  proxy?: PostingProxyConfig
  userAgent?: string
}

interface BootstrapCommand {
  type: 'bootstrap'
  account: FacebookSessionAccount
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
    cookie: null,
    cookieStatus: 'error',
    lastCookieCheck: Date.now(),
    message: error instanceof Error ? error.message : String(error)
  }
}

function commandFromMessage(event: unknown): BootstrapCommand | null {
  const payload = event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<BootstrapCommand>
  if (candidate.type !== 'bootstrap' || !candidate.account) return null
  return candidate as BootstrapCommand
}

async function run(): Promise<void> {
  const profileDirectory = process.argv[2]
  if (!profileDirectory) throw new Error('Missing browser profile directory.')

  let context: BrowserContext | null = null
  let closing = false
  let queue = Promise.resolve()

  const ensureContext = async (command: BootstrapCommand): Promise<BrowserContext> => {
    if (context) return context

    const launchOptions: NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]> = {
      channel: 'chrome',
      headless: false,
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
    context = opened
    opened.once('close', () => {
      context = null
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
        const session = await bootstrapFacebookSession(activeContext, page, command.account)
        result = { type: 'session-result', ...session }
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
