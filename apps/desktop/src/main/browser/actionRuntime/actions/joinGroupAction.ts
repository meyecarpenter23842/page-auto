import type { Locator, Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import { ACTION_VERIFICATION_UNCERTAIN_CODE } from '../../../../shared/actionRuntime'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { ensureManagedBrowserVisualLayout } from '../../managedBrowserBridge'
import { verifyActionWithTargetRevisit, type ActionVerificationPhase } from '../actionVerification'
import {
  browserUnavailable,
  configNumber,
  configString,
  navigationFailed,
  pickRange,
  sleepWithControl
} from './actionSupport'
import {
  canAttemptAnotherJoin,
  candidateGroupIdentity,
  configuredGroupTargets,
  directGroupMembershipState,
  findSurfaceJoinButtons,
  groupIdentityFromHref,
  groupTextMatchesFilters,
  isDirectGroupPageUrl,
  joinButtonBelongsToDirectGroup,
  joinCandidateText,
  normalizeGroupUrl,
  paceJoinGroup,
  pauseAfterJoinOutcome,
  submitJoinAttempt,
  type DirectGroupMembershipState,
  type JoinAttemptOutcome,
  type JoinGroupActionDependencies
} from './joinGroupActionSupport'

interface JoinStats {
  attempted: number
  joined: number
  requested: number
  skipped: number
  failed: number
  uncertain: number
}

interface VerifiedJoinAttempt {
  outcome: JoinAttemptOutcome
  phase: ActionVerificationPhase | null
}

function completed(stats: JoinStats): number {
  return stats.joined + stats.requested
}

function recordOutcome(stats: JoinStats, outcome: JoinAttemptOutcome): void {
  if (outcome === 'joined') stats.joined += 1
  else if (outcome === 'requested') stats.requested += 1
  else if (outcome === 'skipped_approval') stats.skipped += 1
  else stats.uncertain += 1
}

async function navigate(page: Page, url: string, timeoutMs: number): Promise<boolean> {
  return page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false)
}

async function stabilizeJoinVerification(
  page: Page,
  context: ActionExecutorContext
): Promise<boolean> {
  const visual = await ensureManagedBrowserVisualLayout(page.context(), page).catch(() => null)
  if (!visual || visual.status === 'failed') {
    context.log(
      'warning',
      visual?.message ?? 'Common Visual/Layout Guard không đọc được trạng thái Chrome trước bước xác minh lại.',
      'visual_layout_unstable',
      { status: visual?.status ?? 'unavailable', drift: visual?.drift ?? [] }
    )
    return false
  }

  context.log(
    'debug',
    'Common Visual/Layout Guard đã ổn định layout trước khi mở lại đúng Group đích.',
    'join_group_verify_visual_ready',
    { status: visual.status, drift: visual.drift }
  )
  return true
}

async function revisitExactGroupTarget(
  page: Page,
  context: ActionExecutorContext,
  targetIdentity: string,
  timeoutMs: number
): Promise<boolean> {
  if (context.control.isStopped()) return false
  await context.control.waitIfPaused()
  if (context.control.isStopped()) return false

  context.log(
    'debug',
    'Verify tức thời chưa đủ chắc chắn; mở lại đúng Group đích để kiểm tra trạng thái mà không click Tham gia lần hai.',
    'join_group_verify_revisit',
    { targetIdentity }
  )

  const currentIdentity = groupIdentityFromHref(page.url())
  const revisited = currentIdentity === targetIdentity && isDirectGroupPageUrl(page.url())
    ? await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).then(() => true).catch(() => false)
    : await navigate(page, normalizeGroupUrl(targetIdentity), timeoutMs)
  if (!revisited) return false
  if (!await sleepWithControl(context.control, 700)) return false

  return groupIdentityFromHref(page.url()) === targetIdentity
}

