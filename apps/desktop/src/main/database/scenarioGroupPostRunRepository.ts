import type Database from 'better-sqlite3'
import type { PageTabImageConfig, PostSelectionMode } from '../../shared/pageTabs'
import type { RunDetails, RunSnapshot, RunSnapshotPost } from '../../shared/runs'
import { RunRepository } from './runRepository'

export interface CreateScenarioGroupPostRunInput {
  runKey: string
  name: string
  accountIds: number[]
  groupUids: string[]
  variants: string[]
  postMode: PostSelectionMode
  image: PageTabImageConfig
  posts?: RunSnapshotPost[]
  postsPerAccount: number
  postDelayMinSeconds: number
  postDelayMaxSeconds: number
}

function uniquePositiveIntegers(values: readonly number[]): number[] {
  const seen = new Set<number>()
  const result: number[] = []
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0 || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function normalizePosts(input: CreateScenarioGroupPostRunInput, variants: string[]): RunSnapshotPost[] {
  if (!input.posts?.length) {
    return [{
      name: 'Scenario group_post',
      enabled: true,
      sortOrder: 0,
      variants: [...variants],
      image: { ...input.image }
    }]
  }
  return input.posts
    .filter((post) => post.enabled)
    .map((post, index) => ({
      name: post.name.trim() || `Bài viết ${index + 1}`,
      enabled: true,
      sortOrder: index,
      variants: post.variants.map((variant) => variant.trim()).filter(Boolean),
      image: { ...post.image, folderPath: post.image.folderPath.trim() }
    }))
    .filter((post) => post.variants.length > 0 || post.image.folderPath.length > 0)
}

export class ScenarioGroupPostRunRepository {
  private readonly runs: RunRepository

  constructor(private readonly client: Database.Database) {
    this.runs = new RunRepository(client)
  }

  create(input: CreateScenarioGroupPostRunInput): RunDetails {
    const accountIds = uniquePositiveIntegers(input.accountIds)
    const groupUids = uniqueNonEmpty(input.groupUids)
    const variants = input.variants.map((value) => value.trim()).filter(Boolean)
    const posts = normalizePosts(input, variants)
    if (!accountIds.length) throw new Error('Scenario group_post không có tài khoản hợp lệ.')
    if (!groupUids.length) throw new Error('Scenario group_post không có Group hợp lệ.')
    if (!posts.length) throw new Error('Scenario group_post không có bài viết snapshot hợp lệ.')

    const flattenedVariants = posts.flatMap((post) => post.variants)
    const fallbackImage = posts[0]?.image ?? input.image
    const create = this.client.transaction(() => {
      const snapshot: RunSnapshot = {
        version: 1,
        // Legacy RunSnapshot requires a numeric Page Tab id. Database ownership is NULL;
        // pageUid='' is the existing Common Runtime convention for profile actor.
        pageTabId: 0,
        tabName: input.name.trim() || 'Kịch Bản · Đăng bài nhóm',
        pageUid: '',
        rotation: {
          postsPerAccount: Math.max(1, Math.floor(input.postsPerAccount)),
          postDelayMinSeconds: Math.max(0, input.postDelayMinSeconds),
          postDelayMaxSeconds: Math.max(0, input.postDelayMaxSeconds),
          accountDelayMinSeconds: 0,
          accountDelayMaxSeconds: 0,
          accountOrderMode: 'sequential'
        },
        accounts: accountIds.map((accountId, sortOrder) => ({
          accountId,
          enabled: true,
          sortOrder,
          postsPerTurn: Math.max(1, Math.floor(input.postsPerAccount))
        })),
        schedules: [],
        contentMode: input.postMode === 'random' ? 'random' : 'sequential',
        contents: [...flattenedVariants],
        image: { ...fallbackImage },
        postMode: input.postMode,
        posts: posts.map((post) => ({
          ...post,
          variants: [...post.variants],
          image: { ...post.image }
        })),
        groupSourceCount: groupUids.length
      }

      const now = Date.now()
      const result = this.client.prepare(`
        INSERT INTO runs (
          page_tab_id, status, tab_name, page_uid, snapshot_json,
          created_at, started_at, paused_at, completed_at, updated_at
        ) VALUES (NULL, 'created', ?, '', ?, ?, NULL, NULL, NULL, ?)
      `).run(snapshot.tabName, JSON.stringify(snapshot), now, now)
      const runId = Number(result.lastInsertRowid)

      const insertItem = this.client.prepare(`
        INSERT INTO run_items (
          run_id, source_group_item_id, group_uid, sort_order, status,
          attempt_count, last_error, started_at, finished_at, updated_at
        ) VALUES (?, NULL, ?, ?, 'pending', 0, NULL, NULL, NULL, ?)
      `)
      groupUids.forEach((groupUid, sortOrder) => insertItem.run(runId, groupUid, sortOrder, now))

      this.client.prepare(`
        INSERT INTO run_events (run_id, event_type, payload_json, created_at)
        VALUES (?, 'run_created', ?, ?)
      `).run(runId, JSON.stringify({
        source: 'scenario_group_post',
        runKey: input.runKey,
        groupCount: groupUids.length,
        accountCount: accountIds.length,
        postCount: posts.length
      }), now)
      return runId
    })

    const details = this.runs.get(create())
    if (!details) throw new Error('Không thể đọc lại Scenario group_post run vừa tạo.')
    return details
  }
}
