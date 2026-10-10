import type Database from 'better-sqlite3'
import type {
  CompleteRunItemPayload,
  RunDetails,
  RunItem,
  RunItemStatus,
  RunMetrics,
  RunRecord,
  RunSnapshot,
  RunStatus
} from '../../shared/runs'
import { PageTabPostRepository } from './pageTabPostRepository'
import { PageTabRepository } from './pageTabRepository'

interface RunRow {
  id: number
  pageTabId: number | null
  status: string
  tabName: string
  pageUid: string
  snapshotJson: string
  createdAt: number
  startedAt: number | null
  pausedAt: number | null
  completedAt: number | null
  updatedAt: number
}

interface GroupSourceRow {
  sourceGroupItemId: number
  groupUid: string
  sortOrder: number
}

export interface RunRotationState {
  activeDateKey: string | null
  completedWindowKey: string | null
}

function parseSnapshot(value: string): RunSnapshot {
  const parsed = JSON.parse(value) as RunSnapshot
  if (parsed.version !== 1 || !Number.isInteger(parsed.pageTabId) || !Array.isArray(parsed.accounts)) {
    throw new Error('Run snapshot không hợp lệ.')
  }
  if (!Number.isInteger(parsed.rotation.accountConcurrency) || (parsed.rotation.accountConcurrency ?? 0) < 1) {
    parsed.rotation.accountConcurrency = 1
  }
  return parsed
}

function rowToRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    pageTabId: row.pageTabId,
    status: row.status as RunStatus,
    tabName: row.tabName,
    pageUid: row.pageUid,
    snapshot: parseSnapshot(row.snapshotJson),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    pausedAt: row.pausedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt
  }
}

function rowToItem(row: Record<string, unknown>): RunItem {
  return {
    id: Number(row.id),
    runId: Number(row.runId),
    sourceGroupItemId: row.sourceGroupItemId === null ? null : Number(row.sourceGroupItemId),
    groupUid: String(row.groupUid),
    sortOrder: Number(row.sortOrder),
    status: String(row.status) as RunItemStatus,
    claimedByAccountId: row.claimedByAccountId === null ? null : Number(row.claimedByAccountId),
    attemptCount: Number(row.attemptCount),
    lastError: row.lastError === null ? null : String(row.lastError),
    startedAt: row.startedAt === null ? null : Number(row.startedAt),
    finishedAt: row.finishedAt === null ? null : Number(row.finishedAt),
    updatedAt: Number(row.updatedAt)
  }
}

function claimOwnerAccountId(accountId?: number): number {
  if (accountId === undefined) return 0
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('Account claim owner không hợp lệ.')
  return accountId
}

export class RunRepository {
  private readonly pageTabs: PageTabRepository
  private readonly posts: PageTabPostRepository

  constructor(private readonly client: Database.Database) {
    this.pageTabs = new PageTabRepository(client)
    this.posts = new PageTabPostRepository(client)
  }