async function verifyJoinAttempt(
  page: Page,
  button: Locator,
  context: ActionExecutorContext,
  config: ActionConfig,
  timeoutMs: number
): Promise<VerifiedJoinAttempt> {
  // Capture the target before clicking: Facebook commonly replaces the Join control after success.
  const targetIdentity = await candidateGroupIdentity(button) ?? groupIdentityFromHref(page.url())
  const immediate = await submitJoinAttempt(page, button, context, config)
  if (immediate === 'skipped_approval') return { outcome: immediate, phase: null }

  const immediateMembership: Exclude<DirectGroupMembershipState, null> | null =
    immediate === 'joined' || immediate === 'requested' ? immediate : null

  const verification = await verifyActionWithTargetRevisit<Exclude<DirectGroupMembershipState, null>>({
    immediate: immediateMembership,
    stabilize: () => stabilizeJoinVerification(page, context),
    revisit: async () => {
      if (!targetIdentity) {
        context.log(
          'warning',
          'Không xác định được Group đích sau thao tác; dừng xác minh để tránh retry mù.',
          'join_group_verify_target_unknown'
        )
        return false
      }
      return revisitExactGroupTarget(page, context, targetIdentity, timeoutMs)
    },
    verifyAfterRevisit: () => directGroupMembershipState(page)
  })

  if (verification.status === 'verified') {
    if (verification.phase === 'revisit') {
      context.log(
        'info',
        verification.value === 'joined'
          ? 'Đã xác minh lại đúng Group đích: Facebook đang hiển thị trạng thái Joined/Đã tham gia.'
          : 'Đã xác minh lại đúng Group đích: yêu cầu tham gia đang Pending/Đang chờ duyệt.',
        'join_group_verify_revisit_success',
        { targetIdentity, membership: verification.value }
      )
    }
    return { outcome: verification.value, phase: verification.phase }
  }

  context.log(
    'warning',
    'Đã thao tác Tham gia nhưng trạng thái Group đích vẫn chưa xác minh chắc chắn; dừng để không lặp thao tác ngoài ý muốn.',
    ACTION_VERIFICATION_UNCERTAIN_CODE,
    { targetIdentity, reason: verification.reason }
  )
  return { outcome: 'unverified', phase: null }
}

async function restoreDiscoverySurfaceAfterRevisit(
  page: Page,
  originUrl: string,
  context: ActionExecutorContext,
  timeoutMs: number
): Promise<boolean> {
  if (isDirectGroupPageUrl(originUrl) || page.url() === originUrl) return true
  context.log('debug', 'Khôi phục surface tìm nhóm sau fallback verify.', 'join_group_restore_source')
  const restored = await navigate(page, originUrl, timeoutMs)
  if (!restored) {
    context.log(
      'warning',
      'Đã xác minh kết quả tham gia nhưng không khôi phục được surface nguồn; dừng lượt để tránh thao tác sai target.',
      'join_group_restore_source_failed'
    )
  }
  return restored
}

async function runJoinButton(
  page: Page,
  button: Locator,
  context: ActionExecutorContext,
  config: ActionConfig,
  target: number,
  timeoutMs: number,
  stats: JoinStats,
  filtersAlreadyValidated = false
): Promise<boolean> {
  if (!filtersAlreadyValidated) {
    const text = await joinCandidateText(button)
    if (!groupTextMatchesFilters(text, config)) {
      stats.skipped += 1
      context.log('debug', 'Bỏ qua ứng viên nhóm vì card hiện tại không đạt bộ lọc K431.', 'join_group_candidate_filtered')
      return true
    }
  }

  const originUrl = page.url()
  const previousAttempted = stats.attempted
  stats.attempted += 1
  const verified = await verifyJoinAttempt(page, button, context, config, timeoutMs)
  recordOutcome(stats, verified.outcome)

  if (!await pauseAfterJoinOutcome(context, config, verified.outcome)) return false
  if (verified.outcome === 'unverified') return false
  if (context.control.isStopped() || !canAttemptAnotherJoin(stats.attempted, target)) {
    return !context.control.isStopped()
  }

  if (verified.phase === 'revisit' && !await restoreDiscoverySurfaceAfterRevisit(page, originUrl, context, timeoutMs)) {
    return false
  }

  return paceJoinGroup(context, config, previousAttempted, stats.attempted)
}

