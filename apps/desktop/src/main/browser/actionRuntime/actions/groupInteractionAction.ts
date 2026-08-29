import type { Locator, Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import {
  browserUnavailable,
  configBoolean,
  configNumber,
  configString,
  navigationFailed,
  pickOne,
  pickRange,
  sleepWithControl,
  splitLines
} from './actionSupport'
import {
  articleGroupIdentity,
  classifyGroupRestriction,
  collectJoinedGroupUrls,
  configuredGroupWhitelist,
  deleteGroupComment,
  groupArticles,
  groupIdentityAllowed,
  leaveCurrentGroup,
  paceGroupInteraction,
  reactToGroupArticle,
  shareGroupArticleToGroup,
  shareGroupArticleToWall,
  sortGroupFeedByRecent,
  viewGroupArticle,
  commentOnGroupArticle,
  type GroupInteractionActionDependencies,
  type GroupRestrictionCode
} from './groupInteractionActionSupport'
import { groupIdentityFromHref } from './joinGroupActionSupport'

interface GroupInteractionStats {
  groupsVisited: number
  postsSeen: number
  viewed: number
  reacted: number
  commented: number
  commentsDeleted: number
  sharedToWall: number
  sharedToGroup: number
  restricted: number
  groupsLeft: number
  skipped: number
  failed: number
}

interface GroupTargets {
  views: number
  reactions: number
  comments: number
  wallShares: number
  groupShares: number
}

interface GroupBaseline {
  viewed: number
  reacted: number
  commented: number
  sharedToWall: number
  sharedToGroup: number
}

function completedActions(stats: GroupInteractionStats): number {
  return stats.reacted + stats.commented + stats.sharedToWall + stats.sharedToGroup
}

function interactionDone(stats: GroupInteractionStats, baseline: GroupBaseline, targets: GroupTargets): boolean {
  return stats.viewed - baseline.viewed >= targets.views
    && stats.reacted - baseline.reacted >= targets.reactions
    && stats.commented - baseline.commented >= targets.comments
    && stats.sharedToWall - baseline.sharedToWall >= targets.wallShares
    && stats.sharedToGroup - baseline.sharedToGroup >= targets.groupShares
}

function baselineFromStats(stats: GroupInteractionStats): GroupBaseline {
  return {
    viewed: stats.viewed,
    reacted: stats.reacted,
    commented: stats.commented,
    sharedToWall: stats.sharedToWall,
    sharedToGroup: stats.sharedToGroup
  }
}

function addTargets(total: GroupTargets, next: GroupTargets): void {
  total.views += next.views
  total.reactions += next.reactions
  total.comments += next.comments
  total.wallShares += next.wallShares
  total.groupShares += next.groupShares
}

async function navigate(page: Page, url: string, timeoutMs: number): Promise<boolean> {
  return page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false)
}

async function restrictionFor(page: Page, article?: Locator): Promise<GroupRestrictionCode | null> {
  const text = article
    ? await article.innerText().catch(() => '')
    : await page.locator('body').innerText().catch(() => '')
  return classifyGroupRestriction(text)
}

async function handleRestriction(
  page: Page,
  config: ActionConfig,
  stats: GroupInteractionStats,
  directGroupPage: boolean
): Promise<void> {
  stats.restricted += 1
  if (configString(config, 'restrictedGroupPolicy') !== 'leave' || !directGroupPage) {
    stats.skipped += 1
    return
  }
  if (await leaveCurrentGroup(page)) stats.groupsLeft += 1
  else stats.skipped += 1
}

function postTextForComment(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 800)
}

