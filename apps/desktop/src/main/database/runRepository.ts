import type Database from 'better-sqlite3'
import {
  GROUP_ORDER_MODES,
  POST_SELECTION_MODES,
  type GroupOrderMode,
  type PostSelectionMode
} from '../../shared/pageTabs'
import { PageTabPostBindingRepository } from './canonicalPostRepository'
import { RunRepository as CoreRunRepository } from './runRepositoryCore'

export type { RunRotationState } from './runRepositoryCore'

export type RunRotationWindowClosedStatus = 'closed_account_cycle' | 'closed_time_remaining_accounts'

export interface RunRotationWindowClosedState {
  key: string
  status: RunRotationWindowClosedStatus
  closedAt: number
  currentAccountId: number | null
  slotsCompletedThisTurn: number
  targetSlotsThisTurn: number
  groupRemaining: number
}

export interface RunRotationWindowState {
  dateKey: string | null
  activeWindowKey: string | null
  closedWindows: RunRotationWindowClosedState[]
}

function parseClosedWindow(value: unknown): RunRotationWindowClosedState | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const status = row.status
  if (status !== 'closed_account_cycle' && status !== 'closed_time_remaining_accounts') return null
  if (typeof row.key !== 'string' || !row.key) return null
  if (typeof row.closedAt !== 'number' || !Number.isFinite(row.closedAt)) return null

  return {
    key: row.key,
    status,
    closedAt: row.closedAt,
    currentAccountId: typeof row.currentAccountId === 'number' && Number.isInteger(row.currentAccountId)
      ? row.currentAccountId
      : null,
    slotsCompletedThisTurn: typeof row.slotsCompletedThisTurn === 'number' && Number.isFinite(row.slotsCompletedThisTurn)
      ? Math.max(0, Math.floor(row.slotsCompletedThisTurn))
      : 0,
    targetSlotsThisTurn: typeof row.targetSlotsThisTurn === 'number' && Number.isFinite(row.targetSlotsThisTurn)
      ? Math.max(0, Math.floor(row.targetSlotsThisTurn))
      : 0,
    groupRemaining: typeof row.groupRemaining === 'number' && Number.isFinite(row.groupRemaining)
      ? Math.max(0, Math.floor(row.groupRemaining))
      : 0
  }
}

function parsePostMode(value: unknown): PostSelectionMode {
  const normalized = String(value ?? '') as PostSelectionMode
  return POST_SELECTION_MODES.includes(normalized) ? normalized : 'sequential'
}

function parseGroupMode(value: unknown): GroupOrderMode {
  const normalized = String(value ?? '') as GroupOrderMode
  return GROUP_ORDER_MODES.includes(normalized) ? normalized : 'sequential'
}

function shuffle<T>(items: readonly T[]): T[] {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = next[index]
    const swap = next[swapIndex]
    if (current === undefined || swap === undefined) continue
    next[index] = swap
    next[swapIndex] = current
  }
  return next
}

export class RunRepository extends CoreRunRepository {
  private readonly canonicalPagePosts: PageTabPostBindingRepository

  constructor(private readonly windowStateClient: Database.Database) {
    super(windowStateClient)
    this.canonicalPagePosts = new PageTabPostBindingRepository(windowStateClient)
  }

