import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type BrowserContext } from 'playwright-core'
import type { BrowserSettings, SessionSettings } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import { buildBrowserVisualBaselineSnapshot } from '../../shared/browserVisualBaseline'
import { sameWholeChromeScale, wholeChromeScaleForLaunch } from '../../shared/browserWholeChromeScale'
import type {
  FacebookCheckpoint282Action,
  FacebookCheckpoint282Result,
  FacebookCheckpointSurface
} from '../../shared/facebookCheckpoint'
import type { PostingProxyConfig } from '../../shared/posting'
import { createEmailCodeWorkerRpc } from '../email/emailCodeWorkerRpc'
import { runFacebookCommonChallengeRuntime } from '../facebook/facebookCommonChallengeRuntime'
import { resolveCheckLiveAccountStatus } from './checkLiveAccountStatus'
import { inspectFacebookAccountIdentity } from './facebookAccountIdentity'
import { readFacebookDisplayName } from './facebookProfileInfo'
import {
  facebookCheckpoint282IdentityAccepted,
  facebookCheckpoint282State,
  facebookCheckpointSurfaceUrl
} from './facebookCheckpoint282'
import {
  bootstrapFacebookSession,
  type FacebookSessionAccount,
  type FacebookSessionResult
} from './facebookSession'
import { detectFacebookCheckpointKind } from './posting/facebookCheckpoint'
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

interface ContextCommand {
  account: FacebookSessionAccount
  browser: BrowserSettings
  launch?: BrowserLaunchConfig
  placement: BrowserWindowPlacement | null
}

interface BootstrapCommand extends ContextCommand {
  type: 'bootstrap'
  session: SessionSettings
}

interface Checkpoint282Command {
  type: 'checkpoint-282'
  account: FacebookSessionAccount
  browser: BrowserSettings
  surface: FacebookCheckpointSurface
  action: FacebookCheckpoint282Action
  sessionWasValid: boolean
  evidenceFolder?: string | null
}

