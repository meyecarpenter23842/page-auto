import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type BrowserContext } from 'playwright-core'
import type { BrowserSettings, SessionSettings } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import type { PostingProxyConfig } from '../../shared/posting'
import { inspectFacebookAccountIdentity } from './facebookAccountIdentity'
import { readFacebookDisplayName } from './facebookProfileInfo'
import {
  bootstrapFacebookSession,
  type FacebookSessionAccount,
  type FacebookSessionResult
} from './facebookSession'
import {
  applyBrowserContextSettings,
  applyBrowserPlacementToContext,
  applyBrowserWindowPlacement,
  buildBrowserLaunchOptions,
  waitForBrowserStartupDelay,
  watchForManualBrowserResize
} from './browserRuntime'
import { runWithResizeWatcherPaused } from './resizeWatchGuard'

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
  placement: BrowserWindowPlacement | null
}

interface RetileCommand {
  type: 'retile'
  placement: BrowserWindowPlacement | null
}

interface ShutdownCommand {
  type: 'shutdown'
}

interface BrowserReadyMessage {
  type: 'browser-ready'
  accountId: number
  cdpEndpoint: string
}

interface SessionResultMessage extends FacebookSessionResult {
  type: 'session-result'
  cdpEndpoint?: string
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

function messagePayload(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function commandFromMessage(event: unknown): BootstrapCommand | null {
  const payload = messagePayload(event)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<BootstrapCommand>
  if (candidate.type !== 'bootstrap' || !candidate.account || !candidate.browser || !candidate.session) return null
  return {
    ...candidate,
    type: 'bootstrap',
    account: candidate.account,
    browser: candidate.browser,
    session: candidate.session,
    placement: candidate.placement ?? null
  }
}

function retileCommandFromMessage(event: unknown): RetileCommand | null {
  const payload = messagePayload(event)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<RetileCommand>
  if (candidate.type !== 'retile') return null
  return { type: 'retile', placement: candidate.placement ?? null }
}

function isShutdownCommand(event: unknown): event is ShutdownCommand {
  const payload = messagePayload(event)
  return Boolean(payload && typeof payload === 'object' && (payload as Partial<ShutdownCommand>).type === 'shutdown')
}

async function resolveCdpEndpoint(profileDirectory: string): Promise<string | null> {
  const portFile = join(profileDirectory, 'DevToolsActivePort')
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const [portText] = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/)
      if (portText && /^\d+$/.test(portText)) return `http://127.0.0.1:${portText}`
    } catch {
      // Chrome writes DevToolsActivePort shortly after launch.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  return null
}

async function run(): Promise<void> {
  const profileDirectory = process.argv[2]
  if (!profileDirectory) throw new Error('Missing browser profile directory.')

  let context: BrowserContext | null = null
  let cdpEndpoint: string | null = null
  let activePlacement: BrowserWindowPlacement | null = null
  let manualResizeDetached = false
  let stopResizeWatch: (() => void) | null = null
  let lifetimeTimer: NodeJS.Timeout | null = null
  let closing = false
  let queue = Promise.resolve()

  const stopWatchingResize = (): void => {
    stopResizeWatch?.()
    stopResizeWatch = null
  }

  const armResizeWatch = (): void => {
    stopWatchingResize()
    const activeContext = context
    const placement = activePlacement
    if (!activeContext || !placement || manualResizeDetached) return
    stopResizeWatch = watchForManualBrowserResize(activeContext, () => {
      if (context !== activeContext) return
      manualResizeDetached = true
      activePlacement = null
      stopResizeWatch = null
    }, 350, { width: placement.width, height: placement.height })
  }

  const closeBrowserAndExit = async (): Promise<void> => {
    stopWatchingResize()
    if (lifetimeTimer) {
      clearTimeout(lifetimeTimer)
      lifetimeTimer = null
    }
    const activeContext = context
    context = null
    cdpEndpoint = null
    activePlacement = null
    manualResizeDetached = false
    if (activeContext) await activeContext.close().catch(() => undefined)
    setTimeout(() => process.exit(0), 25)
  }

  const ensureContext = async (command: BootstrapCommand): Promise<BrowserContext> => {
    if (context) {
      const activeContext = context
      if (!manualResizeDetached) {
        activePlacement = command.placement
        await runWithResizeWatcherPaused(
          stopWatchingResize,
          () => applyBrowserPlacementToContext(activeContext, activePlacement),
          armResizeWatch
        )
      }
      if (!cdpEndpoint) cdpEndpoint = await resolveCdpEndpoint(profileDirectory)
      return activeContext
    }

    manualResizeDetached = false
    activePlacement = command.placement
    await waitForBrowserStartupDelay(command.browser)
    const launchShape = buildBrowserLaunchOptions(command.browser, activePlacement)
    await rm(join(profileDirectory, 'DevToolsActivePort'), { force: true }).catch(() => undefined)
    const launchOptions: NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]> = {
      ...launchShape,
      args: [
        ...launchShape.args,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0'
      ],
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
    await runWithResizeWatcherPaused(
      stopWatchingResize,
      () => applyBrowserPlacementToContext(opened, activePlacement),
      armResizeWatch
    )
    opened.on('page', (page) => {
      void applyBrowserWindowPlacement(opened, page, activePlacement).catch(() => undefined)
    })
    cdpEndpoint = await resolveCdpEndpoint(profileDirectory)

    if (lifetimeTimer) clearTimeout(lifetimeTimer)
    lifetimeTimer = setTimeout(() => {
      void opened.close().catch(() => undefined)
    }, command.browser.maxLifetimeMinutes * 60_000)

    opened.once('close', () => {
      stopWatchingResize()
      context = null
      cdpEndpoint = null
      activePlacement = null
      manualResizeDetached = false
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
    if (isShutdownCommand(event)) {
      if (closing) return
      closing = true
      void queue.finally(closeBrowserAndExit)
      return
    }

    const retile = retileCommandFromMessage(event)
    if (retile && !closing) {
      const placement = retile.placement
      queue = queue.then(async () => {
        manualResizeDetached = false
        activePlacement = placement
        const activeContext = context
        if (activeContext) {
          await runWithResizeWatcherPaused(
            stopWatchingResize,
            () => applyBrowserPlacementToContext(activeContext, activePlacement),
            armResizeWatch
          )
        }
      })
      return
    }

    const command = commandFromMessage(event)
    if (!command || closing) return

    queue = queue.then(async () => {
      let result: SessionResultMessage
      try {
        const activeContext = await ensureContext(command)
        if (cdpEndpoint) {
          const ready: BrowserReadyMessage = {
            type: 'browser-ready',
            accountId: command.account.id,
            cdpEndpoint
          }
          process.parentPort?.postMessage(ready)
        }

        const page = activeContext.pages()[0] ?? await activeContext.newPage()
        if (!manualResizeDetached) {
          await applyBrowserWindowPlacement(activeContext, page, activePlacement).catch(() => undefined)
        }
        const session = await bootstrapFacebookSession(activeContext, page, command.account, command.session.facebookLocale)
        if (session.status === 'valid') {
          const identity = await inspectFacebookAccountIdentity(activeContext, command.account.uid)
          if (identity.state === 'mismatch' || identity.state === 'missing') {
            result = identityFailure(command.account.id, identity)
          } else {
            const profileName = identity.state === 'match'
              ? await readFacebookDisplayName(page).catch(() => null)
              : null
            result = { type: 'session-result', ...session, ...(profileName ? { profileName } : {}) }
          }
        } else {
          result = { type: 'session-result', ...session }
        }
      } catch (error) {
        result = sessionError(command.account.id, error)
      }
      process.parentPort?.postMessage({
        ...result,
        ...(cdpEndpoint ? { cdpEndpoint } : {})
      })
    })
  })
}

void run().catch((error) => {
  console.error('[PAGE-AUTO browser worker]', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
