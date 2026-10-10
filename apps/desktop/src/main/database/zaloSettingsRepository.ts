import type Database from 'better-sqlite3'
import {
  assertValidZaloBrowserSettings,
  cloneDefaultZaloBrowserSettings,
  type ZaloBrowserSettings
} from '../../shared/zalo'

const ZALO_SETTINGS_KEY = 'settings.zalo-browser'

export class ZaloSettingsRepository {
  constructor(private readonly client: Database.Database) {}

  get(): ZaloBrowserSettings {
    const row = this.client.prepare('SELECT value FROM app_settings WHERE key = ?').get(ZALO_SETTINGS_KEY) as { value: string } | undefined
    if (!row) return cloneDefaultZaloBrowserSettings()
    try {
      const parsed = JSON.parse(row.value) as Partial<ZaloBrowserSettings>
      const defaults = cloneDefaultZaloBrowserSettings()
      const settings: ZaloBrowserSettings = {
        ...defaults,
        ...parsed,
        layout: { ...defaults.layout, ...(parsed.layout ?? {}) }
      }
      assertValidZaloBrowserSettings(settings)
      return settings
    } catch {
      return cloneDefaultZaloBrowserSettings()
    }
  }

  save(input: ZaloBrowserSettings): ZaloBrowserSettings {
    const settings: ZaloBrowserSettings = {
      ...input,
      executablePath: input.executablePath?.trim() || null,
      profileRoot: input.profileRoot?.trim() || null,
      layout: { ...input.layout }
    }
    assertValidZaloBrowserSettings(settings)
    this.client.prepare(`
      INSERT INTO app_settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(ZALO_SETTINGS_KEY, JSON.stringify(settings), Date.now())
    return settings
  }
}