interface Checkpoint956Command extends ContextCommand {
  type: 'checkpoint-956'
  session: SessionSettings
  surface: FacebookCheckpointSurface
  action: FacebookCheckpoint282Action
  evidenceFolder?: string | null
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

interface Checkpoint282ResultMessage extends FacebookCheckpoint282Result {
  type: 'checkpoint-282-result'
}

interface Checkpoint956ResultMessage extends FacebookCheckpoint282Result {
  type: 'checkpoint-956-result'
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

function checkpointError(command: Checkpoint282Command, error: unknown): Checkpoint282ResultMessage {
  return {
    type: 'checkpoint-282-result',
    accountId: command.account.id,
    uid: command.account.uid,
    state: 'error',
    surface: command.surface,
    message: error instanceof Error ? error.message : String(error)
  }
}

function checkpoint956Error(command: Checkpoint956Command, error: unknown): Checkpoint956ResultMessage {
  return {
    type: 'checkpoint-956-result',
    accountId: command.account.id,
    uid: command.account.uid,
    state: 'error',
    surface: command.surface,
    checkpointKind: '956',
    message: error instanceof Error ? error.message : String(error)
  }
}

function identityFailure(
  accountId: number,
  identity: Awaited<ReturnType<typeof inspectFacebookAccountIdentity>>
): SessionResultMessage {
  const missing = identity.state === 'missing'
  return {
    type: 'session-result',
    accountId,
    status: missing ? 'needs_login' : 'needs_attention',
    reason: missing ? 'login_required' : 'unknown',
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
    type: 'bootstrap',
    account: candidate.account,
    browser: candidate.browser,
    session: candidate.session,
    placement: candidate.placement ?? null,
    ...(candidate.launch ? { launch: candidate.launch } : {})
  }
}

function checkpoint282CommandFromMessage(event: unknown): Checkpoint282Command | null {
  const payload = messagePayload(event)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<Checkpoint282Command>
  if (
    candidate.type !== 'checkpoint-282'
    || !candidate.account
    || !candidate.browser
    || !candidate.surface
    || !candidate.action
    || typeof candidate.sessionWasValid !== 'boolean'
  ) return null
  return {
    type: 'checkpoint-282',
    account: candidate.account,
    browser: candidate.browser,
    surface: candidate.surface,
    action: candidate.action,
    sessionWasValid: candidate.sessionWasValid,
    evidenceFolder: candidate.evidenceFolder ?? null
  }
}

function checkpoint956CommandFromMessage(event: unknown): Checkpoint956Command | null {
  const payload = messagePayload(event)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<Checkpoint956Command>
  if (
    candidate.type !== 'checkpoint-956'
    || !candidate.account
    || !candidate.browser
    || !candidate.session
    || !candidate.surface
    || !candidate.action
  ) return null
  return {
    type: 'checkpoint-956',
    account: candidate.account,
    browser: candidate.browser,
    session: candidate.session,
    surface: candidate.surface,
    action: candidate.action,
    evidenceFolder: candidate.evidenceFolder ?? null,
    placement: candidate.placement ?? null,
    ...(candidate.launch ? { launch: candidate.launch } : {})
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

type VisualBaselineProbePhase = 'launch' | 'retile' | 'manual-resize-detached'

async function logVisualBaselineProbe(
  context: BrowserContext,
  input: {
    phase: VisualBaselineProbePhase
    browserScale: number
    compact: boolean
    manualResizeDetached: boolean
  }
): Promise<void> {
  const page = context.pages()[0]
  if (!page) return

  const metrics = await page.evaluate(() => {
    const visualViewport = window.visualViewport
    return {
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      visualViewportWidth: visualViewport?.width ?? window.innerWidth,
      visualViewportHeight: visualViewport?.height ?? window.innerHeight,
      visualViewportScale: visualViewport?.scale ?? 1
    }
  }).catch(() => null)
  if (!metrics) return

  const snapshot = buildBrowserVisualBaselineSnapshot({
    metrics,
    browserScale: input.browserScale,
    compact: input.compact,
    manualResizeDetached: input.manualResizeDetached
  })
  console.info(`[PAGE-AUTO visual-baseline] phase=${input.phase} ${JSON.stringify(snapshot)}`)
}

async function run(): Promise<void> {
  const profileDirectory = process.argv[2]
  if (!profileDirectory) throw new Error('Missing browser profile directory.')
  const parentPort = process.parentPort
  if (!parentPort) throw new Error('Browser profile worker phải chạy dưới Electron utilityProcess.')
  const emailCodeRpc = createEmailCodeWorkerRpc((message) => parentPort.postMessage(message))

  let context: BrowserContext | null = null
  let cdpEndpoint: string | null = null
  let activePlacement: BrowserWindowPlacement | null = null
  let launchedWholeChromeScale: number | null = null
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
    const browserScale = launchedWholeChromeScale ?? 1
    stopResizeWatch = watchForManualBrowserResize(activeContext, () => {
      if (context !== activeContext) return
      manualResizeDetached = true
      activePlacement = null
      stopResizeWatch = null
      void logVisualBaselineProbe(activeContext, {
        phase: 'manual-resize-detached',
        browserScale,
        compact: true,
        manualResizeDetached: true
      })
    }, 350, { width: placement.width, height: placement.height })
  }

  const scaleMatchesRunningChrome = (placement: BrowserWindowPlacement | null): boolean => {
    return sameWholeChromeScale(launchedWholeChromeScale, wholeChromeScaleForLaunch(placement))
  }

  const logReopenRequired = (placement: BrowserWindowPlacement | null): void => {
    console.info(
      `[PAGE-AUTO compact-scale] reopen-required running=${launchedWholeChromeScale ?? 1} requested=${wholeChromeScaleForLaunch(placement) ?? 1}`
    )
  }

  const closeBrowserAndExit = async (): Promise<void> => {
    stopWatchingResize()
    emailCodeRpc.dispose()
    if (lifetimeTimer) {
      clearTimeout(lifetimeTimer)
      lifetimeTimer = null
    }
    const activeContext = context
    context = null
    cdpEndpoint = null
    activePlacement = null
    launchedWholeChromeScale = null
    manualResizeDetached = false
    if (activeContext) await activeContext.close().catch(() => undefined)
    setTimeout(() => process.exit(0), 25)
  }

  const ensureContext = async (command: ContextCommand): Promise<BrowserContext> => {
    if (context) {
      const activeContext = context
      if (!manualResizeDetached) {
        if (scaleMatchesRunningChrome(command.placement)) {
          activePlacement = command.placement
          await runWithResizeWatcherPaused(
            stopWatchingResize,
            () => applyBrowserPlacementToContext(activeContext, activePlacement),
            armResizeWatch
          )
        } else {
          logReopenRequired(command.placement)
        }
      }
      if (!cdpEndpoint) cdpEndpoint = await resolveCdpEndpoint(profileDirectory)
      return activeContext
    }

    manualResizeDetached = false
    activePlacement = command.placement
    launchedWholeChromeScale = wholeChromeScaleForLaunch(activePlacement)
    await waitForBrowserStartupDelay(command.browser)
    const launchShape = buildBrowserLaunchOptions(command.browser, activePlacement)
    await rm(join(profileDirectory, 'DevToolsActivePort'), { force: true }).catch(() => undefined)
    const launchOptions: NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]> = {
      ...launchShape,
      args: [
        ...launchShape.args,
        ...(launchedWholeChromeScale !== null
          ? [`--force-device-scale-factor=${launchedWholeChromeScale}`]
          : []),
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0'
      ],
      viewport: null,
      ...(command.launch?.userAgent ? { userAgent: command.launch.userAgent } : {})
    }
    if (launchedWholeChromeScale !== null && activePlacement) {
      console.info(
        `[PAGE-AUTO compact-scale] factor=${launchedWholeChromeScale} logical=${activePlacement.width}x${activePlacement.height} viewport=${activePlacement.viewportWidth}x${activePlacement.viewportHeight}`
      )
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
    await logVisualBaselineProbe(opened, {
      phase: 'launch',
      browserScale: launchedWholeChromeScale ?? 1,
      compact: activePlacement !== null,
      manualResizeDetached
    })
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
      launchedWholeChromeScale = null
      manualResizeDetached = false
      if (lifetimeTimer) {
        clearTimeout(lifetimeTimer)
        lifetimeTimer = null
      }
      if (closing) return
      closing = true
      const message: BrowserClosedMessage = { type: 'browser-closed' }
      parentPort.postMessage(message)
      emailCodeRpc.dispose()
      setTimeout(() => process.exit(0), 25)
    })
    return opened
  }