  createForPageTab(pageTabId: number): RunDetails {
    const create = this.client.transaction(() => {
      const config = this.pageTabs.get(pageTabId)
      if (!config) throw new Error(`Không tìm thấy Page Tab #${pageTabId}.`)
      const postLibrary = this.posts.get(pageTabId)

      const active = this.client.prepare(`
        SELECT id FROM runs
        WHERE page_tab_id = ? AND status IN ('created', 'running', 'paused')
        LIMIT 1
      `).get(pageTabId) as { id: number } | undefined
      if (active) throw new Error(`Page Tab đang có phiên #${active.id} chưa kết thúc.`)

      const groupRows = this.client.prepare(`
        SELECT gsi.id AS sourceGroupItemId, gsi.group_uid AS groupUid, gsi.sort_order AS sortOrder
        FROM group_set_items gsi
        JOIN group_sets gs ON gs.id = gsi.group_set_id
        WHERE gs.page_tab_id = ?
        ORDER BY gsi.sort_order, gsi.id
      `).all(pageTabId) as GroupSourceRow[]
      if (groupRows.length === 0) throw new Error('Group Set đang trống; chưa thể tạo phiên chạy.')

      const snapshot: RunSnapshot = {
        version: 1,
        pageTabId: config.id,
        tabName: config.name,
        pageUid: config.pageUid,
        rotation: { ...config.rotation, accountConcurrency: config.rotation.accountConcurrency ?? 1 },
        accounts: config.accounts.map((account, index) => ({
          accountId: account.accountId,
          enabled: account.enabled,
          sortOrder: index,
          postsPerTurn: account.postsPerTurn
        })),
        schedules: config.schedules.map((schedule, index) => ({
          dayOfWeek: schedule.dayOfWeek,
          startMinute: schedule.startMinute,
          endMinute: schedule.endMinute,
          enabled: schedule.enabled,
          sortOrder: index
        })),
        contentMode: config.contentMode,
        contents: [...config.contents],
        image: { ...config.image },
        postMode: postLibrary.mode,
        posts: postLibrary.posts.map((post, index) => ({
          name: post.name,
          enabled: post.enabled,
          sortOrder: index,
          variants: [...post.variants],
          image: { ...post.image }
        })),
        groupSourceCount: groupRows.length
      }

      const now = Date.now()
      const runResult = this.client.prepare(`
        INSERT INTO runs (
          page_tab_id, status, tab_name, page_uid, snapshot_json,
          created_at, started_at, paused_at, completed_at, updated_at
        ) VALUES (?, 'created', ?, ?, ?, ?, NULL, NULL, NULL, ?)
      `).run(pageTabId, config.name, config.pageUid, JSON.stringify(snapshot), now, now)
      const runId = Number(runResult.lastInsertRowid)

      const insertItem = this.client.prepare(`
        INSERT INTO run_items (
          run_id, source_group_item_id, group_uid, sort_order, status,
          attempt_count, last_error, started_at, finished_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, ?)
      `)
      for (const group of groupRows) insertItem.run(runId, group.sourceGroupItemId, group.groupUid, group.sortOrder, now)

      this.addEvent(runId, 'run_created', {
        pageTabId,
        groupCount: groupRows.length,
        accountCount: snapshot.accounts.filter((account) => account.enabled).length,
        accountConcurrency: snapshot.rotation.accountConcurrency ?? 1,
        postCount: snapshot.posts?.filter((post) => post.enabled).length ?? 0
      }, now)
      return runId
    })

    const created = this.get(create())
    if (!created) throw new Error('Không thể đọc lại phiên vừa tạo.')
    return created
  }

  get(runId: number): RunDetails | null {
    const row = this.client.prepare(`
      SELECT id, page_tab_id AS pageTabId, status, tab_name AS tabName, page_uid AS pageUid,
        snapshot_json AS snapshotJson, created_at AS createdAt, started_at AS startedAt,
        paused_at AS pausedAt, completed_at AS completedAt, updated_at AS updatedAt
      FROM runs WHERE id = ?
    `).get(runId) as RunRow | undefined
    if (!row) return null
    return { run: rowToRun(row), metrics: this.metrics(runId) }
  }

  getLatestForPageTab(pageTabId: number): RunDetails | null {
    const row = this.client.prepare(`SELECT id FROM runs WHERE page_tab_id = ? ORDER BY id DESC LIMIT 1`).get(pageTabId) as { id: number } | undefined
    return row ? this.get(row.id) : null
  }

  getRotationState(runId: number): RunRotationState | null {
    const row = this.client.prepare(`
      SELECT payload_json AS payloadJson FROM run_events
      WHERE run_id = ? AND event_type = 'rotation_state' ORDER BY id DESC LIMIT 1
    `).get(runId) as { payloadJson: string | null } | undefined
    if (!row?.payloadJson) return null
    try {
      const parsed = JSON.parse(row.payloadJson) as Record<string, unknown>
      return {
        activeDateKey: typeof parsed.activeDateKey === 'string' ? parsed.activeDateKey : null,
        completedWindowKey: typeof parsed.completedWindowKey === 'string' ? parsed.completedWindowKey : null
      }
    } catch { return null }
  }

  saveRotationState(runId: number, state: RunRotationState): void {
    this.requireRun(runId)
    this.addEvent(runId, 'rotation_state', { activeDateKey: state.activeDateKey, completedWindowKey: state.completedWindowKey }, Date.now())
  }

  listItems(runId: number): RunItem[] {
    const rows = this.client.prepare(`
      SELECT id, run_id AS runId, source_group_item_id AS sourceGroupItemId, group_uid AS groupUid,
        sort_order AS sortOrder, status, claimed_by_account_id AS claimedByAccountId,
        attempt_count AS attemptCount, last_error AS lastError, started_at AS startedAt,
        finished_at AS finishedAt, updated_at AS updatedAt
      FROM run_items WHERE run_id = ? ORDER BY sort_order, id
    `).all(runId) as Array<Record<string, unknown>>
    return rows.map(rowToItem)
  }

