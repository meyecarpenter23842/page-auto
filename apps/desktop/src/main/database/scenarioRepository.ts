import type Database from 'better-sqlite3'
import {
  SCENARIO_ACTION_CATEGORIES,
  type CreateScenarioActionInput,
  type CreateScenarioInput,
  type MoveScenarioActionPayload,
  type ScenarioActionCategory,
  type ScenarioActionRecord,
  type ScenarioDetails,
  type ScenarioSummary,
  type UpdateScenarioActionPayload,
  type UpdateScenarioPayload
} from '../../shared/scenarios'

interface ScenarioRow {
  id: number
  name: string
  actionCount: number
  randomActionOrder: number
  runtimeLimitMinutes: number | null
  createdAt: number
  updatedAt: number
}

interface ScenarioActionRow {
  id: number
  scenarioId: number
  actionType: string
  label: string
  category: string
  orderIndex: number
  configJson: string
  enabled: number
  createdAt: number
  updatedAt: number
}

const scenarioColumns = `
  s.id, s.name,
  (SELECT COUNT(*) FROM scenario_actions a WHERE a.scenario_id = s.id) AS actionCount,
  s.random_action_order AS randomActionOrder,
  s.runtime_limit_minutes AS runtimeLimitMinutes,
  s.created_at AS createdAt,
  s.updated_at AS updatedAt
`

const actionColumns = `
  id, scenario_id AS scenarioId, action_type AS actionType, label, category,
  order_index AS orderIndex, config_json AS configJson, enabled,
  created_at AS createdAt, updated_at AS updatedAt
`

const forbiddenConfigKey = /(password|cookie|2fa|token|secret|credential|passphrase|otp)/i

