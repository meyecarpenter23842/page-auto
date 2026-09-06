import type Database from 'better-sqlite3'
import { normalizePersistedActionWorkspaceType } from './actionWorkspaceCompatibility'

interface WorkspaceRow {
  id: number
  workspaceType: string
  configJson: string
}

/**
 * Repairs recognizable legacy workspace type tokens without changing schema or
 * deleting opaque rows. It deliberately runs on every database open so an old
 * or manually-copied database is healed even when its migration table is
 * already current.
 */
export function applyActionWorkspaceCompatibilityMigration(client: Database.Database): void {
  const repair = client.transaction(() => {
    const rows = client.prepare(`
      SELECT id, workspace_type AS workspaceType, config_json AS configJson
      FROM action_workspaces
      ORDER BY id
    `).all() as WorkspaceRow[]
    const update = client.prepare('UPDATE action_workspaces SET workspace_type = ? WHERE id = ?')

    for (const row of rows) {
      const normalized = normalizePersistedActionWorkspaceType(row.workspaceType, row.configJson)
      if (normalized && normalized !== row.workspaceType) update.run(normalized, row.id)
    }
  })

  repair()
}