  const postReady = (accountId: number): void => {
    if (!cdpEndpoint) return
    const ready: BrowserReadyMessage = { type: 'browser-ready', accountId, cdpEndpoint }
    parentPort.postMessage(ready)
  }

  const handleCheckpoint282 = async (command: Checkpoint282Command): Promise<Checkpoint282ResultMessage> => {
    const activeContext = context
    if (!activeContext) {
      return {
        type: 'checkpoint-282-result',
        accountId: command.account.id,
        uid: command.account.uid,
        state: 'error',
        surface: command.surface,
        message: 'Browser của account chưa mở; không thể kiểm tra CP282.'
      }
    }

    const page = activeContext.pages()[0] ?? await activeContext.newPage()
    if (command.sessionWasValid) {
      const identity = await inspectFacebookAccountIdentity(activeContext, command.account.uid)
      if (!facebookCheckpoint282IdentityAccepted(identity.state)) {
        return {
          type: 'checkpoint-282-result',
          accountId: command.account.id,
          uid: command.account.uid,
          state: 'needs_login',
          surface: command.surface,
          message: `Session đã rời checkpoint nhưng chưa xác nhận đúng account. ${identity.message}`
        }
      }

      let evidencePath: string | null = null
      if (command.action === 'recheck' && command.evidenceFolder?.trim()) {
        const folder = command.evidenceFolder.trim()
        const safeUid = command.account.uid.replace(/[^a-zA-Z0-9._-]/g, '_') || `account-${command.account.id}`
        await mkdir(folder, { recursive: true })
        evidencePath = join(folder, `${safeUid}.png`)
        await page.screenshot({ path: evidencePath }).catch(() => { evidencePath = null })
      }

      return {
        type: 'checkpoint-282-result',
        accountId: command.account.id,
        uid: command.account.uid,
        state: 'resolved',
        surface: command.surface,
        message: identity.state === 'match'
          ? 'Session hợp lệ và c_user đã khớp UID account sau CP282.'
          : 'Session hợp lệ sau CP282; UID/Tên đăng nhập không phải ID số nên tiếp tục theo Session Common hiện có.',
        ...(evidencePath ? { evidencePath } : {})
      }
    }

    let kind = await detectFacebookCheckpointKind(page).catch(() => null)
    if (kind === '282') {
      const targetUrl = facebookCheckpointSurfaceUrl(page.url(), command.surface)
      if (targetUrl && targetUrl !== page.url()) {
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: command.browser.navigationTimeoutMs
        }).catch(() => undefined)
        if (command.browser.pageSettleDelayMs > 0) await page.waitForTimeout(command.browser.pageSettleDelayMs)
        kind = await detectFacebookCheckpointKind(page).catch(() => kind)
      }
    }

