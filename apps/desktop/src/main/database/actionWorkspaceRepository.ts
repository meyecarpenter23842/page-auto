import type Database from 'better-sqlite3'
import {
  ACTION_WORKSPACE_TYPES,
  type ActionWorkspaceAccountInput,
  type ActionWorkspaceRecord,
  type ActionWorkspaceType,
  type CreateActionWorkspaceInput,
  type UpdateActionWorkspacePayload
} from '../../shared/actionWorkspaces'

interface WorkspaceRow {
  id: number
  workspaceType: string
  label: string
  configJson: string
  createdAt: number
  updatedAt: number
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} phải lớn hơn 0.`)
  return value
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} là bắt buộc.`)
  return normalized
}

function workspaceType(value: string): ActionWorkspaceType {
  if (!(ACTION_WORKSPACE_TYPES as readonly string[]).includes(value)) {
    throw new Error('Loại workspace không hợp lệ.')
  }
  return value as ActionWorkspaceType
}

function normalizeConfigJson(value: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Cấu hình workspace phải là JSON hợp lệ.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Cấu hình workspace phải là một JSON object.')
  }
  return JSON.stringify(parsed)
}

function normalizeAccounts(client: Database.Database, accounts: ActionWorkspaceAccountInput[]) {
  const seen = new Set<number>()
  const accountExists = client.prepare('SELECT 1 FROM accounts WHERE id = ?')
  return accounts.map((item, index) => {
    const accountId = positiveInteger(item.accountId, 'Account ID')
    if (seen.has(accountId)) throw new Error(`Account #${accountId} bị trùng trong workspace.`)
    if (!accountExists.get(accountId)) throw new Error(`Không tìm thấy account #${accountId}.`)
    seen.add(accountId)
    return { accountId, enabled: Boolean(item.enabled), sortOrder: index }
  })
}

function toWorkspaceRow(row: Record<string, unknown>): WorkspaceRow {
  return {
    id: Number(row.id),
    workspaceType: String(row.workspaceType),
    label: String(row.label),
    configJson: String(row.configJson),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt)
  }
}

export class ActionWorkspaceRepository {
  constructor(private readonly client: Database.Database) {}

  list(): ActionWorkspaceRecord[] {
    const rows = this.client.prepare(`
      SELECT
        id,
        workspace_type AS workspaceType,
        label,
        config_json AS configJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM action_workspaces
      ORDER BY id
    `).all() as Array<Record<string, unknown>>
    return rows.map((row) => this.hydrate(toWorkspaceRow(row)))
  }

  get(id: number): ActionWorkspaceRecord | null {
    positiveInteger(id, 'Workspace ID')
    const row = this.client.prepare(`
      SELECT
        id,
        workspace_type AS workspaceType,
        label,
        config_json AS configJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM action_workspaces
      WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined
    return row ? this.hydrate(toWorkspaceRow(row)) : null
  }

  create(input: CreateActionWorkspaceInput, now = Date.now()): ActionWorkspaceRecord {
    const type = workspaceType(input.type)
    const label = requiredText(input.label, 'Tên tab')
    const configJson = normalizeConfigJson(input.configJson)
    const accounts = normalizeAccounts(this.client, input.accounts ?? [])

    const create = this.client.transaction(() => {
      const result = this.client.prepare(`
        INSERT INTO action_workspaces(workspace_type, label, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(type, label, configJson, now, now)
      const id = Number(result.lastInsertRowid)
      this.replaceAccounts(id, accounts)
      return id
    })

    return this.require(create())
  }

  update(payload: UpdateActionWorkspacePayload, now = Date.now()): ActionWorkspaceRecord {
    const id = positiveInteger(payload.id, 'Workspace ID')
    const current = this.require(id)
    const label = payload.patch.label === undefined ? current.label : requiredText(payload.patch.label, 'Tên tab')
    const configJson = payload.patch.configJson === undefined ? current.configJson : normalizeConfigJson(payload.patch.configJson)
    const accounts = payload.patch.accounts === undefined ? undefined : normalizeAccounts(this.client, payload.patch.accounts)

    const update = this.client.transaction(() => {
      this.client.prepare(`
        UPDATE action_workspaces
        SET label = ?, config_json = ?, updated_at = ?
        WHERE id = ?
      `).run(label, configJson, now, id)
      if (accounts) this.replaceAccounts(id, accounts)
    })
    update()
    return this.require(id)
  }

  delete(id: number): boolean {
    positiveInteger(id, 'Workspace ID')
    return this.client.prepare('DELETE FROM action_workspaces WHERE id = ?').run(id).changes > 0
  }

  private require(id: number): ActionWorkspaceRecord {
    const record = this.get(id)
    if (!record) throw new Error(`Không tìm thấy workspace #${id}.`)
    return record
  }

  private hydrate(row: WorkspaceRow): ActionWorkspaceRecord {
    const accounts = this.client.prepare(`
      SELECT account_id AS accountId, sort_order AS sortOrder, enabled
      FROM action_workspace_accounts
      WHERE workspace_id = ?
      ORDER BY sort_order, id
    `).all(row.id) as Array<Record<string, unknown>>

    return {
      id: row.id,
      type: workspaceType(row.workspaceType),
      label: row.label,
      configJson: row.configJson,
      accounts: accounts.map((item) => ({
        accountId: Number(item.accountId),
        sortOrder: Number(item.sortOrder),
        enabled: Number(item.enabled) === 1
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  }

  private replaceAccounts(
    workspaceId: number,
    accounts: Array<{ accountId: number; enabled: boolean; sortOrder: number }>
  ): void {
    this.client.prepare('DELETE FROM action_workspace_accounts WHERE workspace_id = ?').run(workspaceId)
    const insert = this.client.prepare(`
      INSERT INTO action_workspace_accounts(workspace_id, account_id, sort_order, enabled)
      VALUES (?, ?, ?, ?)
    `)
    for (const item of accounts) {
      insert.run(workspaceId, item.accountId, item.sortOrder, item.enabled ? 1 : 0)
    }
  }
}
