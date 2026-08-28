import type Database from 'better-sqlite3'
import {
  FACEBOOK_CHECKPOINT282_PRESET_STORAGE_KEY,
  assertValidFacebookCheckpoint282Preset,
  parseFacebookCheckpoint282Preset,
  type FacebookCheckpoint282Preset
} from '../../shared/checkpoint282Workbench'

export class Checkpoint282PresetRepository {
  constructor(private readonly client: Database.Database) {}

  get(): FacebookCheckpoint282Preset {
    const row = this.client
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(FACEBOOK_CHECKPOINT282_PRESET_STORAGE_KEY) as { value: string } | undefined
    return parseFacebookCheckpoint282Preset(row?.value)
  }

  save(input: FacebookCheckpoint282Preset): FacebookCheckpoint282Preset {
    assertValidFacebookCheckpoint282Preset(input)
    const preset: FacebookCheckpoint282Preset = {
      surface: input.surface,
      locale: input.locale,
      sourceImageFolder: input.sourceImageFolder?.trim() || null
    }
    this.client.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `).run(FACEBOOK_CHECKPOINT282_PRESET_STORAGE_KEY, JSON.stringify(preset), Date.now())
    return preset
  }
}
