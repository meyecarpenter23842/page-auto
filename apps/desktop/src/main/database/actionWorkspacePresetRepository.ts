import type Database from 'better-sqlite3'
import {
  ACTION_WORKSPACE_TYPES,
  type ActionWorkspacePresetRecord,
  type ActionWorkspaceType,
  type SaveActionWorkspacePresetInput
} from '../../shared/actionWorkspaces'

const forbiddenConfigKey = /^(password|cookie|twoFactorSecret|2fa|token|secret|credential|passphrase|otp|proxyPassword|emailPassword|newPassword|currentPassword)$/i

function workspaceType(value: string): ActionWorkspaceType {
  if (!(ACTION_WORKSPACE_TYPES as readonly string[]).includes(value)) throw new Error('Loại workspace preset không hợp lệ.')
  return value as ActionWorkspaceType
}

function normalizeName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Tên preset là bắt buộc.')
  if (name.length > 120) throw new Error('Tên preset dài tối đa 120 ký tự.')
  return name
}

function assertNoSecretKeys(value: unknown, path = ''): void {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenConfigKey.test(key)) throw new Error(`${path}${key}: preset không được lưu secret.`)
    assertNoSecretKeys(child, `${path}${key}.`)
  }
}

function normalizeConfigJson(value: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Cấu hình preset phải là JSON hợp lệ.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Cấu hình preset phải là JSON object.')
  assertNoSecretKeys(parsed)
  return JSON.stringify(parsed)
}

function rowToPreset(row: Record<string, unknown>): ActionWorkspacePresetRecord {
  return {
    id: Number(row.id),
    type: workspaceType(String(row.workspaceType)),
    name: String(row.name),
    configJson: String(row.configJson),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt)
  }
}

export class ActionWorkspacePresetRepository {
  constructor(private readonly client: Database.Database) {}

  list(type: ActionWorkspaceType): ActionWorkspacePresetRecord[] {
    const normalizedType = workspaceType(type)
    const rows = this.client.prepare(`
      SELECT id, workspace_type AS workspaceType, name, config_json AS configJson,
             created_at AS createdAt, updated_at AS updatedAt
      FROM action_workspace_presets
      WHERE workspace_type = ?
      ORDER BY name COLLATE NOCASE, id
    `).all(normalizedType) as Array<Record<string, unknown>>
    return rows.map(rowToPreset)
  }

  save(input: SaveActionWorkspacePresetInput, now = Date.now()): ActionWorkspacePresetRecord {
    const type = workspaceType(input.type)
    const name = normalizeName(input.name)
    const configJson = normalizeConfigJson(input.configJson)
    this.client.prepare(`
      INSERT INTO action_workspace_presets(workspace_type, name, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_type, name) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).run(type, name, configJson, now, now)

    const row = this.client.prepare(`
      SELECT id, workspace_type AS workspaceType, name, config_json AS configJson,
             created_at AS createdAt, updated_at AS updatedAt
      FROM action_workspace_presets
      WHERE workspace_type = ? AND name = ?
    `).get(type, name) as Record<string, unknown> | undefined
    if (!row) throw new Error('Không thể đọc lại preset vừa lưu.')
    return rowToPreset(row)
  }

  delete(id: number): boolean {
    if (!Number.isInteger(id) || id < 1) throw new Error('Preset ID không hợp lệ.')
    return this.client.prepare('DELETE FROM action_workspace_presets WHERE id = ?').run(id).changes > 0
  }
}
