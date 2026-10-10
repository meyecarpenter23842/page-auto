import type { Locator, Page, Response } from 'playwright-core'
import type { AccountStatus } from '../../shared/accounts'
import {
  closeManagedPostingBrowser,
  installManagedBrowserReuse
} from './managedBrowserBridge'
import { normalizeFacebookProfileName } from './facebookProfileInfo'
import {
  FacebookCommonRuntime,
  type FacebookCommonStepResult
} from '../facebook/facebookCommonRuntime'
import type { UserScanRawRecord } from '../scanner/user/userScanAdapter'
import { requireVerifiedUserUid, userUidFromAppLink } from '../scanner/user/userScanIdentity'
import {
  extractUserFollowerCount,
  hasTemporaryUserRestriction,
  normalizeUserProfileUrl,
  parseUserScanTargets,
  scanJobStatusFromFacebookAccess,
  userUsernameFromHref,
  type UserDirectTarget
} from '../scanner/user/userScanSupport'
import type {
  UserScanWorkerCommand,
  UserScanWorkerEvent,
  UserScanWorkerJob,
  UserScanWorkerSessionUpdate
} from '../scanner/user/userScanWorkerContracts'

const parentPort = process.parentPort
if (!parentPort) throw new Error('User scanner worker phải chạy dưới Electron utilityProcess.')

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

function post(event: UserScanWorkerEvent): void { parentPort.postMessage(event) }

async function waitIfPaused(runKey: string): Promise<boolean> {
  while (pausedRunKeys.has(runKey) && !stoppedRunKeys.has(runKey)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  return !stoppedRunKeys.has(runKey)
}

async function sleepWithControl(runKey: string, delayMs: number): Promise<boolean> {
  let remaining = Math.max(0, delayMs)
  while (remaining > 0 && !stoppedRunKeys.has(runKey)) {
    if (!await waitIfPaused(runKey)) return false
    const chunk = Math.min(100, remaining)
    await new Promise<void>((resolve) => setTimeout(resolve, chunk))
    remaining -= chunk
  }
  return !stoppedRunKeys.has(runKey)
}

function sessionUpdate(runtime: FacebookCommonRuntime, accountStatus: AccountStatus | null): UserScanWorkerSessionUpdate {
  const metadata = runtime.metadata()
  return {
    sessionCookie: metadata.sessionCookie,
    accountName: metadata.accountName,
    accountStatus
  }
}

async function accountStatusAfterPreparation(result: FacebookCommonStepResult): Promise<AccountStatus | null> {
  if (result.status === 'success') return 'valid'
  return result.sessionValidation?.accountStatus ?? (result.status === 'needs_login' ? 'needs_login' : null)
}

interface NavigationOutcome {
  kind: 'ok' | 'not_found' | 'permission_limited' | 'rate_limited' | 'failed'
  response: Response | null
}

async function navigateWithBackoff(page: Page, url: string, runKey: string, timeoutMs: number): Promise<NavigationOutcome> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!await waitIfPaused(runKey)) return { kind: 'failed', response: null }
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => null)
    const status = response?.status() ?? null
    if (status === 429) {
      if (attempt < 2 && await sleepWithControl(runKey, 1_000 * (2 ** attempt))) continue
      return { kind: 'rate_limited', response }
    }
    if (status === 403) return { kind: 'permission_limited', response }
    if (status === 404) return { kind: 'not_found', response }
    if (!response) {
      if (attempt < 2 && await sleepWithControl(runKey, 500 * (2 ** attempt))) continue
      return { kind: 'failed', response: null }
    }
    return { kind: 'ok', response }
  }
  return { kind: 'rate_limited', response: null }
}

async function accessFailure(runtime: FacebookCommonRuntime, context: string): Promise<FacebookCommonStepResult | null> {
  const state = await runtime.checkAccessBlock(context)
  return state.status === 'success' ? null : state
}

async function firstVisibleText(locator: Locator): Promise<string | null> {
  const count = await locator.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index)
    if (!await item.isVisible().catch(() => false)) continue
    const text = normalizeFacebookProfileName(await item.innerText().catch(() => null))
    if (text) return text
  }
  return null
}