async function joinFromIdList(
  page: Page,
  context: ActionExecutorContext,
  config: ActionConfig,
  target: number,
  timeoutMs: number,
  stats: JoinStats
): Promise<void> {
  for (const group of configuredGroupTargets(config)) {
    if (!canAttemptAnotherJoin(stats.attempted, target) || context.control.isStopped()) return
    await context.control.waitIfPaused()
    if (context.control.isStopped()) return

    if (!await navigate(page, normalizeGroupUrl(group), timeoutMs)) {
      stats.failed += 1
      context.log('warning', 'Không mở được Group ID hiện tại.', 'join_group_navigation_failed')
      continue
    }

    // Direct-ID mode owns the whole Group page, so evaluate configured metadata once on that
    // surface. The Join button itself often contains only “Join group/Tham gia nhóm”; applying
    // member/privacy/location filters to that button text a second time falsely rejects a Group
    // that already passed the page-level filter.
    const pageText = await page.locator('body').innerText().catch(() => '')
    if (!groupTextMatchesFilters(pageText, config)) {
      stats.skipped += 1
      context.log(
        'info',
        'Bỏ qua Group ID hiện tại vì metadata của trang không đạt bộ lọc K431.',
        'join_group_page_filtered'
      )
      continue
    }

    const existingMembership = await directGroupMembershipState(page)
    if (existingMembership) {
      stats.skipped += 1
      context.log(
        'info',
        existingMembership === 'joined'
          ? 'Bỏ qua Group ID hiện tại vì account đã là thành viên của Group đích.'
          : 'Bỏ qua Group ID hiện tại vì yêu cầu tham gia Group đích đang chờ duyệt.',
        existingMembership === 'joined'
          ? 'join_group_target_already_joined'
          : 'join_group_target_already_pending'
      )
      continue
    }

    const buttons = await findSurfaceJoinButtons(page)
    if (!buttons) {
      stats.skipped += 1
      context.log(
        'warning',
        'Group ID đã đạt bộ lọc nhưng không tìm thấy nút Tham gia trên DOM hiện tại.',
        'join_group_button_not_found'
      )
      continue
    }

    const count = await buttons.count().catch(() => 0)
    let handled = false
    let sawRelatedGroupButton = false
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index)
      if (!await button.isVisible().catch(() => false)) continue
      if (!await joinButtonBelongsToDirectGroup(page, button)) {
        sawRelatedGroupButton = true
        continue
      }
      handled = true
      context.log('debug', 'Group ID đạt bộ lọc; bắt đầu thao tác Tham gia.', 'join_group_attempt_start')
      if (!await runJoinButton(page, button, context, config, target, timeoutMs, stats, true)) return
      break
    }
    if (!handled) {
      stats.skipped += 1
      context.log(
        sawRelatedGroupButton ? 'info' : 'warning',
        sawRelatedGroupButton
          ? 'Không tìm thấy nút Tham gia của Group đích; đã bỏ qua các nút Tham gia thuộc Related groups.'
          : 'Có locator nút Tham gia nhưng không có nút nào đang hiển thị.',
        sawRelatedGroupButton ? 'join_group_only_related_buttons' : 'join_group_button_not_visible'
      )
    }
  }
}

