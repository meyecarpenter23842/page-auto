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
import type { PageScanRawRecord } from '../scanner/page/pageScanAdapter'
import {
  extractPageFollowerCount,
  extractPageLikeCount,
  hasTemporaryPageRestriction,
  normalizePageUrl,
  pageUidFromHref,
  pageUsernameFromHref,
  parsePageScanQuery,
  scanJobStatusFromFacebookAccess,
  type PageDirectTarget
} from '../scanner/page/pageScanSupport'
import type {
  PageScanWorkerCommand,
  PageScanWorkerEvent,
  PageScanWorkerJob,
  PageScanWorkerSessionUpdate
} from '../scanner/page/pageScanWorkerContracts'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Page scanner worker phải chạy dưới Electron utilityProcess.')

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

function post(event: PageScanWorkerEvent): void {
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

function sessionUpdate(runtime: FacebookCommonRuntime, accountStatus: AccountStatus | null): PageScanWorkerSessionUpdate {
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
    if (!response && page.url() === 'about:blank') return { kind: 'failed', response: null }
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
    const text = (await item.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    if (text) return text
  }
  return null
}

async function candidateContainer(link: Locator): Promise<Locator | null> {
  const article = link.locator('xpath=ancestor::*[@role="article"][1]')
  if (await article.count().catch(() => 0)) return article
  const card = link.locator('xpath=ancestor::div[.//a[@href]][1]')
  return await card.count().catch(() => 0) ? card : null
}

async function categoryFromRoot(root: Locator): Promise<string | null> {
  return firstVisibleText(root.locator('a[href*="/pages/category/"]'))
}

function uidFromAppLink(value: string | null): string | null {
  if (!value) return null
  const match = value.match(/(?:fb:\/\/(?:page|profile)\/?(?:\?id=)?|(?:page|profile)\/)(\d+)/i)
  return match?.[1] ?? null
}

async function verifiedPageUid(page: Page): Promise<string | null> {
  const direct = pageUidFromHref(page.url())
  if (direct) return direct
  const appLinks = page.locator('meta[property="al:android:url"], meta[property="al:ios:url"]')
  const count = await appLinks.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const uid = uidFromAppLink(await appLinks.nth(index).getAttribute('content').catch(() => null))
    if (uid) return uid
  }
  return null
}

async function canonicalPageUrl(page: Page): Promise<string | null> {
  const og = await page.locator('meta[property="og:url"]').first().getAttribute('content').catch(() => null)
  return normalizePageUrl(og ?? page.url())
}

async function pageDisplayName(page: Page, fallback: string): Promise<string> {
  const h1 = await firstVisibleText(page.locator('h1'))
  if (h1) return h1
  const title = (await page.title().catch(() => '')).replace(/\s*\|\s*Facebook\s*$/i, '').trim()
  return title || fallback
}

async function keywordRecordFromLink(link: Locator): Promise<PageScanRawRecord | null> {
  const href = await link.getAttribute('href').catch(() => null)
  const uid = href ? pageUidFromHref(href) : null
  if (!uid) return null
  const url = normalizePageUrl(href ?? uid) ?? `https://www.facebook.com/${uid}/`
  const container = await candidateContainer(link)
  const rawText = ((container ? await container.innerText().catch(() => '') : await link.innerText().catch(() => '')) || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4_000)
  const displayName = (await link.innerText().catch(() => '')).replace(/\s+/g, ' ').trim() || uid
  return {
    entityId: uid,
    displayName,
    url,
    username: pageUsernameFromHref(href ?? ''),
    category: container ? await categoryFromRoot(container) : null,
    followers: extractPageFollowerCount(rawText),
    likes: extractPageLikeCount(rawText),
    location: null,
    rawText,
    source: 'keyword_search'
  }
}

function failureRecord(uid: string, url: string, status: NonNullable<PageScanRawRecord['status']>): PageScanRawRecord {
  return {
    entityId: uid,
    displayName: uid,
    url,
    username: null,
    category: null,
    followers: null,
    likes: null,
    location: null,
    rawText: '',
    source: 'page_uid_or_url',
    status
  }
}

async function directRecord(page: Page, target: PageDirectTarget): Promise<PageScanRawRecord> {
  const uid = target.uid ?? await verifiedPageUid(page)
  if (!uid) {
    throw new Error('Không xác minh được Page UID số từ URL Page này; Scanner không dùng username/slug thay cho Page UID.')
  }
  const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 12_000)
  const url = await canonicalPageUrl(page) ?? target.url
  return {
    entityId: uid,
    displayName: await pageDisplayName(page, uid),
    url,
    username: pageUsernameFromHref(url),
    category: await categoryFromRoot(page.locator('body')),
    followers: extractPageFollowerCount(bodyText),
    likes: extractPageLikeCount(bodyText),
    location: null,
    rawText: bodyText,
    source: 'page_uid_or_url'
  }
}

