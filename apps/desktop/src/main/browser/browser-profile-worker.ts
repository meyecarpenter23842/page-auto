import { chromium, type BrowserContext } from 'playwright-core'
import {
  bootstrapFacebookSession,
  type FacebookSessionAccount,
  type FacebookSessionResult
} from './facebookSession'

interface BootstrapCommand {
  type: 'bootstrap'
  account: FacebookSessionAccount
}

interface SessionResultMessage extends FacebookSessionResult {
  type: 'session-result'
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

  const contextPromise: Promise<BrowserContext> = chromium.launchPersistentContext(profileDirectory, {
    channel: 'chrome',
    headless: false,
    viewport: null
  })

  let queue = Promise.resolve()
  process.parentPort?.on('message', (event) => {
    const command = commandFromMessage(event)
    if (!command) return

    queue = queue.then(async () => {
      const context = await contextPromise
      const page = context.pages()[0] ?? await context.newPage()
      let result: SessionResultMessage
      try {
        const session = await bootstrapFacebookSession(context, page, command.account)
        result = { type: 'session-result', ...session }
      } catch (error) {
        result = sessionError(command.account.id, error)
      }
      process.parentPort?.postMessage(result)
    })
  })

  const context = await contextPromise
  if (context.pages().length === 0) await context.newPage()

  await new Promise<void>((resolve) => {
    context.once('close', () => resolve())
  })
}

void run().catch((error) => {
  console.error('[PAGE-AUTO browser worker]', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
