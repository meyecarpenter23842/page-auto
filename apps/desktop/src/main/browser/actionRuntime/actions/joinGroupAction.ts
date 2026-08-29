import type { Locator, Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
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
  configuredGroupTargets,
  findSurfaceJoinButtons,
  groupTextMatchesFilters,
  joinCandidateText,
  normalizeGroupUrl,
  paceJoinGroup,
  submitJoinAttempt,
  type JoinAttemptOutcome,
  type JoinGroupActionDependencies
} from './joinGroupActionSupport'

interface JoinStats {
  attempted: number
  joined: number
  requested: number
  skipped: number
  failed: number
}

function completed(stats: JoinStats): number {
  return stats.joined + stats.requested
}

function recordOutcome(stats: JoinStats, outcome: JoinAttemptOutcome): void {
  if (outcome === 'joined') stats.joined += 1
  else if (outcome === 'requested') stats.requested += 1
  else if (outcome === 'skipped_approval') stats.skipped += 1
  else stats.failed += 1
}

async function navigate(page: Page, url: string, timeoutMs: number): Promise<boolean> {
  return page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false)
}

async function runJoinButton(
  page: Page,
  button: Locator,
  context: ActionExecutorContext,
  config: ActionConfig,
  target: number,
  stats: JoinStats,
  dependencies: JoinGroupActionDependencies
): Promise<boolean> {
  const text = await joinCandidateText(button)
  if (!groupTextMatchesFilters(text, config)) {
    stats.skipped += 1
    return true
  }

  const previousAttempted = stats.attempted
  stats.attempted += 1
  const outcome = await submitJoinAttempt(page, button, context, config, dependencies)
  recordOutcome(stats, outcome)

  if (context.control.isStopped() || !canAttemptAnotherJoin(stats.attempted, target)) {
    return !context.control.isStopped()
  }

  return paceJoinGroup(context, config, previousAttempted, stats.attempted)
}

async function joinFromIdList(
  page: Page,
  context: ActionExecutorContext,
  config: ActionConfig,
  target: number,
  timeoutMs: number,
  stats: JoinStats,
  dependencies: JoinGroupActionDependencies
): Promise<void> {
  for (const group of configuredGroupTargets(config)) {
    if (!canAttemptAnotherJoin(stats.attempted, target) || context.control.isStopped()) return
    await context.control.waitIfPaused()
    if (context.control.isStopped()) return

    if (!await navigate(page, normalizeGroupUrl(group), timeoutMs)) {
      stats.failed += 1
      continue
    }

    const pageText = await page.locator('body').innerText().catch(() => '')
    if (!groupTextMatchesFilters(pageText, config)) {
      stats.skipped += 1
      continue
    }

    const buttons = await findSurfaceJoinButtons(page)
    if (!buttons) {
      stats.skipped += 1
      continue
    }

    const count = await buttons.count().catch(() => 0)
    let handled = false
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index)
      if (!await button.isVisible().catch(() => false)) continue
      handled = true
      if (!await runJoinButton(page, button, context, config, target, stats, dependencies)) return
      break
    }
    if (!handled) stats.skipped += 1
  }
}

async function joinFromDiscoverySurface(
  page: Page,
  context: ActionExecutorContext,
  config: ActionConfig,
  target: number,
  stats: JoinStats,
  dependencies: JoinGroupActionDependencies
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

      if (!await runJoinButton(page, button, context, config, target, stats, dependencies)) return
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
    const stats: JoinStats = { attempted: 0, joined: 0, requested: 0, skipped: 0, failed: 0 }

    if (mode === 'id_list') {
      await joinFromIdList(page, context, config, target, timeoutMs, stats, this.dependencies)
      return resultFromStats(stats, target, mode, context.control.isStopped())
    }

    const url = mode === 'keyword'
      ? `https://www.facebook.com/search/groups/?q=${encodeURIComponent(configString(config, 'keyword').trim())}`
      : 'https://www.facebook.com/groups/discover/'

    if (!await navigate(page, url, timeoutMs)) {
      return navigationFailed('Tham gia nhóm', new Error(`Không mở được nguồn ${mode}.`))
    }

    await joinFromDiscoverySurface(page, context, config, target, stats, this.dependencies)
    return resultFromStats(stats, target, mode, context.control.isStopped())
  }
}
