import type { Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import {
  browserUnavailable,
  configNumber,
  pickRange
} from './actionSupport'
import {
  configuredInviteGroupTargets,
  inviteFriendsBatch,
  normalizeInviteGroupUrl,
  paceInviteFriendsBatch,
  type InviteFriendsToGroupActionDependencies
} from './inviteFriendsToGroupActionSupport'

interface InviteStats {
  invited: number
  unverified: number
  batches: number
  exhaustedGroups: number
  failedGroups: number
}

async function navigate(page: Page, url: string, timeoutMs: number): Promise<boolean> {
  return page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false)
}

function resultFromStats(stats: InviteStats, target: number, stopped: boolean): ActionResult {
  const data = { ...stats, target }
  if (stopped) {
    return { status: 'stopped', code: 'action_stopped', message: 'Mời bạn bè vào nhóm đã dừng.', data }
  }
  if (stats.invited > 0) {
    return {
      status: 'success',
      code: 'invite_friends_to_group_completed',
      message: `Mời bạn bè vào nhóm hoàn tất: xác nhận ${stats.invited}/${target} lời mời.`,
      data
    }
  }
  if (stats.unverified > 0 || stats.failedGroups > 0) {
    return {
      status: 'failed',
      code: 'invite_friends_to_group_no_verified_result',
      message: 'Đã thao tác nhưng chưa xác nhận được lời mời nào được gửi thành công.',
      data
    }
  }
  return {
    status: 'skipped',
    code: 'invite_friends_to_group_no_candidates',
    message: 'Không tìm thấy bạn bè có thể mời trong các nhóm đã cấu hình.',
    data
  }
}

export class InviteFriendsToGroupActionExecutor implements ActionExecutor {
  readonly actionType = 'invite_friends_to_group'

  constructor(private readonly dependencies: InviteFriendsToGroupActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Mời bạn bè vào nhóm')

    const groups = configuredInviteGroupTargets(config)
    if (!groups.length) {
      return {
        status: 'failed',
        code: 'invite_friends_to_group_missing_targets',
        message: 'Mời bạn bè vào nhóm: chưa có Group UID/URL để chạy.'
      }
    }

    const target = pickRange(
      configNumber(config, 'inviteMin', 1),
      configNumber(config, 'inviteMax', 1)
    )
    const configuredBatch = Math.max(1, configNumber(config, 'invitePerBatch', 1))
    const timeoutMs = this.dependencies.navigationTimeoutMs ?? 45_000
    const seenByGroup = new Map<string, Set<string>>()
    const exhaustedGroups = new Set<string>()
    const failedGroups = new Set<string>()
    const stats: InviteStats = {
      invited: 0,
      unverified: 0,
      batches: 0,
      exhaustedGroups: 0,
      failedGroups: 0
    }

    const maxRounds = Math.max(2, Math.ceil(target / configuredBatch) + 2)
    for (let round = 0; round < maxRounds && stats.invited < target; round += 1) {
      if (context.control.isStopped()) break
      let roundHadCandidates = false

      for (const group of groups) {
        if (stats.invited >= target || context.control.isStopped()) break
        if (exhaustedGroups.has(group) || failedGroups.has(group)) continue
        await context.control.waitIfPaused()
        if (context.control.isStopped()) break

        if (!await navigate(page, normalizeInviteGroupUrl(group), timeoutMs)) {
          failedGroups.add(group)
          stats.failedGroups = failedGroups.size
          continue
        }

        const remaining = target - stats.invited
        const batchLimit = Math.min(configuredBatch, remaining)
        const seen = seenByGroup.get(group) ?? new Set<string>()
        seenByGroup.set(group, seen)
        const beforeInvited = stats.invited
        const outcome = await inviteFriendsBatch(page, context, batchLimit, seen)
        stats.invited += outcome.invited
        stats.unverified += outcome.unverified
        if (outcome.candidates > 0) roundHadCandidates = true
        if (outcome.exhausted) {
          exhaustedGroups.add(group)
          stats.exhaustedGroups = exhaustedGroups.size
        }

        if (outcome.invited + outcome.unverified > 0) {
          stats.batches += 1
          if (!await paceInviteFriendsBatch(context, config, beforeInvited, stats.invited)) {
            return resultFromStats(stats, target, true)
          }
        }
      }

      if (exhaustedGroups.size + failedGroups.size >= groups.length) break
      if (!roundHadCandidates) break
    }

    return resultFromStats(stats, target, context.control.isStopped())
  }
}
