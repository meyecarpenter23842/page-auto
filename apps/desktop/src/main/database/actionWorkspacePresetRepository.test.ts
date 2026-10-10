import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { applyActionWorkspacePresetMigration } from './actionWorkspacePresetMigration'
import { ActionWorkspacePresetRepository } from './actionWorkspacePresetRepository'

let database: Database.Database | null = null

afterEach(() => {
  database?.close()
  database = null
})

function createDatabase(): Database.Database {
  database = new Database(':memory:')
  database.exec(`
    CREATE TABLE __page_auto_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)
  applyActionWorkspacePresetMigration(database)
  return database
}

describe('ActionWorkspacePresetRepository', () => {
  it('persists named presets per workspace type without account bindings', () => {
    const repository = new ActionWorkspacePresetRepository(createDatabase())
    const saved = repository.save({ type: 'change_info', name: 'Profile bán hàng', configJson: '{"version":1,"actions":{}}' }, 100)
    expect(saved).toMatchObject({ type: 'change_info', name: 'Profile bán hàng' })
    expect(repository.list('change_info')).toHaveLength(1)
    expect(repository.list('interaction')).toHaveLength(0)
  })

  it('updates the same type/name and rejects secret-like config keys', () => {
    const repository = new ActionWorkspacePresetRepository(createDatabase())
    const first = repository.save({ type: 'change_info', name: 'Ẩn thông tin', configJson: '{"version":1}' }, 100)
    const second = repository.save({ type: 'change_info', name: 'Ẩn thông tin', configJson: '{"version":1,"accountConcurrency":2}' }, 200)
    expect(second.id).toBe(first.id)
    expect(second.updatedAt).toBe(200)
    expect(() => repository.save({ type: 'change_info', name: 'bad', configJson: '{"newPassword":"secret"}' })).toThrow(/không được lưu secret/)
    expect(() => repository.save({ type: 'change_info', name: 'semantic-action', configJson: '{"version":1,"actions":{"change_password":{"enabled":false}}}' })).not.toThrow()
  })
})
