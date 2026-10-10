import type Database from 'better-sqlite3'

interface WorkspaceRow {
  id: number
  label: string
  configJson: string
}

function legacyPageId(label: string, configJson: string): number | null {
  if (!label.trim().endsWith(' · Tham gia nhóm')) return null
  let raw: unknown
  try {
    raw = JSON.parse(configJson)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record.pageBusinessType !== undefined) return null
  const pageTabId = Number(record.pageTabId)
  return Number.isInteger(pageTabId) && pageTabId > 0 ? pageTabId : null
}

export function applyPageJoinGroupOwnershipRepair(client: Database.Database): void {
  const repair = client.transaction(() => {
    const pageExists = client.prepare('SELECT 1 FROM page_tabs WHERE id = ?')
    const rows = client.prepare(`
      SELECT id, label, config_json AS configJson
      FROM action_workspaces
      WHERE workspace_type = 'group'
      ORDER BY id
    `).all() as WorkspaceRow[]
    const update = client.prepare('UPDATE action_workspaces SET config_json = ? WHERE id = ?')

    for (const row of rows) {
      const pageTabId = legacyPageId(row.label, row.configJson)
      if (!pageTabId || !pageExists.get(pageTabId)) continue
      const raw = JSON.parse(row.configJson) as Record<string, unknown>
      update.run(JSON.stringify({ ...raw, pageBusinessType: 'join_group', pageTabId }), row.id)
    }
  })

  repair()
}
