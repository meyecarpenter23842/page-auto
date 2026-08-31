import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { appSettings } from './schema'
import { ACCOUNT_GROUP_SCHEMA_VERSION, applyAccountGroupMigration } from './accountGroupMigration'
import { CANONICAL_POST_SCHEMA_VERSION, applyCanonicalPostMigration } from './canonicalPostMigration'
import { CONTENT_LIBRARY_SCHEMA_VERSION, applyContentLibraryMigration } from './contentLibraryMigration'
import { COPY_POST_SCHEMA_VERSION, applyCopyPostMigration } from './copyPostMigration'
import { HOTMAIL_SCHEMA_VERSION, applyHotmailMigration } from './hotmailMigration'
import { latestSchemaVersion, migrations } from './migrations'
import { PAGE_WALL_SCHEMA_VERSION, applyPageWallMigration } from './pageWallMigration'
import { SCENARIO_SCHEMA_VERSION, applyScenarioMigration } from './scenarioMigration'
import { STORY_SCHEMA_VERSION, applyStoryMigration } from './storyMigration'

export interface DatabaseRuntime {
  client: Database.Database
  close: () => void
}

interface AppliedMigrationRow {
  version: number
}

const migrationTableSql = `
  CREATE TABLE IF NOT EXISTS __page_auto_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );
`

export function initializeDatabase(databaseFile: string): DatabaseRuntime {
  mkdirSync(dirname(databaseFile), { recursive: true })

  const client = new Database(databaseFile)
  client.pragma('journal_mode = WAL')
  client.pragma('foreign_keys = ON')
  client.exec(migrationTableSql)

  const appliedRows = client
    .prepare('SELECT version FROM __page_auto_migrations ORDER BY version')
    .all() as AppliedMigrationRow[]
  const appliedVersions = new Set(appliedRows.map((row) => row.version))

  const applyPendingMigrations = client.transaction(() => {
    const insertMigration = client.prepare(
      'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
    )

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue
      }

      client.exec(migration.sql)
      insertMigration.run(migration.version, migration.name, Date.now())
    }
  })

  applyPendingMigrations()
  applyHotmailMigration(client)
  applyPageWallMigration(client)
  applyScenarioMigration(client)
  applyAccountGroupMigration(client)
  applyContentLibraryMigration(client)
  applyCanonicalPostMigration(client)
  applyCopyPostMigration(client)
  applyStoryMigration(client)

  const schemaVersion = Math.max(
    latestSchemaVersion,
    HOTMAIL_SCHEMA_VERSION,
    PAGE_WALL_SCHEMA_VERSION,
    SCENARIO_SCHEMA_VERSION,
    ACCOUNT_GROUP_SCHEMA_VERSION,
    CONTENT_LIBRARY_SCHEMA_VERSION,
    CANONICAL_POST_SCHEMA_VERSION,
    COPY_POST_SCHEMA_VERSION,
    STORY_SCHEMA_VERSION
  )
  const orm = drizzle(client)
  orm
    .insert(appSettings)
    .values({
      key: 'schema_version',
      value: String(schemaVersion),
      updatedAt: Date.now()
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: String(schemaVersion),
        updatedAt: Date.now()
      }
    })
    .run()

  return {
    client,
    close: () => client.close()
  }
}
