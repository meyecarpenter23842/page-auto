import type Database from 'better-sqlite3'
import {
  serializePageBusinessBindingConfig,
  type GenericPageBusinessType
} from '../../shared/pageBusinessBindings'

export const PAGE_BUSINESS_BINDING_SCHEMA_VERSION = 19
export const PAGE_BUSINESS_BINDING_MIGRATION_NAME = 'page_business_explicit_bindings'

interface PageRow {
  id: number
  name: string
}

interface WorkspaceRow {
  configJson: string
}

const legacyBusinesses: Array<{ type: GenericPageBusinessType; suffix: string }> = [
  { type: 'group_post', suffix: 'Đăng Nhóm' },
  { type: 'page_wall_post', suffix: 'Đăng Tường' },
  { type: 'page_edit', suffix: 'Sửa Page' }
]

export function applyPageBusinessBindingMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const applied = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(PAGE_BUSINESS_BINDING_SCHEMA_VERSION)
    if (applied) return

    const pages = client.prepare('SELECT id, name FROM page_tabs ORDER BY id').all() as PageRow[]
    const workspaceRows = client.prepare('SELECT config_json AS configJson FROM action_workspaces').all() as WorkspaceRow[]
    const existing = new Set<string>()
    for (const row of workspaceRows) {
      try {
        const raw = JSON.parse(row.configJson) as Record<string, unknown>
        const type = String(raw.pageBusinessType ?? '')
        const pageTabId = Number(raw.pageTabId)
        if (type && Number.isInteger(pageTabId) && pageTabId > 0) existing.add(`${type}:${pageTabId}`)
      } catch {
        // Existing normal Action workspaces are not Page bindings.
      }
    }

    const insert = client.prepare(`
      INSERT INTO action_workspaces (workspace_type, label, config_json, created_at, updated_at)
      VALUES ('interaction', ?, ?, ?, ?)
    `)
    const now = Date.now()
    for (const page of pages) {
      for (const business of legacyBusinesses) {
        const key = `${business.type}:${page.id}`
        if (existing.has(key)) continue
        insert.run(
          `${page.name} · ${business.suffix}`,
          serializePageBusinessBindingConfig(business.type, page.id),
          now,
          now
        )
        existing.add(key)
      }
    }

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(PAGE_BUSINESS_BINDING_SCHEMA_VERSION, PAGE_BUSINESS_BINDING_MIGRATION_NAME, Date.now())
  })

  migrate()
}
