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
import {
  extractGroupMemberCount,
  hasTemporaryGroupRestriction,
  scanJobStatusFromFacebookAccess
} from '../scanner/group/groupScanSupport'
import type { GroupMembersScanRawRecord } from '../scanner/groupMembers/groupMembersScanAdapter'
import {
  groupIdFromFacebookUrl,
  groupMemberIdentityFromHref,
  hasGroupMembersPermissionBlock,
  normalizeGroupMemberName,
  userProfileUrlFromUid,
  type GroupMembersTarget
} from '../scanner/groupMembers/groupMembersScanSupport'
import type {
  GroupMembersScanWorkerCommand,
  GroupMembersScanWorkerEvent,
  GroupMembersScanWorkerJob,
  GroupMembersScanWorkerSessionUpdate
} from '../scanner/groupMembers/groupMembersScanWorkerContracts'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Group Members scanner worker phải chạy dưới Electron utilityProcess.')

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

function post(event: GroupMembersScanWorkerEvent): void { parentPort.postMessage(event) }

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

function sessionUpdate(runtime: FacebookCommonRuntime, accountStatus: AccountStatus | null): GroupMembersScanWorkerSessionUpdate {
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

function absoluteFacebookUrl(href: string): string | null {
  try { return new URL(href, 'https://www.facebook.com/').toString() } catch { return null }
}

async function memberLinkScope(page: Page): Promise<Locator> {
  const main = page.locator('[role="main"], main').first()
  return (await main.count().catch(() => 0)) > 0 ? main : page.locator('body')
}

async function canonicalGroupIdFromPage(page: Page): Promise<string | null> {
  const candidates = [
    await page.locator('meta[property="og:url"]').first().getAttribute('content').catch(() => null),
    await page.locator('link[rel="canonical"]').first().getAttribute('href').catch(() => null),
    page.url()
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const groupId = groupIdFromFacebookUrl(candidate)
    if (groupId && /^\d+$/.test(groupId)) return groupId
  }

  const root = await memberLinkScope(page)
  const links = root.locator('a[href*="/groups/"][href*="/user/"]')
  const count = await links.count().catch(() => 0)
  const groupIds = new Set<string>()
  for (let index = 0; index < Math.min(count, 250); index += 1) {
    const href = await links.nth(index).getAttribute('href').catch(() => null)
    if (!href) continue
    const identity = groupMemberIdentityFromHref(href)
    if (!identity || !/^\d+$/.test(identity.groupId)) continue
    groupIds.add(identity.groupId)
    if (groupIds.size > 1) return null
  }
  return groupIds.size === 1 ? [...groupIds][0] ?? null : null
}

async function collectMemberRecords(page: Page, expectedGroupId: string): Promise<GroupMembersScanRawRecord[]> {
  const root = await memberLinkScope(page)
  const links = root.locator('a[href*="/groups/"][href*="/user/"]')
  const count = await links.count().catch(() => 0)
  const records = new Map<string, GroupMembersScanRawRecord>()

  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index)
    const href = await link.getAttribute('href').catch(() => null)
    if (!href) continue
    const identity = groupMemberIdentityFromHref(href, expectedGroupId)
    if (!identity) continue

    const text = await link.innerText().catch(() => '')
    const displayName = normalizeGroupMemberName(text, identity.memberUid)
    const existing = records.get(identity.memberUid)
    if (existing) {
      if (existing.displayName === existing.entityId && displayName !== identity.memberUid) {
        existing.displayName = displayName
      }
      continue
    }

    records.set(identity.memberUid, {
      entityId: identity.memberUid,
      displayName,
      url: userProfileUrlFromUid(identity.memberUid),
      sourceGroupId: identity.groupId,
      sourceUrl: absoluteFacebookUrl(href),
      username: null,
      location: null,
      role: null
    })
  }

  return [...records.values()]
}