async function processArticle(
  page: Page,
  article: Locator,
  context: ActionExecutorContext,
  config: ActionConfig,
  whitelist: readonly string[],
  shareTargets: readonly string[],
  targets: GroupTargets,
  baseline: GroupBaseline,
  stats: GroupInteractionStats,
  directGroupPage: boolean
): Promise<boolean> {
  const identity = await articleGroupIdentity(article) ?? groupIdentityFromHref(page.url())?.toLocaleLowerCase() ?? null
  if (!groupIdentityAllowed(identity, whitelist)) {
    stats.skipped += 1
    return true
  }

  const restriction = await restrictionFor(page, article)
  if (restriction) {
    const leftBefore = stats.groupsLeft
    await handleRestriction(page, config, stats, directGroupPage)
    return stats.groupsLeft === leftBefore && !context.control.isStopped()
  }

  stats.postsSeen += 1
  if (configBoolean(config, 'viewEnabled')) {
    if (!await viewGroupArticle(context, config)) return false
    stats.viewed += 1
  }

  if (configBoolean(config, 'reactionEnabled') && stats.reacted - baseline.reacted < targets.reactions) {
    if (await reactToGroupArticle(page, article, config)) {
      stats.reacted += 1
      if (!await paceGroupInteraction(context, config, completedActions(stats))) return false
    }
  }

  if (configBoolean(config, 'commentEnabled') && stats.commented - baseline.commented < targets.comments) {
    const templates = splitLines(configString(config, 'commentTemplates'))
    const articleText = await article.innerText().catch(() => '')
    const commentText = configBoolean(config, 'usePostTextAsComment')
      ? postTextForComment(articleText)
      : pickOne(templates)
    if (commentText && await commentOnGroupArticle(page, article, commentText, configString(config, 'commentImagePath'))) {
      stats.commented += 1
      if (configBoolean(config, 'deleteCommentAfter') && await deleteGroupComment(page, article, commentText)) {
        stats.commentsDeleted += 1
      }
      if (!await paceGroupInteraction(context, config, completedActions(stats))) return false
    }
  }

  if (configBoolean(config, 'shareWallEnabled') && stats.sharedToWall - baseline.sharedToWall < targets.wallShares) {
    if (await shareGroupArticleToWall(page, article)) {
      stats.sharedToWall += 1
      if (!await paceGroupInteraction(context, config, completedActions(stats))) return false
    }
  }

  if (configBoolean(config, 'shareGroupEnabled') && stats.sharedToGroup - baseline.sharedToGroup < targets.groupShares) {
    const shareTarget = pickOne(shareTargets)
    if (shareTarget && await shareGroupArticleToGroup(page, article, shareTarget)) {
      stats.sharedToGroup += 1
      if (!await paceGroupInteraction(context, config, completedActions(stats))) return false
    }
  }

  return !context.control.isStopped()
}

async function processCurrentSurface(
  page: Page,
  context: ActionExecutorContext,
  config: ActionConfig,
  targets: GroupTargets,
  stats: GroupInteractionStats,
  directGroupPage: boolean
): Promise<void> {
  if (configBoolean(config, 'sortRecent')) await sortGroupFeedByRecent(page)

  const pageRestriction = await restrictionFor(page)
  if (pageRestriction) {
    await handleRestriction(page, config, stats, directGroupPage)
    return
  }

  const whitelist = configuredGroupWhitelist(config)
  const baseline = baselineFromStats(stats)
  const shareTargets = splitLines(configString(config, 'shareGroupWhitelist'))
  const seen = new Set<string>()
  let idleRounds = 0

  for (let round = 0; round < 16 && !interactionDone(stats, baseline, targets); round += 1) {
    if (context.control.isStopped()) return
    await context.control.waitIfPaused()
    if (context.control.isStopped()) return

    const articles = groupArticles(page)
    const count = await articles.count().catch(() => 0)
    let newPosts = 0
    for (let index = 0; index < count && !interactionDone(stats, baseline, targets); index += 1) {
      if (context.control.isStopped()) return
      const article = articles.nth(index)
      if (!await article.isVisible().catch(() => false)) continue
      const text = await article.innerText().catch(() => '')
      const identity = await articleGroupIdentity(article) ?? groupIdentityFromHref(page.url())?.toLocaleLowerCase() ?? null
      const signature = `${identity ?? 'unknown'}:${text.replace(/\s+/g, ' ').trim().slice(0, 300)}`
      if (seen.has(signature)) continue
      seen.add(signature)
      newPosts += 1
      if (!await processArticle(page, article, context, config, whitelist, shareTargets, targets, baseline, stats, directGroupPage)) return
    }

    if (newPosts === 0) idleRounds += 1
    else idleRounds = 0
    if (idleRounds >= 3 || interactionDone(stats, baseline, targets)) return
    await page.mouse.wheel(0, 1400).catch(() => undefined)
    if (!await sleepWithControl(context.control, 900)) return
  }
}

