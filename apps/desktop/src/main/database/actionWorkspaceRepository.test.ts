import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { ActionWorkspaceRepository } from './actionWorkspaceRepository'

const tempDirectories: string[] = []
const runtimes: ReturnType<typeof initializeDatabase>[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-action-workspaces-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  runtimes.push(runtime)
  const insertAccount = runtime.client.prepare(`
    INSERT INTO accounts(uid, name, status, category, created_at, updated_at)
    VALUES (?, ?, 'valid', ?, ?, ?)
  `)
  insertAccount.run('10001', 'Account A', 'Nhóm A', 100, 100)
  insertAccount.run('10002', 'Account B', 'Nhóm B', 100, 100)
  return { runtime, workspaces: new ActionWorkspaceRepository(runtime.client) }
}

describe('ActionWorkspaceRepository', () => {
  it('applies latest schema and restores config with ordered account bindings', () => {
    const { runtime, workspaces } = setup()
    const schemaVersion = runtime.client.prepare("SELECT value FROM app_settings WHERE key = 'schema_version'").get() as { value: string }
    expect(schemaVersion.value).toBe('21')

    const created = workspaces.create({
      type: 'interaction',
      label: 'Tương tác',
      configJson: JSON.stringify({ targetMode: 'friends', repeat: false }),
      accounts: [
        { accountId: 2, enabled: true },
        { accountId: 1, enabled: false }
      ]
    }, 1000)

    expect(created.accounts).toEqual([
      { accountId: 2, sortOrder: 0, enabled: true },
      { accountId: 1, sortOrder: 1, enabled: false }
    ])
    expect(JSON.parse(created.configJson)).toMatchObject({ targetMode: 'friends', repeat: false })
    expect(workspaces.list()).toEqual([created])
  })

  it('updates config and account order atomically', () => {
    const { workspaces } = setup()
    const created = workspaces.create({
      type: 'interaction',
      label: 'Tương tác',
      configJson: '{}',
      accounts: [{ accountId: 1, enabled: true }, { accountId: 2, enabled: true }]
    }, 1000)

    const updated = workspaces.update({
      id: created.id,
      patch: {
        configJson: JSON.stringify({ actor: 'page' }),
        accounts: [{ accountId: 2, enabled: false }, { accountId: 1, enabled: true }]
      }
    }, 2000)

    expect(JSON.parse(updated.configJson)).toEqual({ actor: 'page' })
    expect(updated.accounts).toEqual([
      { accountId: 2, sortOrder: 0, enabled: false },
      { accountId: 1, sortOrder: 1, enabled: true }
    ])
    expect(updated.updatedAt).toBe(2000)
  })

  it('rejects invalid config and invalid account bindings', () => {
    const { workspaces } = setup()
    expect(() => workspaces.create({ type: 'interaction', label: 'A', configJson: '[]' })).toThrow('JSON object')
    expect(() => workspaces.create({ type: 'interaction', label: 'A', configJson: '{' })).toThrow('JSON hợp lệ')
    expect(() => workspaces.create({
      type: 'interaction', label: 'A', configJson: '{}', accounts: [{ accountId: 1, enabled: true }, { accountId: 1, enabled: true }]
    })).toThrow('bị trùng')
    expect(() => workspaces.create({
      type: 'interaction', label: 'A', configJson: '{}', accounts: [{ accountId: 999, enabled: true }]
    })).toThrow('Không tìm thấy account')
  })

  it('removes bindings automatically when an account is deleted', () => {
    const { runtime, workspaces } = setup()
    const created = workspaces.create({
      type: 'interaction', label: 'A', configJson: '{}', accounts: [{ accountId: 1, enabled: true }, { accountId: 2, enabled: true }]
    })
    runtime.client.prepare('DELETE FROM accounts WHERE id = ?').run(1)
    expect(workspaces.get(created.id)?.accounts).toEqual([{ accountId: 2, sortOrder: 1, enabled: true }])
  })
})
