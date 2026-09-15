import type { Locator, Page, Response } from 'playwright-core'
import type { AccountStatus } from '../../shared/accounts'
import {
  closeManagedPostingBrowser,
  installManagedBrowserReuse
} from './managedBrowserBridge'
import {
  FacebookCommonRuntime,
  type FacebookCommonStepResult
} from '../facebook/facebookCommonRuntime'
import type { GroupScanRawRecord } from '../scanner/group/groupScanAdapter'
import {
  detectGroupPrivacy,
  extractGroupMemberCount,
  groupIdentityFromHref,
  hasTemporaryGroupRestriction,
  normalizeGroupUrl,
  parseGroupScanQuery,
  scanJobStatusFromFacebookAccess
} from '../scanner/group/groupScanSupport'
import type {
  GroupScanWorkerCommand,
  GroupScanWorkerEvent,
  GroupScanWorkerJob,
  GroupScanWorkerSessionUpdate
} from '../scanner/group/groupScanWorkerContracts'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Group scanner worker phải chạy dưới Electron utilityProcess.')

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

function post(event: GroupScanWorkerEvent): void {
  parentPort.postMessage(event)
}

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

function sessionUpdate(runtime: FacebookCommonRuntime, accountStatus: AccountStatus | null): GroupScanWorkerSessionUpdate {
  const metadata = runtime.metadata()
  return {
    sessionCookie: metadata.sessionCookie,
    accountName: metadata.accountName,
    accountStatus
  }
}

async function accountStatusAfterPreparation(
  result: FacebookCommonStepResult
): Promise<AccountStatus | null> {
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
    if (!response && page.url() === 'about:blank') return { kind: 'failed', response: null }
    return { kind: 'ok', response }
  }
  return { kind: 'rate_limited', response: null }
}

async function accessFailure(runtime: FacebookCommonRuntime, context: string): Promise<FacebookCommonStepResult | null> {
  const state = await runtime.checkAccessBlock(context)
  return state.status === 'success' ? null : state
}

async function candidateContainer(link: Locator): Promise<Locator | null> {
  const article = link.locator('xpath=ancestor::*[@role="article"][1]')
  if (await article.count().catch(() => 0)) return article
  const card = link.locator('xpath=ancestor::div[.//a[contains(@href,"/groups/")]][1]')
  return await card.count().catch(() => 0) ? card : null
}

async function rawRecordFromLink(link: Locator, source: GroupScanRawRecord['source']): Promise<GroupScanRawRecord | null> {
  const href = await link.getAttribute('href').catch(() => null)
  const identity = href ? groupIdentityFromHref(href) : null
  if (!identity) return null
  const container = await candidateContainer(link)
  const rawText = ((container ? await container.innerText().catch(() => '') : await link.innerText().catch(() => '')) || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4_000)
  const displayName = (await link.innerText().catch(() => '')).replace(/\s+/g, ' ').trim() || identity
  return {
    entityId: identity,
    displayName,
    url: normalizeGroupUrl(identity),
    members: extractGroupMemberCount(rawText),
    privacy: detectGroupPrivacy(rawText),
    rawText,
    source
  }
}

async function directRecord(page: Page, identity: string): Promise<GroupScanRawRecord> {
  const links = page.locator('a[href*="/groups/"]')
  const count = await links.count().catch(() => 0)
  let displayName = identity
  let rawText = ''
  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index)
    const href = await link.getAttribute('href').catch(() => null)
    if (!href || groupIdentityFromHref(href)?.toLocaleLowerCase() !== identity.toLocaleLowerCase()) continue
    const text = (await link.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    if (text) displayName = text
    const container = await candidateContainer(link)
    rawText = ((container ? await container.innerText().catch(() => '') : text) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4_000)
    if (rawText) break
  }
  if (!rawText) {
    rawText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 12_000)
  }
  return {
    entityId: identity,
    displayName,
    url: normalizeGroupUrl(identity),
    members: extractGroupMemberCount(rawText),
    privacy: detectGroupPrivacy(rawText),
    rawText,
    source: 'group_uid'
  }
}

