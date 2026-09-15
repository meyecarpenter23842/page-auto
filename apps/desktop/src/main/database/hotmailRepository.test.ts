import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { BROWSER_WINDOW_LAYOUT_STORAGE_KEY, withCompactBrowserTileSize } from '../../shared/browserWindowLayout'
import { HotmailRepository } from './hotmailRepository'

describe('HotmailRepository canonical Account binding', () => {
  it('reads shared identity live from accounts while keeping Email state separate', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE accounts (
          id INTEGER PRIMARY KEY,
          uid TEXT NOT NULL,
          name TEXT,
          category TEXT,
          status TEXT NOT NULL,
          note TEXT,
          email TEXT,
          email_password TEXT,
          backup_email TEXT
        );
        CREATE TABLE account_email_state (
          account_id INTEGER PRIMARY KEY,
          oauth_status TEXT NOT NULL DEFAULT 'missing',
          oauth_client_id TEXT,
          refresh_token_ciphertext TEXT,
          oauth_updated_at INTEGER,
          last_token_check_at INTEGER,
          mail_status TEXT NOT NULL DEFAULT 'unknown',
          last_check_at INTEGER,
          last_code TEXT,
          last_code_at INTEGER,
          last_error TEXT
        );
      `)
      db.prepare(`
        INSERT INTO accounts (id, uid, name, category, status, note, email, email_password, backup_email)
        VALUES (7, '10007', 'TK A', 'Nhóm A', 'valid', 'note A', 'a@outlook.com', 'secret', 'backup@example.com')
      `).run()
      db.prepare(`
        INSERT INTO account_email_state (account_id, oauth_status, refresh_token_ciphertext, mail_status)
        VALUES (7, 'valid', 'ciphertext', 'ready')
      `).run()

      const repository = new HotmailRepository(db)
      const first = repository.listDashboardRows()[0]
      expect(first).toMatchObject({
        accountId: 7,
        uid: '10007',
        accountName: 'TK A',
        accountCategory: 'Nhóm A',
        facebookStatus: 'valid',
        accountNote: 'note A',
        email: 'a@outlook.com',
        backupEmail: 'backup@example.com',
        oauthStatus: 'valid',
        hasRefreshToken: true,
        mailStatus: 'ready'
      })
      expect(first?.emailPasswordMasked).not.toBe('secret')

      db.prepare(`
        UPDATE accounts
        SET name = 'TK B', category = 'Nhóm B', status = 'needs_login', note = 'note B'
        WHERE id = 7
      `).run()

      const second = repository.listDashboardRows()[0]
      expect(second).toMatchObject({
        accountId: 7,
        accountName: 'TK B',
        accountCategory: 'Nhóm B',
        facebookStatus: 'needs_login',
        accountNote: 'note B',
        oauthStatus: 'valid',
        mailStatus: 'ready'
      })
    } finally {
      db.close()
    }
  })

  it('persists Email-owned browser size and Compact layout without coupling to Facebook layout', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE email_profile_settings (
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
          external_root TEXT NOT NULL DEFAULT '',
          browser_executable TEXT NOT NULL DEFAULT '',
          oauth_client_id TEXT NOT NULL DEFAULT '',
          oauth_tenant TEXT NOT NULL DEFAULT 'consumers',
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE email_proxy_settings (
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
          mode TEXT NOT NULL DEFAULT 'direct',
          proxy_list_json TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL
        );
      `)

      const repository = new HotmailRepository(db)
      const defaults = repository.getProfileSettings()
      expect(defaults).toMatchObject({
        browserWindowWidth: 1280,
        browserWindowHeight: 800,
        browserWindowLayout: { enabled: true, autoFit: true }
      })

      const compact = withCompactBrowserTileSize(defaults.browserWindowLayout, 600, 450, true)
      repository.saveSettings({
        profileRoot: 'C:\\EmailProfiles',
        browserExecutable: 'C:\\Chrome\\chrome.exe',
        browserWindowWidth: 1440,
        browserWindowHeight: 900,
        browserWindowLayout: compact,
        oauthClientId: 'client-id',
        oauthTenant: 'consumers',
        proxyMode: 'direct'
      })

      expect(repository.getSettingsView()).toMatchObject({
        browserWindowWidth: 1440,
        browserWindowHeight: 900,
        browserWindowLayout: {
          enabled: true,
          tileWidthPx: 600,
          tileHeightPx: 450,
          autoFit: true
        }
      })

      repository.saveSettings({
        profileRoot: 'C:\\EmailProfiles',
        browserExecutable: 'C:\\Chrome\\chrome.exe',
        oauthClientId: 'client-id',
        oauthTenant: 'consumers',
        proxyMode: 'direct'
      })

      expect(repository.getProfileSettings()).toMatchObject({
        browserWindowWidth: 1440,
        browserWindowHeight: 900,
        browserWindowLayout: {
          tileWidthPx: 600,
          tileHeightPx: 450,
          autoFit: true
        }
      })
      const facebookLayout = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(BROWSER_WINDOW_LAYOUT_STORAGE_KEY)
      expect(facebookLayout).toBeUndefined()

      const legacyFixedPreset = withCompactBrowserTileSize(repository.getProfileSettings().browserWindowLayout, 600, 450, false)
      db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(
        JSON.stringify(legacyFixedPreset),
        'email_browser_window_layout'
      )
      db.prepare('DELETE FROM app_settings WHERE key = ?').run('email_browser_window_layout_version')

      expect(repository.getProfileSettings().browserWindowLayout).toMatchObject({
        tileWidthPx: 600,
        tileHeightPx: 450,
        autoFit: true
      })

      repository.saveSettings({
        profileRoot: 'C:\\EmailProfiles',
        browserExecutable: 'C:\\Chrome\\chrome.exe',
        browserWindowLayout: legacyFixedPreset,
        oauthClientId: 'client-id',
        oauthTenant: 'consumers',
        proxyMode: 'direct'
      })

      expect(repository.getProfileSettings().browserWindowLayout).toMatchObject({
        tileWidthPx: 600,
        tileHeightPx: 450,
        autoFit: false
      })
      const layoutVersion = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(
        'email_browser_window_layout_version'
      ) as { value: string } | undefined
      expect(layoutVersion?.value).toBe('2')
    } finally {
      db.close()
    }
  })
})
