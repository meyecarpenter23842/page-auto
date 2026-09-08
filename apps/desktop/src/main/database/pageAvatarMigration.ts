import type Database from 'better-sqlite3'

export const PAGE_AVATAR_SCHEMA_VERSION = 21
export const PAGE_AVATAR_MIGRATION_NAME = 'page_avatar_preview'

export function applyPageAvatarMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const applied = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(PAGE_AVATAR_SCHEMA_VERSION)
    if (applied) return

    const columns = client.prepare("PRAGMA table_info('page_tabs')").all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'avatar_data_url')) {
      client.exec('ALTER TABLE page_tabs ADD COLUMN avatar_data_url TEXT;')
    }

    client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    ).run(PAGE_AVATAR_SCHEMA_VERSION, PAGE_AVATAR_MIGRATION_NAME, Date.now())
  })

  migrate()
}
