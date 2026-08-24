import type Database from 'better-sqlite3'
import {
  BROWSER_WINDOW_LAYOUT_STORAGE_KEY,
  assertValidBrowserWindowLayoutSettings,
  cloneDefaultBrowserWindowLayout,
  parseStoredBrowserWindowLayout,
  type BrowserWindowLayoutSettings
} from '../../shared/browserWindowLayout'

export class BrowserWindowLayoutRepository {
  constructor(private readonly client: Database.Database) {}

  get(): BrowserWindowLayoutSettings {
    const row = this.client
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(BROWSER_WINDOW_LAYOUT_STORAGE_KEY) as { value: string } | undefined
    return parseStoredBrowserWindowLayout(row?.value)
  }

  save(input: BrowserWindowLayoutSettings): BrowserWindowLayoutSettings {
    const next = { ...input }
    assertValidBrowserWindowLayoutSettings(next)
    this.persist(next)
    return next
  }

  reset(): BrowserWindowLayoutSettings {
    const defaults = cloneDefaultBrowserWindowLayout()
    this.persist(defaults)
    return defaults
  }

  private persist(settings: BrowserWindowLayoutSettings): void {
    this.client.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `).run(BROWSER_WINDOW_LAYOUT_STORAGE_KEY, JSON.stringify(settings), Date.now())
  }
}