async function verifiedUserUid(page: Page): Promise<string | null> {
  const appLinks = page.locator('meta[property="al:android:url"], meta[property="al:ios:url"]')
  const count = await appLinks.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const uid = userUidFromAppLink(await appLinks.nth(index).getAttribute('content').catch(() => null))
    if (uid) return uid
  }
  return null
}

async function canonicalUserUrl(page: Page): Promise<string | null> {
  const og = await page.locator('meta[property="og:url"]').first().getAttribute('content').catch(() => null)
  return normalizeUserProfileUrl(og ?? page.url())
}

async function userDisplayName(page: Page, fallback: string): Promise<string> {
  const h1 = await firstVisibleText(page.locator('[role="main"] h1, main h1, h1'))
  if (h1) return h1
  const ogTitle = normalizeFacebookProfileName(
    await page.locator('meta[property="og:title"]').first().getAttribute('content').catch(() => null)
  )
  if (ogTitle) return ogTitle
  return normalizeFacebookProfileName(await page.title().catch(() => '')) ?? fallback
}

function failureRecord(uid: string, url: string, status: NonNullable<UserScanRawRecord['status']>): UserScanRawRecord {
  return {
    entityId: uid,
    displayName: uid,
    url,
    username: null,
    location: null,
    gender: null,
    followers: null,
    source: 'profile_uid_or_url',
    status
  }
}

async function directRecord(page: Page, target: UserDirectTarget): Promise<UserScanRawRecord> {
  const uid = requireVerifiedUserUid(target.uid, await verifiedUserUid(page))
  const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 12_000)
  const url = await canonicalUserUrl(page) ?? target.url
  return {
    entityId: uid,
    displayName: await userDisplayName(page, uid),
    url,
    username: userUsernameFromHref(url) ?? target.username,
    location: null,
    gender: null,
    followers: extractUserFollowerCount(bodyText),
    source: 'profile_uid_or_url'
  }
}

async function scanDirect(runtime: FacebookCommonRuntime, job: UserScanWorkerJob, targets: UserDirectTarget[]): Promise<void> {
  let emitted = 0
  for (const target of targets) {
    if (emitted >= job.limit || !await waitIfPaused(job.runKey)) return
    const nav = await navigateWithBackoff(runtime.page, target.url, job.runKey, runtime.browser.navigationTimeoutMs)
    if (nav.kind !== 'ok') {
      if (!target.uid) {
        throw new Error(`Không thể xác minh UID từ URL Profile trực tiếp vì navigation trả về ${nav.kind}.`)
      }
      const status = nav.kind === 'rate_limited'
        ? 'rate_limited'
        : nav.kind === 'permission_limited'
          ? 'permission_limited'
          : nav.kind === 'not_found'
            ? 'not_found'
            : 'failed'
      post({ type: 'record', runKey: job.runKey, record: failureRecord(target.uid, target.url, status) })
      emitted += 1
      continue
    }

    const blocked = await accessFailure(runtime, 'khi Quét Người dùng theo UID/URL Profile')
    if (blocked) throw blocked
    const bodyText = await runtime.page.locator('body').innerText().catch(() => '')
    if (hasTemporaryUserRestriction(bodyText)) {
      if (target.uid) {
        post({ type: 'record', runKey: job.runKey, record: failureRecord(target.uid, target.url, 'rate_limited') })
        emitted += 1
        continue
      }
      throw new Error('Facebook đang tạm hạn chế thao tác Profile; phiên quét dừng để không tiếp tục ép request.')
    }

    post({ type: 'record', runKey: job.runKey, record: await directRecord(runtime.page, target) })
    emitted += 1
  }
}

