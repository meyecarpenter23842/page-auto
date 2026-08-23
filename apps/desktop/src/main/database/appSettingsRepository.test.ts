import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS
} from '../../shared/appSettings'
import { initializeDatabase } from './index'
import { AppSettingsRepository } from './appSettingsRepository'

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-app-settings-'))
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  return { runtime, repository: new AppSettingsRepository(runtime.client) }
}

describe('AppSettingsRepository', () => {
  it('returns typed defaults when settings have not been persisted yet', () => {
    const { runtime, repository } = createRepository()

    expect(repository.get()).toEqual(DEFAULT_APP_SETTINGS)

    runtime.close()
  })

  it('persists partial section updates without replacing unrelated defaults', () => {
    const { runtime, repository } = createRepository()

    const saved = repository.update({
      browser: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        navigationTimeoutMs: 45000
      },
      runtime: {
        maxActivePageTabs: 4
      }
    })

    expect(saved.browser.navigationTimeoutMs).toBe(45000)
    expect(saved.runtime.maxActivePageTabs).toBe(4)
    expect(saved.session.validateBeforeRun).toBe(true)
    expect(repository.get()).toEqual(saved)

    const row = runtime.client
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(APP_SETTINGS_STORAGE_KEY) as { value: string } | undefined
    expect(row).toBeDefined()
    expect(JSON.parse(row!.value)).toEqual(saved)

    runtime.close()
  })

  it('rejects invalid values and unknown settings instead of persisting them', () => {
    const { runtime, repository } = createRepository()

    expect(() => repository.update({ runtime: { maxActivePageTabs: 0 } })).toThrow(
      'runtime.maxActivePageTabs'
    )
    expect(() => repository.update({ browser: { navigationTimeoutMs: 500 } })).toThrow(
      'browser.navigationTimeoutMs'
    )
    expect(() => repository.update({ runtime: { madeUpSetting: 1 } } as never)).toThrow(
      'Unknown setting: runtime.madeUpSetting'
    )
    expect(repository.get()).toEqual(DEFAULT_APP_SETTINGS)

    runtime.close()
  })

  it('falls back to defaults for malformed persisted JSON and can reset saved settings', () => {
    const { runtime, repository } = createRepository()

    runtime.client.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(APP_SETTINGS_STORAGE_KEY, '{bad-json', Date.now())

    expect(repository.get()).toEqual(DEFAULT_APP_SETTINGS)

    repository.update({ logging: { level: 'debug', retentionDays: 90 } })
    expect(repository.get().logging.level).toBe('debug')

    const reset = repository.reset()
    expect(reset).toEqual(DEFAULT_APP_SETTINGS)
    expect(repository.get()).toEqual(DEFAULT_APP_SETTINGS)

    runtime.close()
  })
})