function normalizeName(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} không được để trống.`)
  if (normalized.length > 120) throw new Error(`${field} dài tối đa 120 ký tự.`)
  return normalized
}

function normalizeActionType(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)) {
    throw new Error('Mã action chỉ dùng a-z, 0-9, dấu chấm, gạch ngang hoặc gạch dưới.')
  }
  return normalized
}

function normalizeCategory(value: ScenarioActionCategory): ScenarioActionCategory {
  if (!SCENARIO_ACTION_CATEGORIES.includes(value)) throw new Error('Nhóm action không hợp lệ.')
  return value
}

function normalizeRuntimeLimit(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null
  const normalized = Math.floor(value)
  if (!Number.isFinite(normalized) || normalized < 1 || normalized > 1440) {
    throw new Error('Giới hạn thời gian phải từ 1 đến 1440 phút hoặc để trống.')
  }
  return normalized
}

function assertSecretFree(value: unknown): void {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenConfigKey.test(key)) throw new Error('Config kịch bản không được lưu secret.')
    assertSecretFree(child)
  }
}

function normalizeConfigJson(value = '{}'): string {
  if (value.length > 20_000) throw new Error('Config action vượt giới hạn 20 KB.')
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Config action phải là JSON hợp lệ.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Config action phải là JSON object.')
  assertSecretFree(parsed)
  return JSON.stringify(parsed)
}

function toSummary(row: ScenarioRow): ScenarioSummary {
  return {
    id: row.id,
    name: row.name,
    actionCount: row.actionCount,
    randomActionOrder: row.randomActionOrder === 1,
    runtimeLimitMinutes: row.runtimeLimitMinutes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toAction(row: ScenarioActionRow): ScenarioActionRecord {
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    actionType: row.actionType,
    label: row.label,
    category: row.category as ScenarioActionCategory,
    orderIndex: row.orderIndex,
    configJson: row.configJson,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export class ScenarioRepository {
  constructor(private readonly client: Database.Database) {}

  list(): ScenarioSummary[] {
    const rows = this.client.prepare(`SELECT ${scenarioColumns} FROM scenarios s ORDER BY s.updated_at DESC, s.id DESC`).all() as ScenarioRow[]
    return rows.map(toSummary)
  }

  get(id: number): ScenarioDetails | null {
    const row = this.client.prepare(`SELECT ${scenarioColumns} FROM scenarios s WHERE s.id = ?`).get(id) as ScenarioRow | undefined
    if (!row) return null
    const actions = this.client.prepare(`SELECT ${actionColumns} FROM scenario_actions WHERE scenario_id = ? ORDER BY order_index ASC, id ASC`).all(id) as ScenarioActionRow[]
    return { ...toSummary(row), actions: actions.map(toAction) }
  }

  create(input: CreateScenarioInput, now = Date.now()): ScenarioDetails {
    const name = normalizeName(input.name, 'Tên kịch bản')
    const runtimeLimit = normalizeRuntimeLimit(input.runtimeLimitMinutes)
    const result = this.client.prepare(`
      INSERT INTO scenarios (name, random_action_order, runtime_limit_minutes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, input.randomActionOrder ? 1 : 0, runtimeLimit, now, now)
    return this.require(Number(result.lastInsertRowid))
  }

  update(payload: UpdateScenarioPayload, now = Date.now()): ScenarioDetails {
    const current = this.require(payload.id)
    const name = payload.patch.name === undefined ? current.name : normalizeName(payload.patch.name, 'Tên kịch bản')
    const randomActionOrder = payload.patch.randomActionOrder ?? current.randomActionOrder
    const runtimeLimitMinutes = payload.patch.runtimeLimitMinutes === undefined
      ? current.runtimeLimitMinutes
      : normalizeRuntimeLimit(payload.patch.runtimeLimitMinutes)
    this.client.prepare(`
      UPDATE scenarios SET name = ?, random_action_order = ?, runtime_limit_minutes = ?, updated_at = ? WHERE id = ?
    `).run(name, randomActionOrder ? 1 : 0, runtimeLimitMinutes, now, payload.id)
    return this.require(payload.id)
  }

  delete(id: number): boolean {
    return this.client.prepare('DELETE FROM scenarios WHERE id = ?').run(id).changes === 1
  }

  createAction(input: CreateScenarioActionInput, now = Date.now()): ScenarioDetails {
    this.require(input.scenarioId)
    const label = normalizeName(input.label, 'Tên hành động')
    const actionType = normalizeActionType(input.actionType)
    const category = normalizeCategory(input.category)
    const configJson = normalizeConfigJson(input.configJson)
    const next = this.client.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next FROM scenario_actions WHERE scenario_id = ?').get(input.scenarioId) as { next: number }
    this.client.prepare(`
      INSERT INTO scenario_actions (scenario_id, action_type, label, category, order_index, config_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.scenarioId, actionType, label, category, next.next, configJson, input.enabled === false ? 0 : 1, now, now)
    this.touch(input.scenarioId, now)
    return this.require(input.scenarioId)
  }

  updateAction(payload: UpdateScenarioActionPayload, now = Date.now()): ScenarioDetails {
    const current = this.getAction(payload.id)
    if (!current) throw new Error(`Không tìm thấy action #${payload.id}.`)
    const label = payload.patch.label === undefined ? current.label : normalizeName(payload.patch.label, 'Tên hành động')
    const actionType = payload.patch.actionType === undefined ? current.actionType : normalizeActionType(payload.patch.actionType)
    const category = payload.patch.category === undefined ? current.category : normalizeCategory(payload.patch.category)
    const configJson = payload.patch.configJson === undefined ? current.configJson : normalizeConfigJson(payload.patch.configJson)
    const enabled = payload.patch.enabled ?? current.enabled
    this.client.prepare(`
      UPDATE scenario_actions SET action_type = ?, label = ?, category = ?, config_json = ?, enabled = ?, updated_at = ? WHERE id = ?
    `).run(actionType, label, category, configJson, enabled ? 1 : 0, now, payload.id)
    this.touch(current.scenarioId, now)
    return this.require(current.scenarioId)
  }

  deleteAction(id: number, now = Date.now()): ScenarioDetails {
    const current = this.getAction(id)
    if (!current) throw new Error(`Không tìm thấy action #${id}.`)
    const transaction = this.client.transaction(() => {
      this.client.prepare('DELETE FROM scenario_actions WHERE id = ?').run(id)
      this.normalizeOrder(current.scenarioId, now)
      this.touch(current.scenarioId, now)
    })
    transaction()
    return this.require(current.scenarioId)
  }

  moveAction(payload: MoveScenarioActionPayload, now = Date.now()): ScenarioDetails {
    const transaction = this.client.transaction(() => {
      const actions = this.client.prepare(`SELECT ${actionColumns} FROM scenario_actions WHERE scenario_id = ? ORDER BY order_index ASC, id ASC`).all(payload.scenarioId) as ScenarioActionRow[]
      const index = actions.findIndex((item) => item.id === payload.actionId)
      if (index < 0) throw new Error('Action không thuộc kịch bản đã chọn.')
      const target = payload.direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= actions.length) return
      const first = actions[index]
      const second = actions[target]
      this.client.prepare('UPDATE scenario_actions SET order_index = ?, updated_at = ? WHERE id = ?').run(second.orderIndex, now, first.id)
      this.client.prepare('UPDATE scenario_actions SET order_index = ?, updated_at = ? WHERE id = ?').run(first.orderIndex, now, second.id)
      this.touch(payload.scenarioId, now)
    })
    transaction()
    return this.require(payload.scenarioId)
  }

  private getAction(id: number): ScenarioActionRecord | null {
    const row = this.client.prepare(`SELECT ${actionColumns} FROM scenario_actions WHERE id = ?`).get(id) as ScenarioActionRow | undefined
    return row ? toAction(row) : null
  }

  private normalizeOrder(scenarioId: number, now: number): void {
    const rows = this.client.prepare('SELECT id FROM scenario_actions WHERE scenario_id = ? ORDER BY order_index ASC, id ASC').all(scenarioId) as { id: number }[]
    const update = this.client.prepare('UPDATE scenario_actions SET order_index = ?, updated_at = ? WHERE id = ?')
    rows.forEach((row, index) => update.run(index, now, row.id))
  }

  private touch(id: number, now: number): void {
    this.client.prepare('UPDATE scenarios SET updated_at = ? WHERE id = ?').run(now, id)
  }

  private require(id: number): ScenarioDetails {
    const scenario = this.get(id)
    if (!scenario) throw new Error(`Không tìm thấy kịch bản #${id}.`)
    return scenario
  }
}