async function scanDirect(runtime: FacebookCommonRuntime, job: PageScanWorkerJob, targets: PageDirectTarget[]): Promise<void> {
  let emitted = 0
  for (const target of targets) {
    if (emitted >= job.limit || !await waitIfPaused(job.runKey)) return
    const nav = await navigateWithBackoff(runtime.page, target.url, job.runKey, runtime.browser.navigationTimeoutMs)
    if (nav.kind !== 'ok') {
      if (!target.uid) {
        throw new Error(`Không thể xác minh Page UID từ URL trực tiếp vì navigation trả về ${nav.kind}.`)
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

    const blocked = await accessFailure(runtime, 'khi Quét Page theo UID/URL')
    if (blocked) throw blocked
    const bodyText = await runtime.page.locator('body').innerText().catch(() => '')
    if (hasTemporaryPageRestriction(bodyText)) {
      if (target.uid) {
        post({ type: 'record', runKey: job.runKey, record: failureRecord(target.uid, target.url, 'rate_limited') })
        emitted += 1
        continue
      }
      throw new Error('Facebook đang tạm hạn chế thao tác/tìm kiếm Page; phiên quét dừng để không tiếp tục ép request.')
    }

    post({ type: 'record', runKey: job.runKey, record: await directRecord(runtime.page, target) })
    emitted += 1
  }
}

async function scanKeyword(runtime: FacebookCommonRuntime, job: PageScanWorkerJob, keyword: string): Promise<void> {
  if (!keyword) throw new Error('Hãy nhập từ khóa hoặc Page UID/URL để quét.')
  const searchUrl = `https://www.facebook.com/search/pages/?q=${encodeURIComponent(keyword)}`
  const nav = await navigateWithBackoff(runtime.page, searchUrl, job.runKey, runtime.browser.navigationTimeoutMs)
  if (nav.kind === 'rate_limited') throw new Error('Facebook đang rate-limit nguồn tìm kiếm Page sau các lần backoff có giới hạn.')
  if (nav.kind === 'permission_limited') throw new Error('Account hiện không có quyền truy cập nguồn tìm kiếm Page.')
  if (nav.kind === 'failed' || nav.kind === 'not_found') throw new Error('Không mở được nguồn tìm kiếm Page trên Facebook.')

  const blocked = await accessFailure(runtime, 'khi mở tìm kiếm Page')
  if (blocked) throw blocked

  const seen = new Set<string>()
  let idleRounds = 0
  const maxRounds = Math.min(80, Math.max(14, Math.ceil(job.limit / 5) + 8))

  for (let round = 0; round < maxRounds && seen.size < job.limit; round += 1) {
    if (!await waitIfPaused(job.runKey)) return
    const bodyText = await runtime.page.locator('body').innerText().catch(() => '')
    if (hasTemporaryPageRestriction(bodyText)) {
      throw new Error('Facebook đang tạm hạn chế thao tác/tìm kiếm Page; phiên quét dừng để không tiếp tục ép request.')
    }

    const root = runtime.page.locator('[role="main"], main').first()
    const links = (await root.count().catch(() => 0)) > 0 ? root.locator('a[href]') : runtime.page.locator('a[href]')
    const count = await links.count().catch(() => 0)
    let newRecords = 0
    for (let index = 0; index < count && seen.size < job.limit; index += 1) {
      if (!await waitIfPaused(job.runKey)) return
      const record = await keywordRecordFromLink(links.nth(index))
      if (!record || seen.has(record.entityId)) continue
      seen.add(record.entityId)
      newRecords += 1
      post({ type: 'record', runKey: job.runKey, record })
    }

    idleRounds = newRecords === 0 ? idleRounds + 1 : 0
    if (idleRounds >= 3 || seen.size >= job.limit) return
    await runtime.page.mouse.wheel(0, 1600).catch(() => undefined)
    if (!await sleepWithControl(job.runKey, 900)) return
    const afterScrollBlock = await accessFailure(runtime, 'trong lúc phân trang/scroll tìm Page')
    if (afterScrollBlock) throw afterScrollBlock
  }
}

async function execute(job: PageScanWorkerJob): Promise<void> {
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

    const mode = parsePageScanQuery(job.query)
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
      const needsAttention = /rate-limit|tạm hạn chế|quyền truy cập|không xác minh được Page UID/i.test(message)
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
  const payload = messagePayload(event) as PageScanWorkerCommand | undefined
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
    stoppedRunKeys.add(payload.runKey)
    pausedRunKeys.delete(payload.runKey)
    return
  }
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