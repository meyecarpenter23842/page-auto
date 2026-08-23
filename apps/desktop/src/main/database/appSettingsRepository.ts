import type Database from 'better-sqlite3'
import {
  APP_SETTINGS_STORAGE_KEY,
  assertValidAppSettings,
  assertValidAppSettingsPatch,
  cloneDefaultAppSettings,
  mergeAppSettings,
  parseStoredAppSettings,
  type AppSettings,
  type AppSettingsPatch
} from '../../shared/appSettings'

export class AppSettingsRepository {
  constructor(private readonly client: Database.Database) {}

  get(): AppSettings {
    const row = this.client
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(APP_SETTINGS_STORAGE_KEY) as { value: string } | undefined

    return parseStoredAppSettings(row?.value)
  }

  update(input: AppSettingsPatch): AppSettings {
    assertValidAppSettingsPatch(input)
    const next = mergeAppSettings(this.get(), input)
    assertValidAppSettings(next)
    this.persist(next)
    return next
  }

  reset(): AppSettings {
    const defaults = cloneDefaultAppSettings()
    this.persist(defaults)
    return defaults
  }

  private persist(settings: AppSettings): void {
    this.client.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `).run(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings), Date.now())
  }
}
