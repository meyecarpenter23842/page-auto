import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'

const packagedExecutable = resolve(import.meta.dirname, '../../..', 'dist', 'win-unpacked', 'PageAuto.exe')
const dataDirectory = mkdtempSync(join(tmpdir(), 'page-auto-packaged-legacy-'))
const databaseFile = join(dataDirectory, 'page-auto.sqlite')
const legacyConfig = JSON.stringify({
  pageBusinessType: 'page_wall_post',
  pageTabId: 42,
  legacyMarker: 'packaged-preserve'
})
const dirtyConfig = JSON.stringify({ opaque: 'dirty-row-must-survive' })

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function launchPackaged(label) {
  const result = spawnSync(packagedExecutable, [], {
    env: {
      ...process.env,
      PAGE_AUTO_SMOKE_TEST: '1',
      PAGE_AUTO_DATA_DIR: dataDirectory
    },
    encoding: 'utf8',
    timeout: 60_000
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  invariant(result.status === 0, `${label}: packaged app exited with status ${result.status}`)
}

function verifyDatabase(label) {
  const db = new Database(databaseFile, { readonly: true })
  try {
    const legacy = db.prepare(`
      SELECT workspace_type AS workspaceType, config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
      FROM action_workspaces WHERE label = 'Packaged Legacy Page Wall'
    `).get()
    const dirty = db.prepare(`
      SELECT workspace_type AS workspaceType, config_json AS configJson
      FROM action_workspaces WHERE label = 'Packaged Dirty Row'
    `).get()

    invariant(legacy?.workspaceType === 'interaction', `${label}: legacy Page binding was not normalized`)
    invariant(legacy?.configJson === legacyConfig, `${label}: legacy Page config changed`)
    invariant(legacy?.createdAt === 111 && legacy?.updatedAt === 222, `${label}: legacy timestamps changed`)
    invariant(dirty?.workspaceType === 'mystery_legacy', `${label}: dirty row was rewritten instead of preserved`)
    invariant(dirty?.configJson === dirtyConfig, `${label}: dirty row config changed`)
  } finally {
    db.close()
  }
}

try {
  invariant(existsSync(packagedExecutable), `Packaged executable not found: ${packagedExecutable}`)

  const seed = new Database(databaseFile)
  try {
    seed.exec(`
      CREATE TABLE __page_auto_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE action_workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workspace_type TEXT NOT NULL,
        label TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    seed.prepare(`
      INSERT INTO action_workspaces(workspace_type, label, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('page-wall-post', 'Packaged Legacy Page Wall', legacyConfig, 111, 222)
    seed.prepare(`
      INSERT INTO action_workspaces(workspace_type, label, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('mystery_legacy', 'Packaged Dirty Row', dirtyConfig, 333, 444)
  } finally {
    seed.close()
  }

  launchPackaged('first launch')
  verifyDatabase('first launch')
  launchPackaged('restart')
  verifyDatabase('restart')
  console.log('Packaged legacy DB smoke passed')
} finally {
  rmSync(dataDirectory, { recursive: true, force: true })
}