    const state = facebookCheckpoint282State(kind)
    if (state === 'waiting_manual') {
      return {
        type: 'checkpoint-282-result',
        accountId: command.account.id,
        uid: command.account.uid,
        state,
        surface: command.surface,
        checkpointKind: '282',
        message: 'Đã nhận diện CP282. Browser được giữ nguyên để hoàn tất bước xác minh trực tiếp; sau đó dùng Kiểm tra lại.'
      }
    }
    if (state === 'different_checkpoint') {
      return {
        type: 'checkpoint-282-result',
        accountId: command.account.id,
        uid: command.account.uid,
        state,
        surface: command.surface,
        ...(kind ? { checkpointKind: kind } : {}),
        message: `Account đang ở checkpoint ${kind ?? 'khác'}, không chạy flow CP282.`
      }
    }
    return {
      type: 'checkpoint-282-result',
      accountId: command.account.id,
      uid: command.account.uid,
      state: 'needs_login',
      surface: command.surface,
      message: 'Chưa nhận diện CP282 và session vẫn chưa hợp lệ; browser được giữ mở để kiểm tra.'
    }
  }

  const handleCheckpoint956 = async (command: Checkpoint956Command): Promise<Checkpoint956ResultMessage> => {
    const activeContext = await ensureContext(command)
    postReady(command.account.id)
    const page = activeContext.pages()[0] ?? await activeContext.newPage()
    if (!manualResizeDetached) {
      await applyBrowserWindowPlacement(activeContext, page, activePlacement).catch(() => undefined)
    }

    // Critical invariant: Common Runtime inspects this exact live page before it
    // is allowed to call Session Common/bootstrap and navigate anywhere.
    const common = await runFacebookCommonChallengeRuntime({
      context: activeContext,
      page,
      account: command.account,
      locale: command.session.facebookLocale,
      emailCodeProvider: emailCodeRpc.provider
    })

    let evidencePath: string | null = null
    if (command.action === 'recheck' && common.state === 'resolved' && command.evidenceFolder?.trim()) {
      const folder = command.evidenceFolder.trim()
      const safeUid = command.account.uid.replace(/[^a-zA-Z0-9._-]/g, '_') || `account-${command.account.id}`
      await mkdir(folder, { recursive: true })
      evidencePath = join(folder, `${safeUid}-cp956.png`)
      await page.screenshot({ path: evidencePath }).catch(() => { evidencePath = null })
    }

    return {
      type: 'checkpoint-956-result',
      accountId: command.account.id,
      uid: command.account.uid,
      state: common.state,
      surface: command.surface,
      checkpointKind: common.checkpointKind ?? '956',
      challengeType: common.challengeType,
      message: common.message,
      ...(evidencePath ? { evidencePath } : {})
    }
  }

  parentPort.on('message', (event) => {
    const payload = messagePayload(event)
    if (emailCodeRpc.handleMessage(payload)) return

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
        const activeContext = context
        if (activeContext && !scaleMatchesRunningChrome(placement)) {
          logReopenRequired(placement)
          return
        }
        activePlacement = placement
        if (activeContext) {
          await runWithResizeWatcherPaused(
            stopWatchingResize,
            () => applyBrowserPlacementToContext(activeContext, activePlacement),
            armResizeWatch
          )
          await logVisualBaselineProbe(activeContext, {
            phase: 'retile',
            browserScale: launchedWholeChromeScale ?? 1,
            compact: placement !== null,
            manualResizeDetached
          })
        }
      })
      return
    }

    const checkpoint956Command = checkpoint956CommandFromMessage(event)
    if (checkpoint956Command && !closing) {
      queue = queue.then(async () => {
        let result: Checkpoint956ResultMessage
        try {
          result = await handleCheckpoint956(checkpoint956Command)
        } catch (error) {
          result = checkpoint956Error(checkpoint956Command, error)
        }
        parentPort.postMessage(result)
      })
      return
    }

    const checkpointCommand = checkpoint282CommandFromMessage(event)
    if (checkpointCommand && !closing) {
      queue = queue.then(async () => {
        let result: Checkpoint282ResultMessage
        try {
          result = await handleCheckpoint282(checkpointCommand)
        } catch (error) {
          result = checkpointError(checkpointCommand, error)
        }
        parentPort.postMessage(result)
      })
      return
    }

    const command = commandFromMessage(event)
    if (!command || closing) return

    queue = queue.then(async () => {
      let result: SessionResultMessage
      try {
        const activeContext = await ensureContext(command)
        postReady(command.account.id)

        const page = activeContext.pages()[0] ?? await activeContext.newPage()
        if (!manualResizeDetached) {
          await applyBrowserWindowPlacement(activeContext, page, activePlacement).catch(() => undefined)
        }
        const session = await bootstrapFacebookSession(activeContext, page, command.account, command.session.facebookLocale)
        session.status = await resolveCheckLiveAccountStatus(page, session)
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
      parentPort.postMessage({ ...result, ...(cdpEndpoint ? { cdpEndpoint } : {}) })
    })
  })
}

void run().catch((error) => {
  console.error('[PAGE-AUTO browser worker]', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