  override createForPageTab(pageTabId: number) {
    const pageExists = this.windowStateClient.prepare(`
      SELECT 1 AS found
      FROM page_tabs
      WHERE id = ?
      LIMIT 1
    `).get(pageTabId) as { found: number } | undefined

    if (!pageExists) return super.createForPageTab(pageTabId)

    const enabledAccount = this.windowStateClient.prepare(`
      SELECT 1 AS found
      FROM page_tab_accounts
      WHERE page_tab_id = ? AND enabled = 1
      LIMIT 1
    `).get(pageTabId) as { found: number } | undefined

    if (!enabledAccount) {
      throw new Error('Page Tab không có tài khoản được bật để chạy.')
    }

    // Runtime cutover is binding-first. Presence is checked separately from the
    // resolved list so a Page with bindings that are all disabled does not fall
    // back to stale legacy copies.
    const canonicalBindings = this.canonicalPagePosts.list(pageTabId)
    const canonicalPosts = canonicalBindings.length > 0
      ? this.canonicalPagePosts.resolveSnapshotPosts(pageTabId)
      : null
    const modeRow = canonicalPosts === null
      ? null
      : this.windowStateClient.prepare(`
          SELECT post_selection_mode AS mode
          FROM page_tabs
          WHERE id = ?
        `).get(pageTabId) as { mode: unknown } | undefined
    const groupModeRow = this.windowStateClient.prepare(`
      SELECT group_order_mode AS mode
      FROM page_tabs
      WHERE id = ?
    `).get(pageTabId) as { mode: unknown } | undefined
    const groupOrderMode = parseGroupMode(groupModeRow?.mode)

    const created = super.createForPageTab(pageTabId)
    const snapshot = {
      ...created.run.snapshot,
      groupOrderMode,
      ...(canonicalPosts === null
        ? {}
        : {
            postMode: parsePostMode(modeRow?.mode),
            posts: canonicalPosts.map((post) => ({
              ...post,
              variants: [...post.variants],
              image: { ...post.image }
            }))
          })
    }
    const now = Date.now()

    try {
      const lockRunSnapshot = this.windowStateClient.transaction(() => {
        if (groupOrderMode === 'random') {
          const runItems = this.windowStateClient.prepare(`
            SELECT id
            FROM run_items
            WHERE run_id = ?
            ORDER BY sort_order, id
          `).all(created.run.id) as Array<{ id: number }>
          const shuffled = shuffle(runItems)
          const updateOrder = this.windowStateClient.prepare(`
            UPDATE run_items
            SET sort_order = ?, updated_at = ?
            WHERE id = ? AND run_id = ?
          `)
          shuffled.forEach((item, index) => updateOrder.run(index, now, item.id, created.run.id))
        }

        this.windowStateClient.prepare(`
          UPDATE runs
          SET snapshot_json = ?, updated_at = ?
          WHERE id = ?
        `).run(JSON.stringify(snapshot), now, created.run.id)

        const event = this.windowStateClient.prepare(`
          SELECT id, payload_json AS payloadJson
          FROM run_events
          WHERE run_id = ? AND event_type = 'run_created'
          ORDER BY id DESC
          LIMIT 1
        `).get(created.run.id) as { id: number; payloadJson: string | null } | undefined
        if (!event?.payloadJson) return
        try {
          const payload = JSON.parse(event.payloadJson) as Record<string, unknown>
          payload.groupOrderMode = groupOrderMode
          if (canonicalPosts !== null) payload.postCount = canonicalPosts.length
          this.windowStateClient.prepare(`
            UPDATE run_events
            SET payload_json = ?
            WHERE id = ?
          `).run(JSON.stringify(payload), event.id)
        } catch {
          // Snapshot/run_items are the source of truth. Keep a malformed
          // historical event untouched instead of failing an otherwise valid Start.
        }
      })
      lockRunSnapshot()
    } catch (error) {
      // Core creation already committed. Roll it back if locking the per-run
      // Group order/snapshot fails so a broken active run cannot block Start.
      this.windowStateClient.prepare('DELETE FROM runs WHERE id = ?').run(created.run.id)
      throw error
    }

    const refreshed = this.get(created.run.id)
    if (!refreshed) throw new Error('Không thể đọc lại phiên sau khi khóa snapshot cấu hình runtime.')
    return refreshed
  }

  getRotationWindowState(runId: number): RunRotationWindowState | null {
    const row = this.windowStateClient.prepare(`
      SELECT payload_json AS payloadJson
      FROM run_events
      WHERE run_id = ? AND event_type = 'rotation_window_state'
      ORDER BY id DESC
      LIMIT 1
    `).get(runId) as { payloadJson: string | null } | undefined

    if (!row?.payloadJson) return null
    try {
      const parsed = JSON.parse(row.payloadJson) as Record<string, unknown>
      const closedWindows = Array.isArray(parsed.closedWindows)
        ? parsed.closedWindows.map(parseClosedWindow).filter((entry): entry is RunRotationWindowClosedState => entry !== null)
        : []
      return {
        dateKey: typeof parsed.dateKey === 'string' ? parsed.dateKey : null,
        activeWindowKey: typeof parsed.activeWindowKey === 'string' ? parsed.activeWindowKey : null,
        closedWindows
      }
    } catch {
      return null
    }
  }

  saveRotationWindowState(runId: number, state: RunRotationWindowState): void {
    if (!this.get(runId)) throw new Error(`Không tìm thấy run #${runId}.`)
    this.windowStateClient.prepare(`
      INSERT INTO run_events (run_id, event_type, payload_json, created_at)
      VALUES (?, 'rotation_window_state', ?, ?)
    `).run(runId, JSON.stringify({
      dateKey: state.dateKey,
      activeWindowKey: state.activeWindowKey,
      closedWindows: state.closedWindows.map((entry) => ({ ...entry }))
    }), Date.now())
  }
}