async function scanGroup(
  runtime: FacebookCommonRuntime,
  job: GroupMembersScanWorkerJob,
  target: GroupMembersTarget,
  seenMemberUids: Set<string>,
  issues: string[]
): Promise<void> {
  const nav = await navigateWithBackoff(runtime.page, target.membersUrl, job.runKey, runtime.browser.navigationTimeoutMs)
  if (nav.kind === 'rate_limited') {
    throw new Error(`Facebook đang rate-limit khi mở danh sách thành viên Group ${target.groupId}.`)
  }
  if (nav.kind === 'permission_limited' || nav.kind === 'not_found' || nav.kind === 'failed') {
    issues.push(`Group ${target.groupId}: ${nav.kind}.`)
    return
  }

  const blocked = await accessFailure(runtime, `khi mở Thành viên nhóm ${target.groupId}`)
  if (blocked) throw blocked

  let bodyText = await runtime.page.locator('body').innerText().catch(() => '')
  if (hasTemporaryGroupRestriction(bodyText)) {
    throw new Error('Facebook đang tạm hạn chế thao tác khi quét Thành viên nhóm; phiên quét dừng để không tiếp tục ép request.')
  }
  if (hasGroupMembersPermissionBlock(bodyText)) {
    issues.push(`Group ${target.groupId}: account không có quyền xem danh sách thành viên.`)
    return
  }

  const canonicalGroupId = await canonicalGroupIdFromPage(runtime.page)
  if (!canonicalGroupId) {
    issues.push(`Group ${target.groupId}: không xác minh được Group UID canonical sau navigation.`)
    return
  }
  if (/^\d+$/.test(target.groupId) && canonicalGroupId !== target.groupId) {
    issues.push(`Group ${target.groupId}: Facebook đã tải Group UID ${canonicalGroupId}, không khớp Group yêu cầu.`)
    return
  }

  const expectedMembers = extractGroupMemberCount(bodyText)
  const seenForGroup = new Set<string>()
  let discoveredForGroup = 0
  let idleRounds = 0
  const maxRounds = Math.min(800, Math.max(20, Math.ceil(job.limit / 10) + 12))

  for (let round = 0; round < maxRounds && seenMemberUids.size < job.limit; round += 1) {
    if (!await waitIfPaused(job.runKey)) return
    const records = await collectMemberRecords(runtime.page, canonicalGroupId)
    let newDiscoveries = 0
    for (const record of records) {
      if (seenMemberUids.size >= job.limit || !await waitIfPaused(job.runKey)) return
      if (!seenForGroup.has(record.entityId)) {
        seenForGroup.add(record.entityId)
        discoveredForGroup += 1
        newDiscoveries += 1
      }
      if (seenMemberUids.has(record.entityId)) continue
      seenMemberUids.add(record.entityId)
      post({ type: 'record', runKey: job.runKey, record })
    }

    idleRounds = newDiscoveries === 0 ? idleRounds + 1 : 0
    if (idleRounds >= 4 || seenMemberUids.size >= job.limit) break

    await runtime.page.mouse.wheel(0, 1800).catch(() => undefined)
    if (!await sleepWithControl(job.runKey, 850)) return
    const afterScrollBlock = await accessFailure(runtime, `trong lúc scroll Thành viên nhóm ${target.groupId}`)
    if (afterScrollBlock) throw afterScrollBlock
    bodyText = await runtime.page.locator('body').innerText().catch(() => '')
    if (hasTemporaryGroupRestriction(bodyText)) {
      throw new Error('Facebook đang tạm hạn chế thao tác khi scroll Thành viên nhóm; phiên quét dừng để không tiếp tục ép request.')
    }
    if (hasGroupMembersPermissionBlock(bodyText)) {
      issues.push(`Group ${target.groupId}: quyền xem danh sách thành viên thay đổi trong lúc quét.`)
      break
    }
  }

  if (discoveredForGroup === 0 && (expectedMembers ?? 0) > 0) {
    issues.push(`Group ${target.groupId}: Facebook báo có ${expectedMembers} thành viên nhưng không đọc được link member theo live surface đã audit.`)
  }
}

async function execute(job: GroupMembersScanWorkerJob): Promise<void> {
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
      const seenMemberUids = new Set<string>()
      const issues: string[] = []
      for (const target of job.groups) {
        if (seenMemberUids.size >= job.limit || !await waitIfPaused(job.runKey)) break
        await scanGroup(runtime, job, target, seenMemberUids, issues)
      }
      if (issues.length) {
        throw new Error(`Một số Group cần xử lý: ${issues.slice(0, 5).join(' ')}${issues.length > 5 ? ` (+${issues.length - 5} Group)` : ''}`)
      }
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
      const needsAttention = /rate-limit|tạm hạn chế|quyền xem|cần xử lý|không đọc được link member|không xác minh được Group UID|không khớp Group yêu cầu/i.test(message)
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
  const payload = messagePayload(event) as GroupMembersScanWorkerCommand | undefined
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