async function execute(job: UserScanWorkerJob): Promise<void> {
  const opened = await FacebookCommonRuntime.open({
    profileDirectory: job.profileDirectory,
    pageUid: '',
    browser: job.browser,
    session: job.session,
    network: job.network,
    sessionAccount: job.sessionAccount,
    ...(job.userAgent ? { userAgent: job.userAgent } : {}),
    ...(job.proxy ? { proxy: job.proxy } : {})
  })

  if (opened.status === 'failed') {
    post({
      type: 'terminal',
      runKey: job.runKey,
      status: scanJobStatusFromFacebookAccess(opened.result),
      message: opened.result.message,
      sessionCookie: null,
      accountName: null,
      accountStatus: opened.result.sessionValidation?.accountStatus ?? null
    })
    return
  }

  const runtime = opened.runtime
  let preparedStatus: AccountStatus | null = null
  try {
    const prepared = await runtime.prepareForPage()
    preparedStatus = await accountStatusAfterPreparation(prepared)
    if (prepared.status !== 'success') {
      post({
        type: 'terminal',
        runKey: job.runKey,
        status: scanJobStatusFromFacebookAccess(prepared),
        message: prepared.message,
        ...sessionUpdate(runtime, preparedStatus)
      })
      return
    }

    try {
      const targets = parseUserScanTargets(job.query)
      if (!targets.length) throw new Error('Hãy nhập UID hoặc URL Profile để Quét Người dùng.')
      await scanDirect(runtime, job, targets)
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
        const result = error as FacebookCommonStepResult
        post({
          type: 'terminal',
          runKey: job.runKey,
          status: scanJobStatusFromFacebookAccess(result),
          message: result.message,
          ...sessionUpdate(runtime, result.sessionValidation?.accountStatus ?? preparedStatus)
        })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      const needsAttention = /rate-limit|tạm hạn chế|quyền truy cập|Không xác minh được UID|không khớp UID yêu cầu/i.test(message)
      post({
        type: 'terminal',
        runKey: job.runKey,
        status: needsAttention ? 'needs_attention' : 'failed',
        message,
        ...sessionUpdate(runtime, preparedStatus)
      })
      return
    }

    if (stoppedRunKeys.has(job.runKey)) {
      post({ type: 'complete', runKey: job.runKey, ...sessionUpdate(runtime, preparedStatus) })
      return
    }

    let finalStatus = preparedStatus
    if (job.session.validateAfterRun) {
      const after = await runtime.validateAfterTask().catch(() => null)
      if (after) {
        finalStatus = after.sessionValidation.accountStatus
        if (after.sessionValidation.state !== 'valid') {
          post({
            type: 'terminal',
            runKey: job.runKey,
            status: 'needs_attention',
            message: after.sessionValidation.message,
            ...sessionUpdate(runtime, finalStatus)
          })
          return
        }
      }
    }

    post({ type: 'complete', runKey: job.runKey, ...sessionUpdate(runtime, finalStatus ?? 'valid') })
  } finally {
    await runtime.close().catch(() => undefined)
    stoppedRunKeys.delete(job.runKey)
    pausedRunKeys.delete(job.runKey)
  }
}

async function shutdown(): Promise<void> {
  let exitCode = 0
  try { await closeManagedPostingBrowser() } catch { exitCode = 1 }
  setTimeout(() => process.exit(exitCode), 25)
}

parentPort.on('message', (event) => {
  const payload = messagePayload(event) as UserScanWorkerCommand | undefined
  if (!payload || typeof payload !== 'object') return

  if (payload.type === 'pause') { pausedRunKeys.add(payload.runKey); return }
  if (payload.type === 'resume') { pausedRunKeys.delete(payload.runKey); return }
  if (payload.type === 'stop') { stoppedRunKeys.add(payload.runKey); pausedRunKeys.delete(payload.runKey); return }
  if (payload.type === 'shutdown') {
    if (!shuttingDown) {
      shuttingDown = true
      queue = queue.finally(() => shutdown())
    }
    return
  }
  if (payload.type !== 'start' || shuttingDown) return
  stoppedRunKeys.delete(payload.job.runKey)
  pausedRunKeys.delete(payload.job.runKey)
  queue = queue.then(() => execute(payload.job)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    post({
      type: 'terminal',
      runKey: payload.job.runKey,
      status: 'failed',
      message,
      sessionCookie: null,
      accountName: null,
      accountStatus: null
    })
  })
})

post({ type: 'ready' })
