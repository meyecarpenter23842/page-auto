import type { AccountStatus } from '../../shared/accounts'
import { actionRuntimeResult, type ActionExecutionSummary, type ActionRunControl } from '../../shared/actionRuntime'
import { accountStatusFromFacebookSessionReason } from '../../shared/facebookAccountState'
import type { PostingJobResult } from '../../shared/posting'
import type {
  ScenarioActionWorkerJob,
  ScenarioActionWorkerRequestMessage,
  ScenarioActionWorkerResult
} from '../../shared/scenarioActionWorker'
import { FacebookCommonActionHost } from './actionRuntime/facebookCommonActionHost'
import { createK4ActionExecutorRegistry } from './actionRuntime/actions'
import { inspectFacebookAccountIdentity } from './facebookAccountIdentity'
import { ensureFacebookProfileIdentity } from './facebookProfileIdentity'
import { bootstrapFacebookSession, type FacebookSessionResult } from './facebookSession'
import {
  closeManagedPostingBrowser,
  ensureManagedBrowserVisualLayout,
  installManagedBrowserReuse,
  setManagedBrowserPlacement
} from './managedBrowserBridge'
import {
  detectFacebookAccountStatus,
  detectFacebookCheckpointKind,
  withFacebookCheckpointKind
} from './posting/facebookCheckpoint'
import { ActionRunner } from '../services/actionRunner'
import {
  FacebookCommonRuntime,
  type FacebookCommonStepResult
} from '../facebook/facebookCommonRuntime'
import { withoutFacebookInteractionPacing } from '../facebook/facebookInteractionPacing'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Scenario action worker phải chạy dưới Electron utilityProcess.')

installManagedBrowserReuse()
let queue = Promise.resolve()
let shuttingDown = false
const stoppedRunKeys = new Set<string>()
const pausedRunKeys = new Set<string>()

