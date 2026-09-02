import type Database from 'better-sqlite3'
import { parseGroupWorkspaceDraft, serializeGroupWorkspaceDraft } from '../../shared/groupWorkspaceConfig'
import { isPageBusinessType, type PageBusinessType } from '../../shared/pageBusinessBindings'

export const PAGE_BUSINESS_BINDING_STORAGE_SCHEMA_VERSION = 20
export const PAGE_BUSINESS_BINDING_STORAGE_MIGRATION_NAME = 'page_business_binding_storage'

interface WorkspaceRow {
  id: number
  workspaceType: string
  label: string
  configJson: string
  createdAt: number
  updatedAt: number
}

interface PageRow {
  id: number
  name: string
}

function objectConfig(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function pageIdOf(raw: Record<string, unknown>): number | null {
  const pageTabId = Number(raw.pageTabId)
  return Number.isInteger(pageTabId) && pageTabId > 0 ? pageTabId : null
}

function configWithoutLegacyIdentity(raw: Record<string, unknown>): string {
  const next = { ...raw }
  delete next.pageBusinessType
  delete next.pageTabId
  return JSON.stringify(next)
}

export function applyPageBusinessBindingStorageMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const applied = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(PAGE_BUSINESS_BINDING_STORAGE_SCHEMA_VERSION)
    if (applied) return

    client.exec(`
      CREATE TABLE IF NOT EXISTS page_business_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        page_tab_id INTEGER NOT NULL REFERENCES page_tabs(id) ON DELETE CASCADE,
        business_type TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(page_tab_id, business_type)
      );

      CREATE INDEX IF NOT EXISTS idx_page_business_bindings_type
        ON page_business_bindings(business_type, id);
    `)

    const pages = client.prepare('SELECT id, name FROM page_tabs ORDER BY id').all() as PageRow[]
    const pageById = new Map(pages.map((page) => [page.id, page] as const))
    const workspaces = client.prepare(`
      SELECT id, workspace_type AS workspaceType, label, config_json AS configJson,
             created_at AS createdAt, updated_at AS updatedAt
      FROM action_workspaces
      ORDER BY id
    `).all() as WorkspaceRow[]

    const insert = client.prepare(`
      INSERT OR IGNORE INTO page_business_bindings(
        page_tab_id, business_type, config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `)
    const deleteAccounts = client.prepare('DELETE FROM action_workspace_accounts WHERE workspace_id = ?')
    const deleteWorkspace = client.prepare('DELETE FROM action_workspaces WHERE id = ?')

    for (const workspace of workspaces) {
      const raw = objectConfig(workspace.configJson)
      if (!raw) continue
      const pageTabId = pageIdOf(raw)
      if (!pageTabId || !pageById.has(pageTabId)) continue

      let type: PageBusinessType | null = isPageBusinessType(raw.pageBusinessType)
        ? raw.pageBusinessType
        : null

      if (!type && workspace.workspaceType === 'group' && workspace.label.trim().endsWith('· Tham gia nhóm')) {
        type = 'join_group'
      }
      if (!type) continue

      const configJson = type === 'join_group'
        ? serializeGroupWorkspaceDraft(parseGroupWorkspaceDraft(workspace.configJson))
        : configWithoutLegacyIdentity(raw)

      insert.run(pageTabId, type, configJson, workspace.createdAt, workspace.updatedAt)
      deleteAccounts.run(workspace.id)
      deleteWorkspace.run(workspace.id)
    }

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(
      PAGE_BUSINESS_BINDING_STORAGE_SCHEMA_VERSION,
      PAGE_BUSINESS_BINDING_STORAGE_MIGRATION_NAME,
      Date.now()
    )
  })

  migrate()
}
