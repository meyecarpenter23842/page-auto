import type Database from 'better-sqlite3'
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

export class RunRepository extends CoreRunRepository {
  constructor(private readonly windowStateClient: Database.Database) {
    super(windowStateClient)
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

    return super.createForPageTab(pageTabId)
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
