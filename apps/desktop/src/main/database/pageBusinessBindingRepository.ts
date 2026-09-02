import type Database from 'better-sqlite3'
import {
  PAGE_BUSINESS_TYPES,
  isPageBusinessType,
  type CreatePageBusinessBindingInput,
  type PageBusinessBindingRecord,
  type PageBusinessType,
  type UpdatePageBusinessBindingPayload
} from '../../shared/pageBusinessBindings'

interface BindingRow {
  id: number
  pageTabId: number
  businessType: string
  configJson: string
  createdAt: number
  updatedAt: number
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} phải lớn hơn 0.`)
  return value
}

function normalizeConfigJson(value: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Cấu hình Page business phải là JSON hợp lệ.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Cấu hình Page business phải là một JSON object.')
  }
  return JSON.stringify(parsed)
}

function businessType(value: unknown): PageBusinessType {
  if (!isPageBusinessType(value)) throw new Error(`Nghiệp vụ Page không hợp lệ. Hỗ trợ: ${PAGE_BUSINESS_TYPES.join(', ')}.`)
  return value
}

function toRecord(row: BindingRow): PageBusinessBindingRecord {
  return {
    id: row.id,
    pageTabId: row.pageTabId,
    businessType: businessType(row.businessType),
    configJson: row.configJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export class PageBusinessBindingRepository {
  constructor(private readonly client: Database.Database) {}

  list(type?: PageBusinessType): PageBusinessBindingRecord[] {
    const rows = (type
      ? this.client.prepare(`
          SELECT id, page_tab_id AS pageTabId, business_type AS businessType,
                 config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
          FROM page_business_bindings
          WHERE business_type = ?
          ORDER BY id
        `).all(businessType(type))
      : this.client.prepare(`
          SELECT id, page_tab_id AS pageTabId, business_type AS businessType,
                 config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
          FROM page_business_bindings
          ORDER BY id
        `).all()) as BindingRow[]
    return rows.map(toRecord)
  }

  get(id: number): PageBusinessBindingRecord | null {
    const row = this.client.prepare(`
      SELECT id, page_tab_id AS pageTabId, business_type AS businessType,
             config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
      FROM page_business_bindings
      WHERE id = ?
    `).get(positiveInteger(id, 'Binding ID')) as BindingRow | undefined
    return row ? toRecord(row) : null
  }

  create(input: CreatePageBusinessBindingInput, now = Date.now()): PageBusinessBindingRecord {
    const pageTabId = positiveInteger(input.pageTabId, 'Page Tab ID')
    const type = businessType(input.businessType)
    const configJson = normalizeConfigJson(input.configJson)
    if (!this.client.prepare('SELECT 1 FROM page_tabs WHERE id = ?').get(pageTabId)) {
      throw new Error(`Không tìm thấy Page #${pageTabId}.`)
    }
    try {
      const result = this.client.prepare(`
        INSERT INTO page_business_bindings(page_tab_id, business_type, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(pageTabId, type, configJson, now, now)
      return this.require(Number(result.lastInsertRowid))
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error('Page đã được thêm vào nghiệp vụ này.')
      }
      throw error
    }
  }

  update(payload: UpdatePageBusinessBindingPayload, now = Date.now()): PageBusinessBindingRecord {
    const id = positiveInteger(payload.id, 'Binding ID')
    const current = this.require(id)
    const configJson = payload.patch.configJson === undefined
      ? current.configJson
      : normalizeConfigJson(payload.patch.configJson)
    this.client.prepare(`
      UPDATE page_business_bindings
      SET config_json = ?, updated_at = ?
      WHERE id = ?
    `).run(configJson, now, id)
    return this.require(id)
  }

  delete(id: number): boolean {
    return this.client.prepare('DELETE FROM page_business_bindings WHERE id = ?')
      .run(positiveInteger(id, 'Binding ID')).changes > 0
  }

  private require(id: number): PageBusinessBindingRecord {
    const record = this.get(id)
    if (!record) throw new Error(`Không tìm thấy Page business binding #${id}.`)
    return record
  }
}