async function joinFromDiscoverySurface(
  page: Page,
  context: ActionExecutorContext,
  config: ActionConfig,
  target: number,
  timeoutMs: number,
  stats: JoinStats
): Promise<void> {
  const seen = new Set<string>()
  let idleRounds = 0

  for (let round = 0; round < 14 && canAttemptAnotherJoin(stats.attempted, target); round += 1) {
    if (context.control.isStopped()) return
    await context.control.waitIfPaused()

    const buttons = await findSurfaceJoinButtons(page)
    const count = await buttons?.count().catch(() => 0) ?? 0
    let newCandidates = 0

    for (let index = 0; index < count && canAttemptAnotherJoin(stats.attempted, target); index += 1) {
      if (context.control.isStopped()) return
      const button = buttons!.nth(index)
      if (!await button.isVisible().catch(() => false)) continue

      const text = (await joinCandidateText(button)).replace(/\s+/g, ' ').trim()
      const signature = text.slice(0, 500)
      if (signature && seen.has(signature)) continue
      if (signature) seen.add(signature)
      newCandidates += 1

      if (!await runJoinButton(page, button, context, config, target, timeoutMs, stats)) return
    }

    if (newCandidates === 0) idleRounds += 1
    else idleRounds = 0
    if (idleRounds >= 3 || !canAttemptAnotherJoin(stats.attempted, target)) return

    await page.mouse.wheel(0, 1600).catch(() => undefined)
    if (!await sleepWithControl(context.control, 900)) return
  }
}

function resultFromStats(
  stats: JoinStats,
  target: number,
  mode: string,
  stopped: boolean
): ActionResult {
  const data = { ...stats, completed: completed(stats), target, mode }
  if (stopped) {
    return { status: 'stopped', code: 'action_stopped', message: 'Tham gia nhóm đã dừng.', data }
  }
  if (stats.uncertain > 0) {
    return {
      status: 'failed',
      code: ACTION_VERIFICATION_UNCERTAIN_CODE,
      message: 'Đã thao tác Tham gia nhưng có kết quả chưa xác minh chắc chắn sau fallback đúng Group đích; action dừng để tránh retry mù.',
      data
    }
  }
  if (completed(stats) > 0) {
    return {
      status: 'success',
      code: 'join_group_completed',
      message: `Tham gia nhóm hoàn tất: ${stats.joined} đã vào, ${stats.requested} đã gửi yêu cầu; ${stats.attempted}/${target} lượt đã chạy.`,
      data
    }
  }
  if (stats.failed > 0) {
    return {
      status: 'failed',
      code: 'join_group_no_verified_result',
      message: `Đã chạy ${stats.attempted}/${target} lượt nhưng chưa xác nhận được nhóm nào đã tham gia hoặc đã gửi yêu cầu.`,
      data
    }
  }
  return {
    status: 'skipped',
    code: 'join_group_no_eligible_group',
    message: 'Không có nhóm phù hợp điều kiện để tham gia.',
    data
  }
}

export class JoinGroupActionExecutor implements ActionExecutor {
  readonly actionType = 'join_group'

  constructor(private readonly dependencies: JoinGroupActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Tham gia nhóm')

    const target = pickRange(
      configNumber(config, 'joinMin', 1),
      configNumber(config, 'joinMax', 1)
    )
    const mode = configString(config, 'sourceMode') || 'id_list'
    const timeoutMs = this.dependencies.navigationTimeoutMs ?? 45_000
    const stats: JoinStats = { attempted: 0, joined: 0, requested: 0, skipped: 0, failed: 0, uncertain: 0 }

    if (mode === 'id_list') {
      await joinFromIdList(page, context, config, target, timeoutMs, stats)
      return resultFromStats(stats, target, mode, context.control.isStopped())
    }

    const url = mode === 'keyword'
      ? `https://www.facebook.com/search/groups/?q=${encodeURIComponent(configString(config, 'keyword').trim())}`
      : 'https://www.facebook.com/groups/discover/'

    if (!await navigate(page, url, timeoutMs)) {
      return navigationFailed('Tham gia nhóm', new Error(`Không mở được nguồn ${mode}.`))
    }

    await joinFromDiscoverySurface(page, context, config, target, timeoutMs, stats)
    return resultFromStats(stats, target, mode, context.control.isStopped())
  }
}