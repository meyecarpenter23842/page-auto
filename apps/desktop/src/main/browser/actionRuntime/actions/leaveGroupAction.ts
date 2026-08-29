import type { Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import {
  browserUnavailable,
  configNumber,
  configString,
  navigationFailed,
  pickRange,
  splitLines,
  type BaseViewActionDependencies
} from './actionSupport'
import {
  collectJoinedGroupUrls,
  leaveCurrentGroup,
  paceGroupInteraction
} from './groupInteractionActionSupport'
import { groupIdentityFromHref, normalizeGroupUrl } from './joinGroupActionSupport'

export interface LeaveGroupActionDependencies extends BaseViewActionDependencies {}

export interface LeaveGroupStats {
  attempted: number
  groupsVisited: number
  left: number
  skipped: number
  failed: number
}

export function configuredLeaveGroupUrls(config: ActionConfig): string[] {
  const output: string[] = []
  const seen = new Set<string>()
  for (const value of splitLines(configString(config, 'sourceTargets'))) {
    const url = normalizeGroupUrl(value)
    const identity = groupIdentityFromHref(url)?.toLocaleLowerCase()
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    output.push(url)
  }
  return output
}

async function navigate(page: Page, url: string, timeoutMs: number): Promise<boolean> {
  return page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false)
}

function resultFromStats(
  stats: LeaveGroupStats,
  target: number,
  sourceMode: string,
  stopped: boolean
): ActionResult {
  const data = { ...stats, target, sourceMode }
  if (stopped) {
    return { status: 'stopped', code: 'action_stopped', message: 'Rời nhóm đã dừng.', data }
  }
  if (stats.left > 0) {
    return {
      status: 'success',
      code: 'leave_group_completed',
      message: `Rời nhóm hoàn tất: ${stats.left} nhóm; đã mở ${stats.groupsVisited}/${target} nhóm.`,
      data
    }
  }
  if (stats.failed > 0) {
    return {
      status: 'failed',
      code: 'leave_group_no_verified_result',
      message: `Đã mở ${stats.groupsVisited}/${target} nhóm nhưng chưa rời được nhóm nào.`,
      data
    }
  }
  return {
    status: 'skipped',
    code: 'leave_group_no_eligible_group',
    message: 'Không có nhóm phù hợp để rời hoặc tài khoản/Page không còn là thành viên.',
    data
  }
}

export class LeaveGroupActionExecutor implements ActionExecutor {
  readonly actionType = 'leave_group'

  constructor(private readonly dependencies: LeaveGroupActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Rời nhóm')

    const timeoutMs = this.dependencies.navigationTimeoutMs ?? 45_000
    const target = pickRange(
      configNumber(config, 'leaveMin', 1),
      configNumber(config, 'leaveMax', 1)
    )
    const sourceMode = configString(config, 'sourceMode') || 'id_list'
    const stats: LeaveGroupStats = { attempted: 0, groupsVisited: 0, left: 0, skipped: 0, failed: 0 }

    let groupUrls: string[]
    if (sourceMode === 'id_list') {
      groupUrls = configuredLeaveGroupUrls(config).slice(0, target)
    } else {
      if (!await navigate(page, 'https://www.facebook.com/groups/joins/', timeoutMs)) {
        return navigationFailed('Rời nhóm', new Error('Không mở được danh sách nhóm đã tham gia.'))
      }
      groupUrls = await collectJoinedGroupUrls(page, [], target)
    }

    if (!groupUrls.length) return resultFromStats(stats, target, sourceMode, context.control.isStopped())

    for (let index = 0; index < groupUrls.length; index += 1) {
      if (context.control.isStopped()) break
      await context.control.waitIfPaused()
      if (context.control.isStopped()) break

      const url = groupUrls[index]
      if (!url) continue
      stats.attempted += 1
      if (!await navigate(page, url, timeoutMs)) {
        stats.failed += 1
        context.log('warning', 'Không mở được một nhóm trong danh sách rời nhóm.', 'leave_group_navigation_failed')
      } else {
        stats.groupsVisited += 1
        if (await leaveCurrentGroup(page)) {
          stats.left += 1
          context.log('info', 'Đã thực hiện rời một nhóm.', 'leave_group_item_completed', { completed: stats.left })
        } else {
          stats.skipped += 1
          context.log('debug', 'Bỏ qua nhóm vì không tìm thấy trạng thái thành viên/rời nhóm phù hợp.', 'leave_group_item_skipped')
        }
      }

      if (index < groupUrls.length - 1 && !await paceGroupInteraction(context, config, stats.attempted)) break
    }

    return resultFromStats(stats, target, sourceMode, context.control.isStopped())
  }
}