  metrics(runId: number): RunMetrics {
    const row = this.client.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
      FROM run_items WHERE run_id = ?
    `).get(runId) as Record<string, number | null>
    const total = Number(row.total ?? 0)
    const pending = Number(row.pending ?? 0)
    const processing = Number(row.processing ?? 0)
    const success = Number(row.success ?? 0)
    const failed = Number(row.failed ?? 0)
    const skipped = Number(row.skipped ?? 0)
    const finished = success + failed + skipped
    return { total, pending, processing, success, failed, skipped, remaining: pending + processing, progressPercent: total === 0 ? 0 : Math.round((finished / total) * 100) }
  }

  pause(runId: number): RunDetails {
    const current = this.requireRun(runId)
    if (current.run.status === 'completed') throw new Error('Phiên đã hoàn tất nên không thể pause.')
    if (current.run.status === 'paused') return current
    const now = Date.now()
    this.client.prepare(`UPDATE runs SET status = 'paused', paused_at = ?, updated_at = ? WHERE id = ?`).run(now, now, runId)
    this.client.prepare(`UPDATE page_tabs SET status = 'paused', updated_at = ? WHERE id = (SELECT page_tab_id FROM runs WHERE id = ?)`).run(now, runId)
    this.addEvent(runId, 'run_paused', null, now)
    return this.requireRun(runId)
  }

  resume(runId: number): RunDetails {
    const resume = this.client.transaction(() => {
      const current = this.requireRun(runId)
      if (current.run.status === 'completed') throw new Error('Phiên đã hoàn tất; hãy tạo phiên mới từ Group Set gốc.')
      if (current.run.status === 'stopped' || current.run.status === 'failed') throw new Error('Phiên đã kết thúc; hãy tạo phiên mới từ Group Set gốc.')
      const now = Date.now()
      const processingItemsPreserved = current.metrics.processing
      this.client.prepare(`
        UPDATE runs SET status = 'running', started_at = COALESCE(started_at, ?),
          paused_at = NULL, completed_at = NULL, updated_at = ? WHERE id = ?
      `).run(now, now, runId)
      this.client.prepare(`UPDATE page_tabs SET status = 'running', updated_at = ? WHERE id = (SELECT page_tab_id FROM runs WHERE id = ?)`).run(now, runId)
      this.addEvent(runId, 'run_resumed', { processingItemsPreserved }, now)
    })
    resume()
    return this.requireRun(runId)
  }

  stop(runId: number, reason: 'manual' | 'daily_rollover' = 'manual'): RunDetails {
    const stop = this.client.transaction(() => {
      const current = this.requireRun(runId)
      if (current.run.status === 'stopped') return
      if (current.run.status === 'failed') throw new Error('Phiên đã thất bại nên không thể Stop lại.')
      const now = Date.now()
      const releasedClaims = this.client.prepare(`
        UPDATE run_items SET status = 'pending', claimed_by_account_id = NULL, started_at = NULL,
          finished_at = NULL, updated_at = ? WHERE run_id = ? AND status = 'processing'
      `).run(now, runId).changes
      this.client.prepare(`
        UPDATE runs SET status = 'stopped', paused_at = NULL, completed_at = COALESCE(completed_at, ?),
          updated_at = ? WHERE id = ?
      `).run(now, now, runId)
      this.client.prepare(`UPDATE page_tabs SET status = 'stopped', updated_at = ? WHERE id = (SELECT page_tab_id FROM runs WHERE id = ?)`).run(now, runId)
      this.addEvent(runId, 'run_stopped', { reason, releasedClaims }, now)
    })
    stop()
    return this.requireRun(runId)
  }

  claimNext(runId: number, accountId?: number): RunItem | null {
    const ownerAccountId = claimOwnerAccountId(accountId)
    const claim = this.client.transaction(() => {
      const current = this.requireRun(runId)
      if (current.run.status !== 'running') throw new Error('Run phải ở trạng thái running trước khi lấy item tiếp theo.')
      const row = this.client.prepare(`
        SELECT id FROM run_items
        WHERE run_id = ? AND status = 'pending' AND claimed_by_account_id IS NULL
        ORDER BY sort_order, id LIMIT 1
      `).get(runId) as { id: number } | undefined
      if (!row) { this.finishIfExhausted(runId); return null }
      const now = Date.now()
      const changed = this.client.prepare(`
        UPDATE run_items SET status = 'processing', claimed_by_account_id = ?, attempt_count = attempt_count + 1,
          last_error = NULL, started_at = ?, finished_at = NULL, updated_at = ?
        WHERE id = ? AND run_id = ? AND status = 'pending' AND claimed_by_account_id IS NULL
      `).run(ownerAccountId, now, now, row.id, runId).changes
      if (changed !== 1) throw new Error('Run item vừa được worker khác nhận; thử lấy item tiếp theo.')
      const item = this.getItem(row.id)
      this.addEvent(runId, 'item_claimed', { itemId: row.id, accountId: ownerAccountId, groupUid: item.groupUid }, now)
      return item
    })
    return claim()
  }

  releaseItem(payload: { runId: number; itemId: number; accountId?: number; errorMessage?: string }): RunDetails {
    const ownerAccountId = claimOwnerAccountId(payload.accountId)
    const release = this.client.transaction(() => {
      const current = this.requireRun(payload.runId)
      if (current.run.status !== 'running' && current.run.status !== 'paused') throw new Error('Run không ở trạng thái có thể trả item về hàng chờ.')
      const now = Date.now()
      const errorMessage = payload.errorMessage?.trim() || null
      const changed = this.client.prepare(`
        UPDATE run_items SET status = 'pending', claimed_by_account_id = NULL, last_error = ?,
          started_at = NULL, finished_at = NULL, updated_at = ?
        WHERE id = ? AND run_id = ? AND status = 'processing' AND claimed_by_account_id = ?
      `).run(errorMessage, now, payload.itemId, payload.runId, ownerAccountId).changes
      if (changed !== 1) throw new Error('Run item không tồn tại, không còn processing hoặc claim không thuộc account hiện tại.')
      this.addEvent(payload.runId, 'item_released', { itemId: payload.itemId, accountId: ownerAccountId, reason: errorMessage }, now)
    })
    release()
    return this.requireRun(payload.runId)
  }

  completeItem(payload: CompleteRunItemPayload): RunDetails {
    const ownerAccountId = claimOwnerAccountId(payload.accountId)
    const complete = this.client.transaction(() => {
      const current = this.requireRun(payload.runId)
      if (current.run.status !== 'running' && current.run.status !== 'paused') throw new Error('Run không ở trạng thái có thể cập nhật item.')
      const errorMessage = payload.status === 'failed' ? payload.errorMessage?.trim() || 'Unknown error' : null
      const now = Date.now()
      const changed = this.client.prepare(`
        UPDATE run_items SET status = ?, claimed_by_account_id = NULL, last_error = ?, finished_at = ?, updated_at = ?
        WHERE id = ? AND run_id = ? AND status = 'processing' AND claimed_by_account_id = ?
      `).run(payload.status, errorMessage, now, now, payload.itemId, payload.runId, ownerAccountId).changes
      if (changed !== 1) throw new Error('Run item không tồn tại, không còn processing hoặc claim không thuộc account hiện tại.')
      this.addEvent(payload.runId, `item_${payload.status}`, { itemId: payload.itemId, accountId: ownerAccountId }, now)
      this.finishIfExhausted(payload.runId)
    })
    complete()
    return this.requireRun(payload.runId)
  }

  private getItem(itemId: number): RunItem {
    const row = this.client.prepare(`
      SELECT id, run_id AS runId, source_group_item_id AS sourceGroupItemId, group_uid AS groupUid,
        sort_order AS sortOrder, status, claimed_by_account_id AS claimedByAccountId,
        attempt_count AS attemptCount, last_error AS lastError, started_at AS startedAt,
        finished_at AS finishedAt, updated_at AS updatedAt
      FROM run_items WHERE id = ?
    `).get(itemId) as Record<string, unknown> | undefined
    if (!row) throw new Error(`Không tìm thấy run item #${itemId}.`)
    return rowToItem(row)
  }

  private requireRun(runId: number): RunDetails {
    const run = this.get(runId)
    if (!run) throw new Error(`Không tìm thấy run #${runId}.`)
    return run
  }

  private finishIfExhausted(runId: number): void {
    const row = this.client.prepare(`SELECT COUNT(*) AS count FROM run_items WHERE run_id = ? AND status IN ('pending', 'processing')`).get(runId) as { count: number }
    if (row.count !== 0) return
    const now = Date.now()
    const changed = this.client.prepare(`
      UPDATE runs SET status = 'completed', completed_at = ?, paused_at = NULL, updated_at = ?
      WHERE id = ? AND status <> 'completed'
    `).run(now, now, runId).changes
    if (changed === 1) {
      this.client.prepare(`UPDATE page_tabs SET status = 'idle', updated_at = ? WHERE id = (SELECT page_tab_id FROM runs WHERE id = ?)`).run(now, runId)
      this.addEvent(runId, 'run_completed', this.metrics(runId), now)
    }
  }

  private addEvent(runId: number, eventType: string, payload: unknown, createdAt: number): void {
    this.client.prepare(`INSERT INTO run_events (run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)`).run(
      runId,
      eventType,
      payload === null ? null : JSON.stringify(payload),
      createdAt
    )
  }
}
