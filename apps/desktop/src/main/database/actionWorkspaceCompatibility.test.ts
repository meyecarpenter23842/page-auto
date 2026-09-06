import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ActionWorkspaceRepository } from './actionWorkspaceRepository'
import { initializeDatabase, type DatabaseRuntime } from './index'

function insertWorkspace(
  runtime: DatabaseRuntime,
  workspaceType: string,
  label: string,
  configJson: string,
  createdAt: number,
  updatedAt: number
): number {
  const result = runtime.client.prepare(`
    INSERT INTO action_workspaces(workspace_type, label, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(workspaceType, label, configJson, createdAt, updatedAt)
  return Number(result.lastInsertRowid)
}

describe('legacy Action Workspace compatibility', () => {
  it('repairs recognizable legacy rows, preserves their payloads, skips dirty rows and survives restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-legacy-workspace-'))
    const databaseFile = join(directory, 'page-auto.sqlite')
    let runtime: DatabaseRuntime | null = null

    try {
      runtime = initializeDatabase(databaseFile)
      runtime.client.prepare(`
        INSERT INTO accounts(uid, name, status, category, created_at, updated_at)
        VALUES (?, ?, 'valid', ?, ?, ?)
      `).run('legacy-account', 'Legacy Account', 'Legacy', 100, 100)
      const accountId = Number((runtime.client.prepare('SELECT id FROM accounts WHERE uid = ?').get('legacy-account') as { id: number }).id)

      const pageConfig = JSON.stringify({
        pageBusinessType: 'page_wall_post',
        pageTabId: 77,
        legacyMarker: { keep: true }
      })
      const groupConfig = JSON.stringify({
        sourceMode: 'id_shared',
        sourceTargets: '10001\n10002',
        joinMin: 2,
        joinMax: 4,
        legacyMarker: 'group-keep'
      })
      const changeInfoConfig = JSON.stringify({
        version: 1,
        accountConcurrency: 2,
        verifyAfterChange: true,
        actionOrder: ['bio'],
        actions: { bio: { enabled: true, source: { type: 'fixed', value: 'keep me' } } },
        legacyMarker: 'change-info-keep'
      })
      const dirtyConfig = JSON.stringify({ opaque: 'keep-dirty-row' })

      const pageId = insertWorkspace(runtime, 'page-wall-post', 'Legacy Page Wall', pageConfig, 101, 202)
      const groupId = insertWorkspace(runtime, 'join-group', 'Legacy Join Group', groupConfig, 303, 404)
      const changeInfoId = insertWorkspace(runtime, 'change-info-workspace', 'Legacy Change Info', changeInfoConfig, 505, 606)
      const dirtyId = insertWorkspace(runtime, 'mystery_legacy', 'Dirty row must stay raw', dirtyConfig, 707, 808)
      runtime.client.prepare(`
        INSERT INTO action_workspace_accounts(workspace_id, account_id, sort_order, enabled)
        VALUES (?, ?, 0, 1)
      `).run(groupId, accountId)

      runtime.close()
      runtime = null

      runtime = initializeDatabase(databaseFile)
      const rawRows = runtime.client.prepare(`
        SELECT id, workspace_type AS workspaceType, label, config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
        FROM action_workspaces
        WHERE id IN (?, ?, ?, ?)
        ORDER BY id
      `).all(pageId, groupId, changeInfoId, dirtyId) as Array<{
        id: number
        workspaceType: string
        label: string
        configJson: string
        createdAt: number
        updatedAt: number
      }>

      expect(rawRows.find((row) => row.id === pageId)).toMatchObject({
        workspaceType: 'interaction', label: 'Legacy Page Wall', configJson: pageConfig, createdAt: 101, updatedAt: 202
      })
      expect(rawRows.find((row) => row.id === groupId)).toMatchObject({
        workspaceType: 'group', label: 'Legacy Join Group', configJson: groupConfig, createdAt: 303, updatedAt: 404
      })
      expect(rawRows.find((row) => row.id === changeInfoId)).toMatchObject({
        workspaceType: 'change_info', label: 'Legacy Change Info', configJson: changeInfoConfig, createdAt: 505, updatedAt: 606
      })
      expect(rawRows.find((row) => row.id === dirtyId)).toMatchObject({
        workspaceType: 'mystery_legacy', label: 'Dirty row must stay raw', configJson: dirtyConfig, createdAt: 707, updatedAt: 808
      })

      const workspaces = new ActionWorkspaceRepository(runtime.client)
      expect(() => workspaces.list()).not.toThrow()
      const listed = workspaces.list()
      expect(listed.map((workspace) => workspace.id)).toEqual([pageId, groupId, changeInfoId])
      expect(listed.find((workspace) => workspace.id === groupId)?.accounts).toEqual([
        { accountId, sortOrder: 0, enabled: true }
      ])
      expect(listed.find((workspace) => workspace.id === pageId)?.configJson).toBe(pageConfig)
      expect(listed.find((workspace) => workspace.id === groupId)?.configJson).toBe(groupConfig)
      expect(listed.find((workspace) => workspace.id === changeInfoId)?.configJson).toBe(changeInfoConfig)
      expect(workspaces.get(dirtyId)).toBeNull()

      runtime.close()
      runtime = initializeDatabase(databaseFile)
      const restarted = new ActionWorkspaceRepository(runtime.client).list()
      expect(restarted.map((workspace) => workspace.id)).toEqual([pageId, groupId, changeInfoId])
      expect(restarted.find((workspace) => workspace.id === groupId)?.configJson).toBe(groupConfig)
      const dirtyAfterRestart = runtime.client.prepare(`
        SELECT workspace_type AS workspaceType, config_json AS configJson
        FROM action_workspaces WHERE id = ?
      `).get(dirtyId) as { workspaceType: string; configJson: string }
      expect(dirtyAfterRestart).toEqual({ workspaceType: 'mystery_legacy', configJson: dirtyConfig })
    } finally {
      if (runtime) runtime.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
