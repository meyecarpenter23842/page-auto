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
  directGroupUrlsFromWhitelist,
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

export interface GroupInteractionStats {
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

export interface GroupTargets {
  views: number
  reactions: number
  comments: number
  wallShares: number
  groupShares: number
}

export type GroupInteractionOperation = 'view' | 'reaction' | 'comment' | 'share_wall' | 'share_group'

interface GroupBaseline {
  viewed: number
  reacted: number
  commented: number
  sharedToWall: number
  sharedToGroup: number
}

const GROUP_SURFACE_READY_TIMEOUT_MS = 15_000
const GROUP_SURFACE_READY_POLL_MS = 500
const GROUP_VISIBLE_ARTICLE_PROBE_LIMIT = 12

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

export function groupInteractionTargetsSatisfied(stats: GroupInteractionStats, targets: GroupTargets): boolean {
  return stats.viewed >= targets.views
    && stats.reacted >= targets.reactions
    && stats.commented >= targets.comments
    && stats.sharedToWall >= targets.wallShares
    && stats.sharedToGroup >= targets.groupShares
}

export function groupRestrictionBlocksOperation(
  restriction: GroupRestrictionCode | null,
  operation: GroupInteractionOperation
): boolean {
  if (!restriction) return false
  if (restriction === 'temporarily_restricted') return true
  if (restriction === 'comment_blocked') return operation === 'comment'
  if (restriction === 'posting_blocked') return operation === 'share_group'
  return false
}

function configuredOperations(config: ActionConfig): GroupInteractionOperation[] {
  const operations: GroupInteractionOperation[] = []
  if (configBoolean(config, 'viewEnabled')) operations.push('view')
  if (configBoolean(config, 'reactionEnabled')) operations.push('reaction')
  if (configBoolean(config, 'commentEnabled')) operations.push('comment')
  if (configBoolean(config, 'shareWallEnabled')) operations.push('share_wall')
  if (configBoolean(config, 'shareGroupEnabled')) operations.push('share_group')
  return operations
}

function restrictionBlocksWholeSurface(restriction: GroupRestrictionCode | null, config: ActionConfig): boolean {
  if (!restriction) return false
  const operations = configuredOperations(config)
  return operations.length > 0 && operations.every((operation) => groupRestrictionBlocksOperation(restriction, operation))
}

function targetCount(targets: GroupTargets): number {
  return targets.views + targets.reactions + targets.comments + targets.wallShares + targets.groupShares
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

async function visibleArticleCount(page: Page): Promise<{ total: number; visible: number }> {
  const articles = groupArticles(page)
  const total = await articles.count().catch(() => 0)
  let visible = 0
  for (let index = 0; index < Math.min(total, GROUP_VISIBLE_ARTICLE_PROBE_LIMIT); index += 1) {
    if (await articles.nth(index).isVisible().catch(() => false)) visible += 1
  }
  return { total, visible }
}

async function waitForGroupSurfaceReady(
  page: Page,
  context: ActionExecutorContext,
  timeoutMs: number
): Promise<boolean> {
  const waitMs = Math.min(Math.max(GROUP_SURFACE_READY_POLL_MS, timeoutMs), GROUP_SURFACE_READY_TIMEOUT_MS)
  const attempts = Math.max(1, Math.ceil(waitMs / GROUP_SURFACE_READY_POLL_MS))
  let lastTotal = 0

  for (let attempt = 0; attempt < attempts && !context.control.isStopped(); attempt += 1) {
    await context.control.waitIfPaused()
    if (context.control.isStopped()) return false

    const counts = await visibleArticleCount(page)
    lastTotal = counts.total
    if (counts.visible > 0) {
      context.log('debug', `Group đã sẵn sàng: thấy ${counts.visible}/${counts.total} bài đang hiển thị.`, 'group_articles_ready', counts)
      return true
    }

    if (attempt + 1 < attempts && !await sleepWithControl(context.control, GROUP_SURFACE_READY_POLL_MS)) return false
  }

  context.log(
    'warning',
    `Group đã mở nhưng chưa có bài viết hiển thị sau ${Math.round(waitMs / 1000)} giây.`,
    'group_articles_not_ready',
    { articleCount: lastTotal, url: page.url() }
  )
  return false
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
  if (restriction === 'temporarily_restricted') {
    const leftBefore = stats.groupsLeft
    await handleRestriction(page, config, stats, directGroupPage)
    return stats.groupsLeft === leftBefore && !context.control.isStopped()
  }
  if (restriction) {
    context.log(
      'debug',
      `Bài có hạn chế cục bộ “${restriction}”; chỉ bỏ qua thao tác bị hạn chế, vẫn thử reaction/view còn hợp lệ.`,
      'group_article_partial_restriction',
      { restriction }
    )
  }

  stats.postsSeen += 1
  if (configBoolean(config, 'viewEnabled') && !groupRestrictionBlocksOperation(restriction, 'view')) {
    if (!await viewGroupArticle(context, config)) return false
    stats.viewed += 1
  }

  if (
    configBoolean(config, 'reactionEnabled')
    && !groupRestrictionBlocksOperation(restriction, 'reaction')
    && stats.reacted - baseline.reacted < targets.reactions
  ) {
    context.log('debug', 'Đang tìm và bấm reaction trong bài hiện tại.', 'group_reaction_attempt')
    if (await reactToGroupArticle(page, article, config)) {
      stats.reacted += 1
      context.log('info', 'Đã bấm reaction trong bài viết.', 'group_reaction_clicked')
      if (!await paceGroupInteraction(context, config, completedActions(stats))) return false
    } else {
      context.log('warning', 'Không bấm được reaction trong bài này; chuyển sang bài khác.', 'group_reaction_not_clicked')
    }
  }

  if (
    configBoolean(config, 'commentEnabled')
    && !groupRestrictionBlocksOperation(restriction, 'comment')
    && stats.commented - baseline.commented < targets.comments
  ) {
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

  if (
    configBoolean(config, 'shareWallEnabled')
    && !groupRestrictionBlocksOperation(restriction, 'share_wall')
    && stats.sharedToWall - baseline.sharedToWall < targets.wallShares
  ) {
    if (await shareGroupArticleToWall(page, article)) {
      stats.sharedToWall += 1
      if (!await paceGroupInteraction(context, config, completedActions(stats))) return false
    }
  }

  if (
    configBoolean(config, 'shareGroupEnabled')
    && !groupRestrictionBlocksOperation(restriction, 'share_group')
    && stats.sharedToGroup - baseline.sharedToGroup < targets.groupShares
  ) {
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
  directGroupPage: boolean,
  timeoutMs: number
): Promise<boolean> {
  if (!await waitForGroupSurfaceReady(page, context, timeoutMs)) return false
  if (configBoolean(config, 'sortRecent')) await sortGroupFeedByRecent(page)

  const pageRestriction = await restrictionFor(page)
  if (pageRestriction && restrictionBlocksWholeSurface(pageRestriction, config)) {
    context.log('warning', `Group bị hạn chế “${pageRestriction}” cho toàn bộ thao tác đã chọn.`, 'group_surface_restricted', { restriction: pageRestriction })
    await handleRestriction(page, config, stats, directGroupPage)
    return false
  }
  if (pageRestriction) {
    context.log(
      'debug',
      `Group có thông báo “${pageRestriction}” nhưng vẫn còn thao tác hợp lệ; tiếp tục quét bài.`,
      'group_surface_partial_restriction',
      { restriction: pageRestriction }
    )
  }

  const postsSeenBefore = stats.postsSeen
  const whitelist = configuredGroupWhitelist(config)
  const baseline = baselineFromStats(stats)
  const shareTargets = splitLines(configString(config, 'shareGroupWhitelist'))
  const seen = new Set<string>()
  let idleRounds = 0

  for (let round = 0; round < 16 && !interactionDone(stats, baseline, targets); round += 1) {
    if (context.control.isStopped()) return stats.postsSeen > postsSeenBefore
    await context.control.waitIfPaused()
    if (context.control.isStopped()) return stats.postsSeen > postsSeenBefore

    const articles = groupArticles(page)
    const count = await articles.count().catch(() => 0)
    let newPosts = 0
    for (let index = 0; index < count && !interactionDone(stats, baseline, targets); index += 1) {
      if (context.control.isStopped()) return stats.postsSeen > postsSeenBefore
      const article = articles.nth(index)
      if (!await article.isVisible().catch(() => false)) continue
      const text = await article.innerText().catch(() => '')
      const identity = await articleGroupIdentity(article) ?? groupIdentityFromHref(page.url())?.toLocaleLowerCase() ?? null
      const signature = `${identity ?? 'unknown'}:${text.replace(/\s+/g, ' ').trim().slice(0, 300)}`
      if (seen.has(signature)) continue
      seen.add(signature)
      newPosts += 1
      if (!await processArticle(page, article, context, config, whitelist, shareTargets, targets, baseline, stats, directGroupPage)) {
        return stats.postsSeen > postsSeenBefore
      }
    }

    if (newPosts === 0) idleRounds += 1
    else idleRounds = 0
    if (idleRounds >= 3 || interactionDone(stats, baseline, targets)) return stats.postsSeen > postsSeenBefore
    await page.mouse.wheel(0, 1400).catch(() => undefined)
    if (!await sleepWithControl(context.control, 900)) return stats.postsSeen > postsSeenBefore
  }

  return stats.postsSeen > postsSeenBefore
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

  const expected = targetCount(targets)
  if (expected > 0 && groupInteractionTargetsSatisfied(stats, targets)) {
    return {
      status: 'success',
      code: 'group_interaction_completed',
      message: `Tương tác nhóm hoàn tất: xem ${stats.viewed}, cảm xúc ${stats.reacted}, comment ${stats.commented}, chia sẻ ${stats.sharedToWall + stats.sharedToGroup}.`,
      data
    }
  }

  if (stats.postsSeen > 0 && expected > 0) {
    return {
      status: 'failed',
      code: 'group_interaction_incomplete',
      message: `Tương tác nhóm chưa đạt cấu hình: xem ${stats.viewed}/${targets.views}, cảm xúc ${stats.reacted}/${targets.reactions}, comment ${stats.commented}/${targets.comments}, chia sẻ tường ${stats.sharedToWall}/${targets.wallShares}, chia sẻ nhóm ${stats.sharedToGroup}/${targets.groupShares}.`,
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
      const eligible = await processCurrentSurface(page, context, config, targets, stats, false, timeoutMs)
      if (eligible) addTargets(aggregateTargets, targets)
      return resultFromStats(stats, aggregateTargets, context.control.isStopped())
    }

    const desiredGroups = pickRange(
      configNumber(config, 'joinedGroupMin', 5),
      configNumber(config, 'joinedGroupMax', 10)
    )
    const whitelist = configuredGroupWhitelist(config)
    let groupUrls = directGroupUrlsFromWhitelist(whitelist, desiredGroups)
    if (!groupUrls.length) {
      if (!await navigate(page, 'https://www.facebook.com/groups/joins/', timeoutMs)) {
        return navigationFailed('Tương tác nhóm', new Error('Không mở được danh sách nhóm đã tham gia.'))
      }
      groupUrls = await collectJoinedGroupUrls(page, [], desiredGroups)
    }
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
      const eligible = await processCurrentSurface(page, context, config, targets, stats, true, timeoutMs)
      if (eligible) addTargets(aggregateTargets, targets)
    }

    return resultFromStats(stats, aggregateTargets, context.control.isStopped())
  }
}