function buildTargets(config: ActionConfig): GroupTargets {
  const reactions = configBoolean(config, 'reactionEnabled')
    ? pickRange(configNumber(config, 'reactionMin', 0), configNumber(config, 'reactionMax', 0))
    : 0
  const comments = configBoolean(config, 'commentEnabled')
    ? pickRange(configNumber(config, 'commentMin', 0), configNumber(config, 'commentMax', 0))
    : 0
  const wallShares = configBoolean(config, 'shareWallEnabled')
    ? pickRange(configNumber(config, 'shareWallMin', 0), configNumber(config, 'shareWallMax', 0))
    : 0
  const groupShares = configBoolean(config, 'shareGroupEnabled')
    ? pickRange(configNumber(config, 'shareGroupMin', 0), configNumber(config, 'shareGroupMax', 0))
    : 0
  const views = configBoolean(config, 'viewEnabled')
    ? Math.max(1, reactions, comments, wallShares, groupShares)
    : 0
  return { views, reactions, comments, wallShares, groupShares }
}

function resultFromStats(stats: GroupInteractionStats, targets: GroupTargets, stopped: boolean): ActionResult {
  const data = { ...stats, targets }
  if (stopped) return { status: 'stopped', code: 'action_stopped', message: 'Tương tác nhóm đã dừng.', data }
  if (stats.viewed + completedActions(stats) > 0) {
    return {
      status: 'success',
      code: 'group_interaction_completed',
      message: `Tương tác nhóm hoàn tất: xem ${stats.viewed}, cảm xúc ${stats.reacted}, comment ${stats.commented}, chia sẻ ${stats.sharedToWall + stats.sharedToGroup}.`,
      data
    }
  }
  if (stats.restricted > 0) {
    return {
      status: 'skipped',
      code: 'group_interaction_restricted',
      message: `Đã classify ${stats.restricted} nhóm/bài bị hạn chế; không cố vượt hạn chế Facebook.`,
      data
    }
  }
  if (stats.failed > 0) {
    return {
      status: 'failed',
      code: 'group_interaction_no_verified_result',
      message: 'Không hoàn tất được tương tác nhóm trên các surface đã mở.',
      data
    }
  }
  return {
    status: 'skipped',
    code: 'group_interaction_no_eligible_post',
    message: 'Không tìm thấy bài viết nhóm phù hợp cấu hình.',
    data
  }
}

export class GroupInteractionActionExecutor implements ActionExecutor {
  readonly actionType = 'group_interaction'

  constructor(private readonly dependencies: GroupInteractionActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Tương tác nhóm')

    const timeoutMs = this.dependencies.navigationTimeoutMs ?? 45_000
    const aggregateTargets: GroupTargets = { views: 0, reactions: 0, comments: 0, wallShares: 0, groupShares: 0 }
    const stats: GroupInteractionStats = {
      groupsVisited: 0,
      postsSeen: 0,
      viewed: 0,
      reacted: 0,
      commented: 0,
      commentsDeleted: 0,
      sharedToWall: 0,
      sharedToGroup: 0,
      restricted: 0,
      groupsLeft: 0,
      skipped: 0,
      failed: 0
    }

    const mode = configString(config, 'sourceMode') || 'groups_feed'
    if (mode === 'groups_feed') {
      if (!await navigate(page, 'https://www.facebook.com/groups/feed/', timeoutMs)) {
        return navigationFailed('Tương tác nhóm', new Error('Không mở được newsfeed nhóm.'))
      }
      const targets = buildTargets(config)
      addTargets(aggregateTargets, targets)
      await processCurrentSurface(page, context, config, targets, stats, false)
      return resultFromStats(stats, aggregateTargets, context.control.isStopped())
    }

    if (!await navigate(page, 'https://www.facebook.com/groups/joins/', timeoutMs)) {
      return navigationFailed('Tương tác nhóm', new Error('Không mở được danh sách nhóm đã tham gia.'))
    }
    const desiredGroups = pickRange(
      configNumber(config, 'joinedGroupMin', 5),
      configNumber(config, 'joinedGroupMax', 10)
    )
    const groupUrls = await collectJoinedGroupUrls(page, configuredGroupWhitelist(config), desiredGroups)
    if (!groupUrls.length) return resultFromStats(stats, aggregateTargets, context.control.isStopped())

    for (const url of groupUrls) {
      if (context.control.isStopped()) break
      await context.control.waitIfPaused()
      if (context.control.isStopped()) break
      if (!await navigate(page, url, timeoutMs)) {
        stats.failed += 1
        continue
      }
      stats.groupsVisited += 1
      const targets = buildTargets(config)
      addTargets(aggregateTargets, targets)
      await processCurrentSurface(page, context, config, targets, stats, true)
    }

    return resultFromStats(stats, aggregateTargets, context.control.isStopped())
  }
}
