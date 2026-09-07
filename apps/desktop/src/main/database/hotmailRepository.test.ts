import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
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
})