function messagePayload(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function identitySessionFailure(job: ScenarioActionWorkerJob, message: string): FacebookSessionResult {
  return {
    accountId: job.accountId,
    status: 'needs_login',
    reason: 'login_required',
    cookie: null,
    cookieStatus: 'needs_login',
    lastCookieCheck: Date.now(),
    message
  }
}

async function ensureProfileSession(job: ScenarioActionWorkerJob, runtime: FacebookCommonRuntime): Promise<FacebookSessionResult> {
  const session = await withoutFacebookInteractionPacing(runtime.page, () => (
    bootstrapFacebookSession(
      runtime.context,
      runtime.page,
      job.sessionAccount,
      job.session.facebookLocale
    )
  ))
  if (session.reason === 'checkpoint') {
    const kind = await detectFacebookCheckpointKind(runtime.page).catch(() => null)
    return { ...session, message: withFacebookCheckpointKind(session.message, kind) }
  }
  if (session.status !== 'valid') return session
  const identity = await inspectFacebookAccountIdentity(runtime.context, job.sessionAccount.uid)
  if (identity.state === 'mismatch' || identity.state === 'missing') {
    return identitySessionFailure(job, identity.message)
  }
  return session
}

function commonStepToPosting(result: FacebookCommonStepResult): PostingJobResult {
  if (result.status === 'success') return { status: 'success', message: result.message }
  return {
    status: result.status === 'needs_login' ? 'needs_login' : 'failed',
    ...(result.code ? { code: result.code } : {}),
    message: result.message
  }
}

function failedSummary(job: ScenarioActionWorkerJob, code: string, message: string): ActionExecutionSummary {
  const now = Date.now()
  return {
    result: { status: 'failed', code, message },
    normalizedConfig: null,
    attempts: 0,
    startedAt: now,
    finishedAt: now
  }
}

function mapOpenFailure(job: ScenarioActionWorkerJob, message: string, code?: string): ActionExecutionSummary {
  if (code === 'verification_required') {
    const summary = failedSummary(job, 'checkpoint_required', message)
    summary.result.status = 'needs_attention'
    return summary
  }
  if (code === 'needs_login' || code?.startsWith('email_')) {
    const summary = failedSummary(job, 'session_needs_login', message)
    summary.result.status = 'needs_attention'
    return summary
  }
  if (code === 'proxy_unavailable') return failedSummary(job, 'network_timeout', message)
  return failedSummary(job, 'browser_unavailable', message)
}

function actionDependencies(runtime: FacebookCommonRuntime, job: ScenarioActionWorkerJob) {
  const common = {
    resolvePage: async () => runtime.page,
    navigationTimeoutMs: job.browser.navigationTimeoutMs
  }
  return {
    view: { newsfeed: common, story: common, reel: common },
    friends: {
      friendInteraction: common,
      pokeFriend: common,
      sendFriendRequest: common,
      acceptFriendRequest: common,
      cancelSentFriendRequests: common,
      unfriend: common,
      friendFromEngagement: common
    },
    groups: {
      joinGroup: common
    }
  }
}

async function liveAccountStatus(runtime: FacebookCommonRuntime, fallback: AccountStatus): Promise<AccountStatus> {
  return detectFacebookAccountStatus(runtime.page).catch(() => fallback)
}

async function waitIfRunPaused(runKey: string): Promise<void> {
  while (pausedRunKeys.has(runKey) && !stoppedRunKeys.has(runKey)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
}

async function sleepWithRunControl(runKey: string, delayMs: number): Promise<void> {
  let remaining = Math.max(0, delayMs)
  while (remaining > 0 && !stoppedRunKeys.has(runKey)) {
    await waitIfRunPaused(runKey)
    if (stoppedRunKeys.has(runKey)) return
    const chunk = Math.min(100, remaining)
    await new Promise<void>((resolve) => setTimeout(resolve, chunk))
    remaining -= chunk
  }
}

async function execute(job: ScenarioActionWorkerJob): Promise<ScenarioActionWorkerResult> {
  setManagedBrowserPlacement(job.browserPlacement ?? null)
  const pageUid = job.request.actor.kind === 'page' ? job.request.actor.pageUid.trim() : ''
  const opened = await FacebookCommonRuntime.open({
    profileDirectory: job.profileDirectory,
    pageUid,
    browser: job.browser,
    session: job.session,
    network: job.network,
    sessionAccount: job.sessionAccount,
    ...(job.userAgent ? { userAgent: job.userAgent } : {}),
    ...(job.proxy ? { proxy: job.proxy } : {})
  })
  if (opened.status === 'failed') {
    return {
      summary: mapOpenFailure(job, opened.result.message, opened.result.code),
      sessionCookie: null,
      accountName: null,
      sessionState: opened.result.code === 'verification_required'
        ? 'verification_required'
        : opened.result.status === 'needs_login' ? 'needs_login' : null,
      ...(opened.result.sessionValidation?.accountStatus
        ? { accountStatus: opened.result.sessionValidation.accountStatus }
        : {})
    }
  }

  const runtime = opened.runtime
  const control: ActionRunControl = {
    isStopped: () => stoppedRunKeys.has(job.request.runKey),
    waitIfPaused: () => waitIfRunPaused(job.request.runKey),
    sleep: (delayMs) => sleepWithRunControl(job.request.runKey, delayMs)
  }

  let latestSession: FacebookSessionResult | null = null
  let latestAccountStatus: AccountStatus | null = null
  const host = new FacebookCommonActionHost({
    ensureSession: async () => {
      latestSession = await ensureProfileSession(job, runtime)
      latestAccountStatus = latestSession.reason === 'checkpoint'
        ? await liveAccountStatus(runtime, 'checkpoint_unknown')
        : accountStatusFromFacebookSessionReason(latestSession.reason)
      return latestSession
    },
    ensureProfile: async () => {
      let result = await ensureFacebookProfileIdentity(
        runtime.context,
        runtime.page,
        runtime.browser,
        job.sessionAccount.uid
      )
      if (result.code === 'verification_required') {
        const kind = await detectFacebookCheckpointKind(runtime.page).catch(() => null)
        result = { ...result, message: withFacebookCheckpointKind(result.message, kind) }
        latestAccountStatus = await liveAccountStatus(runtime, 'checkpoint_unknown')
      } else if (result.code === 'needs_login') {
        latestAccountStatus = 'needs_login'
      } else if (result.status === 'success') {
        latestAccountStatus = 'valid'
      }
      if (result.status === 'success' && result.sessionCookie && latestSession?.status === 'valid') {
        latestSession = { ...latestSession, cookie: result.sessionCookie }
      }
      return result
    },
    switchPage: async () => commonStepToPosting(await runtime.prepareForPage()),
    ensureVisualLayout: async (context) => {
      const visual = await ensureManagedBrowserVisualLayout(runtime.context, runtime.page)
      context.log(
        visual.status === 'failed' ? 'warning' : 'debug',
        visual.message,
        visual.status === 'failed' ? 'visual_layout_unstable' : undefined,
        { status: visual.status, drift: visual.drift }
      )
      if (visual.status !== 'failed') return { status: 'ready' }
      return {
        status: 'blocked',
        result: actionRuntimeResult(
          'failed',
          'visual_layout_unstable',
          visual.message,
          { drift: visual.drift }
        )
      }
    }
  })
  const runner = new ActionRunner(host, createK4ActionExecutorRegistry(actionDependencies(runtime, job)), (event) => {
    parentPort.postMessage({ type: 'log', event })
  })

  let summary = await runner.run(job.request, control)
  let sessionState: ScenarioActionWorkerResult['sessionState'] = null
  if (job.session.validateAfterRun && summary.result.status !== 'needs_attention' && summary.result.status !== 'stopped') {
    const after = await runtime.validateAfterTask().catch(() => null)
    if (after) {
      sessionState = after.sessionValidation.state
      latestAccountStatus = after.sessionValidation.accountStatus
      if (after.sessionValidation.state !== 'valid') {
        summary = {
          ...summary,
          result: {
            status: 'needs_attention',
            code: after.sessionValidation.state === 'verification_required' ? 'checkpoint_required' : 'session_needs_login',
            message: withFacebookCheckpointKind(after.sessionValidation.message, after.sessionValidation.checkpointKind)
          },
          finishedAt: Date.now()
        }
      }
    }
  }

  const metadata = runtime.metadata()
  const preparedSession = latestSession as FacebookSessionResult | null
  if (sessionState === null && summary.result.code === 'checkpoint_required') sessionState = 'verification_required'
  if (sessionState === null && summary.result.code === 'session_needs_login') sessionState = 'needs_login'
  if (sessionState === null && preparedSession?.status === 'valid') sessionState = 'valid'
  if (sessionState === null && metadata.sessionValidated) sessionState = 'valid'
  if (latestAccountStatus === null && sessionState === 'valid') latestAccountStatus = 'valid'
  if (latestAccountStatus === null && sessionState === 'needs_login') latestAccountStatus = 'needs_login'
  if (latestAccountStatus === null && sessionState === 'verification_required') {
    latestAccountStatus = await liveAccountStatus(runtime, 'checkpoint_unknown')
  }
  const sessionCookie = metadata.sessionCookie ?? (preparedSession?.status === 'valid' ? preparedSession.cookie : null)
  await runtime.close().catch(() => undefined)
  stoppedRunKeys.delete(job.request.runKey)
  pausedRunKeys.delete(job.request.runKey)
  return {
    summary,
    sessionCookie,
    accountName: metadata.accountName ?? job.sessionAccount.name?.trim() ?? null,
    sessionState,
    ...(latestAccountStatus ? { accountStatus: latestAccountStatus } : {})
  }
}

async function shutdown(): Promise<void> {
  let exitCode = 0
  try {
    await closeManagedPostingBrowser()
    console.info('[PAGE-AUTO browser-close] scenario action worker confirmed browser shutdown')
  } catch (error) {
    exitCode = 1
    console.error(
      '[PAGE-AUTO browser-close] scenario action worker failed to close browser:',
      error instanceof Error ? error.message : String(error)
    )
  }
  setTimeout(() => process.exit(exitCode), 25)
}

parentPort.on('message', (event) => {
  const payload = messagePayload(event) as ScenarioActionWorkerRequestMessage | undefined
  if (!payload || typeof payload !== 'object') return

  if (payload.type === 'pause') {
    pausedRunKeys.add(payload.runKey)
    return
  }
  if (payload.type === 'resume') {
    pausedRunKeys.delete(payload.runKey)
    return
  }
  if (payload.type === 'stop') {
    pausedRunKeys.delete(payload.runKey)
    stoppedRunKeys.add(payload.runKey)
    return
  }
  if (payload.type === 'shutdown') {
    if (shuttingDown) return
    shuttingDown = true
    queue = queue.finally(shutdown)
    return
  }
  if (payload.type !== 'execute' || shuttingDown) return

  queue = queue.then(async () => {
    const result = await execute(payload.job).catch((error): ScenarioActionWorkerResult => ({
      summary: failedSummary(payload.job, 'executor_exception', error instanceof Error ? error.message : String(error)),
      sessionCookie: null,
      accountName: null,
      sessionState: null
    }))
    parentPort.postMessage({ type: 'result', runKey: payload.job.request.runKey, result })
  })
})

parentPort.postMessage({ type: 'ready' })
