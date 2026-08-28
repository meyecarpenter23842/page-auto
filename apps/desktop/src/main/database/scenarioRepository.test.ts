import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { ScenarioRepository } from './scenarioRepository'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-scenarios-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  return { runtime, scenarios: new ScenarioRepository(runtime.client) }
}

describe('ScenarioRepository', () => {
  it('applies schema v11 and persists scenario settings', () => {
    const { runtime, scenarios } = setup()
    const schemaVersion = runtime.client.prepare("SELECT value FROM app_settings WHERE key = 'schema_version'").get() as { value: string }
    expect(schemaVersion.value).toBe('11')

    const created = scenarios.create({ name: 'Nuôi tài khoản', randomActionOrder: true, runtimeLimitMinutes: 30 }, 1000)
    expect(created).toMatchObject({ name: 'Nuôi tài khoản', randomActionOrder: true, runtimeLimitMinutes: 30, actionCount: 0 })
    runtime.close()
  })

  it('creates, edits, reorders and deletes reusable action placeholders', () => {
    const { runtime, scenarios } = setup()
    const scenario = scenarios.create({ name: 'KB A' }, 1000)
    let details = scenarios.createAction({ scenarioId: scenario.id, actionType: 'view_newsfeed', label: 'View newsfeed', category: 'interaction' }, 1100)
    details = scenarios.createAction({ scenarioId: scenario.id, actionType: 'group_post', label: 'Đăng bài nhóm', category: 'groups' }, 1200)
    expect(details.actions.map((item) => item.actionType)).toEqual(['view_newsfeed', 'group_post'])

    details = scenarios.moveAction({ scenarioId: scenario.id, actionId: details.actions[1].id, direction: 'up' }, 1300)
    expect(details.actions.map((item) => item.actionType)).toEqual(['group_post', 'view_newsfeed'])

    details = scenarios.updateAction({ id: details.actions[0].id, patch: { label: 'Đăng nhóm', enabled: false } }, 1400)
    expect(details.actions[0]).toMatchObject({ label: 'Đăng nhóm', enabled: false })

    details = scenarios.deleteAction(details.actions[0].id, 1500)
    expect(details.actions).toHaveLength(1)
    expect(details.actions[0].orderIndex).toBe(0)
    runtime.close()
  })

  it('rejects secrets in scenario action config', () => {
    const { runtime, scenarios } = setup()
    const scenario = scenarios.create({ name: 'KB secure' })
    expect(() => scenarios.createAction({
      scenarioId: scenario.id,
      actionType: 'sample',
      label: 'Sample',
      category: 'other',
      configJson: JSON.stringify({ cookie: 'secret-value' })
    })).toThrow('không được lưu secret')
    runtime.close()
  })
})