async function scanDirect(runtime: FacebookCommonRuntime, job: GroupScanWorkerJob, targets: string[]): Promise<void> {
  let emitted = 0
  for (const identity of targets) {
    if (emitted >= job.limit || !await waitIfPaused(job.runKey)) return
    const nav = await navigateWithBackoff(runtime.page, normalizeGroupUrl(identity), job.runKey, runtime.browser.navigationTimeoutMs)
    if (nav.kind === 'rate_limited') {
      post({
        type: 'record',
        runKey: job.runKey,
        record: { entityId: identity, displayName: identity, url: normalizeGroupUrl(identity), members: null, privacy: null, rawText: '', source: 'group_uid', status: 'rate_limited' }
      })
      emitted += 1
      continue
    }
    if (nav.kind === 'permission_limited' || nav.kind === 'not_found') {
      post({
        type: 'record',
        runKey: job.runKey,
        record: { entityId: identity, displayName: identity, url: normalizeGroupUrl(identity), members: null, privacy: null, rawText: '', source: 'group_uid', status: nav.kind }
      })
      emitted += 1
      continue
    }
    if (nav.kind === 'failed') {
      post({
        type: 'record',
        runKey: job.runKey,
        record: { entityId: identity, displayName: identity, url: normalizeGroupUrl(identity), members: null, privacy: null, rawText: '', source: 'group_uid', status: 'failed' }
      })
      emitted += 1
      continue
    }

    const blocked = await accessFailure(runtime, 'khi Quét Nhóm theo Group UID')
    if (blocked) throw blocked
    const bodyText = await runtime.page.locator('body').innerText().catch(() => '')
    if (hasTemporaryGroupRestriction(bodyText)) {
      post({
        type: 'record',
        runKey: job.runKey,
        record: { entityId: identity, displayName: identity, url: normalizeGroupUrl(identity), members: null, privacy: null, rawText: '', source: 'group_uid', status: 'rate_limited' }
      })
      emitted += 1
      continue
    }

    post({ type: 'record', runKey: job.runKey, record: await directRecord(runtime.page, identity) })
    emitted += 1
  }
}

async function scanKeyword(runtime: FacebookCommonRuntime, job: GroupScanWorkerJob, keyword: string): Promise<void> {
  if (!keyword) throw new Error('Hãy nhập từ khóa hoặc Group UID/URL để quét.')
  const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(keyword)}`
  const nav = await navigateWithBackoff(runtime.page, searchUrl, job.runKey, runtime.browser.navigationTimeoutMs)
  if (nav.kind === 'rate_limited') throw new Error('Facebook đang rate-limit nguồn tìm kiếm Group sau các lần backoff có giới hạn.')
  if (nav.kind === 'permission_limited') throw new Error('Account hiện không có quyền truy cập nguồn tìm kiếm Group.')
  if (nav.kind === 'failed' || nav.kind === 'not_found') throw new Error('Không mở được nguồn tìm kiếm Group trên Facebook.')

  const blocked = await accessFailure(runtime, 'khi mở tìm kiếm Group')
  if (blocked) throw blocked

  const seen = new Set<string>()
  let idleRounds = 0
  const maxRounds = Math.min(80, Math.max(14, Math.ceil(job.limit / 5) + 8))

  for (let round = 0; round < maxRounds && seen.size < job.limit; round += 1) {
    if (!await waitIfPaused(job.runKey)) return
    const bodyText = await runtime.page.locator('body').innerText().catch(() => '')
    if (hasTemporaryGroupRestriction(bodyText)) {
      throw new Error('Facebook đang tạm hạn chế thao tác/tìm kiếm Group; phiên quét dừng để không tiếp tục ép request.')
    }

    const links = runtime.page.locator('a[href*="/groups/"]')
    const count = await links.count().catch(() => 0)
    let newRecords = 0
    for (let index = 0; index < count && seen.size < job.limit; index += 1) {
      if (!await waitIfPaused(job.runKey)) return
      const record = await rawRecordFromLink(links.nth(index), 'keyword_search')
      if (!record) continue
      const key = record.entityId.toLocaleLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      newRecords += 1
      post({ type: 'record', runKey: job.runKey, record })
    }

    idleRounds = newRecords === 0 ? idleRounds + 1 : 0
    if (idleRounds >= 3 || seen.size >= job.limit) return
    await runtime.page.mouse.wheel(0, 1600).catch(() => undefined)
    if (!await sleepWithControl(job.runKey, 900)) return
    const afterScrollBlock = await accessFailure(runtime, 'trong lúc phân trang/scroll tìm Group')
    if (afterScrollBlock) throw afterScrollBlock
  }
}

async function execute(job: GroupScanWorkerJob): Promise<void> {
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

    const mode = parseGroupScanQuery(job.query)
    try {
      if (mode.kind === 'direct') await scanDirect(runtime, job, mode.targets)
      else await scanKeyword(runtime, job, mode.keyword)
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
      const needsAttention = /rate-limit|tạm hạn chế|quyền truy cập/i.test(message)
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
  try {
    await closeManagedPostingBrowser()
  } catch {
    exitCode = 1
  }
  setTimeout(() => process.exit(exitCode), 25)
}

parentPort.on('message', (event) => {
  const payload = messagePayload(event) as GroupScanWorkerCommand | undefined
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
  if (payload.type !== 'start' || shuttingDown) return

  queue = queue.then(async () => {
    await execute(payload.job).catch((error) => {
      post({
        type: 'terminal',
        runKey: payload.job.runKey,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        sessionCookie: null,
        accountName: null,
        accountStatus: null
      })
    })
  })
})

post({ type: 'ready' })