import type Database from 'better-sqlite3'
import type {
  HotmailDashboardRow,
  HotmailMailStatus,
  HotmailOAuthStatus,
  HotmailRuntimeStatus,
  HotmailSettingsView,
  SaveHotmailSettingsInput
} from '../../shared/hotmail'
import type { EmailProxySettingsRaw } from '../email/emailProxyPool'
import { parseEmailProxyLine } from '../email/emailProxyPool'

interface EmailStateRecord {
  accountId: number
  provider: string
  oauthStatus: HotmailOAuthStatus
  refreshTokenCiphertext: string | null
  mailStatus: HotmailMailStatus
  lastCheckAt: number | null
  lastCode: string | null
  lastCodeAt: number | null
  lastError: string | null
  updatedAt: number
}

export interface EmailProfileSettingsRecord {
  profileRoot: string
  browserExecutable: string
  oauthClientId: string
  oauthTenant: string
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

function maskPassword(value: unknown): string | null {
  const normalized = text(value)
  if (!normalized) return null
  return '•'.repeat(Math.min(12, Math.max(6, normalized.length)))
}

function normalizeTenant(value: string): string {
  const normalized = value.trim()
  return normalized || 'consumers'
}

export class HotmailRepository {
  constructor(private readonly client: Database.Database) {}

  listDashboardRows(): HotmailDashboardRow[] {
    const rows = this.client.prepare(`
      SELECT
        a.id AS accountId,
        a.uid,
        a.email,
        a.email_password AS emailPassword,
        a.backup_email AS backupEmail,
        COALESCE(s.oauth_status, 'missing') AS oauthStatus,
        COALESCE(s.mail_status, 'unknown') AS mailStatus,
        s.last_check_at AS lastCheckAt,
        s.last_code AS lastCode,
        s.last_code_at AS lastCodeAt,
        s.last_error AS lastError
      FROM accounts a
      LEFT JOIN account_email_state s ON s.account_id = a.id
      ORDER BY a.id DESC
    `).all() as Record<string, unknown>[]

    return rows.map((row) => ({
      accountId: Number(row.accountId),
      uid: String(row.uid),
      email: text(row.email),
      emailPasswordMasked: maskPassword(row.emailPassword),
      backupEmail: text(row.backupEmail),
      oauthStatus: String(row.oauthStatus) as HotmailOAuthStatus,
      mailStatus: String(row.mailStatus) as HotmailMailStatus,
      profileStatus: 'not_configured',
      profileDirectory: null,
      latestCode: text(row.lastCode),
      lastCodeAt: row.lastCodeAt === null ? null : Number(row.lastCodeAt),
      lastCheckAt: row.lastCheckAt === null ? null : Number(row.lastCheckAt),
      runtimeStatus: 'idle' as HotmailRuntimeStatus,
      lastError: text(row.lastError)
    }))
  }

  getEmailState(accountId: number): EmailStateRecord | null {
    const row = this.client.prepare(`
      SELECT
        account_id AS accountId,
        provider,
        oauth_status AS oauthStatus,
        refresh_token_ciphertext AS refreshTokenCiphertext,
        mail_status AS mailStatus,
        last_check_at AS lastCheckAt,
        last_code AS lastCode,
        last_code_at AS lastCodeAt,
        last_error AS lastError,
        updated_at AS updatedAt
      FROM account_email_state
      WHERE account_id = ?
    `).get(accountId) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      accountId: Number(row.accountId),
      provider: String(row.provider),
      oauthStatus: String(row.oauthStatus) as HotmailOAuthStatus,
      refreshTokenCiphertext: text(row.refreshTokenCiphertext),
      mailStatus: String(row.mailStatus) as HotmailMailStatus,
      lastCheckAt: row.lastCheckAt === null ? null : Number(row.lastCheckAt),
      lastCode: text(row.lastCode),
      lastCodeAt: row.lastCodeAt === null ? null : Number(row.lastCodeAt),
      lastError: text(row.lastError),
      updatedAt: Number(row.updatedAt)
    }
  }

  updateEmailState(accountId: number, patch: Partial<Omit<EmailStateRecord, 'accountId' | 'updatedAt'>>): EmailStateRecord {
    const current = this.getEmailState(accountId)
    const next: Omit<EmailStateRecord, 'accountId'> = {
      provider: patch.provider ?? current?.provider ?? 'microsoft',
      oauthStatus: patch.oauthStatus ?? current?.oauthStatus ?? 'missing',
      refreshTokenCiphertext: patch.refreshTokenCiphertext !== undefined ? patch.refreshTokenCiphertext : (current?.refreshTokenCiphertext ?? null),
      mailStatus: patch.mailStatus ?? current?.mailStatus ?? 'unknown',
      lastCheckAt: patch.lastCheckAt !== undefined ? patch.lastCheckAt : (current?.lastCheckAt ?? null),
      lastCode: patch.lastCode !== undefined ? patch.lastCode : (current?.lastCode ?? null),
      lastCodeAt: patch.lastCodeAt !== undefined ? patch.lastCodeAt : (current?.lastCodeAt ?? null),
      lastError: patch.lastError !== undefined ? patch.lastError : (current?.lastError ?? null),
      updatedAt: Date.now()
    }

    this.client.prepare(`
      INSERT INTO account_email_state (
        account_id, provider, oauth_status, refresh_token_ciphertext, mail_status,
        last_check_at, last_code, last_code_at, last_error, updated_at
      ) VALUES (
        @accountId, @provider, @oauthStatus, @refreshTokenCiphertext, @mailStatus,
        @lastCheckAt, @lastCode, @lastCodeAt, @lastError, @updatedAt
      )
      ON CONFLICT(account_id) DO UPDATE SET
        provider = excluded.provider,
        oauth_status = excluded.oauth_status,
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        mail_status = excluded.mail_status,
        last_check_at = excluded.last_check_at,
        last_code = excluded.last_code,
        last_code_at = excluded.last_code_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run({ accountId, ...next })

    const saved = this.getEmailState(accountId)
    if (!saved) throw new Error(`Không thể lưu Email state cho account #${accountId}.`)
    return saved
  }

  getProfileSettings(): EmailProfileSettingsRecord {
    const row = this.client.prepare(`
      SELECT external_root AS profileRoot, browser_executable AS browserExecutable,
             oauth_client_id AS oauthClientId, oauth_tenant AS oauthTenant
      FROM email_profile_settings WHERE id = 1
    `).get() as Record<string, unknown> | undefined
    return {
      profileRoot: text(row?.profileRoot) ?? '',
      browserExecutable: text(row?.browserExecutable) ?? '',
      oauthClientId: text(row?.oauthClientId) ?? '',
      oauthTenant: text(row?.oauthTenant) ?? 'consumers'
    }
  }

  getProxySettings(): EmailProxySettingsRaw {
    const row = this.client.prepare(`SELECT mode, proxy_list_json AS proxyListJson FROM email_proxy_settings WHERE id = 1`).get() as Record<string, unknown> | undefined
    const mode = row?.mode === 'random_ipv4' ? 'random_ipv4' : 'direct'
    let entries: string[] = []
    try {
      const parsed = JSON.parse(String(row?.proxyListJson ?? '[]')) as unknown
      if (Array.isArray(parsed)) entries = parsed.filter((entry): entry is string => typeof entry === 'string')
    } catch {
      entries = []
    }
    return { mode, entries }
  }

  getSettingsView(currentProxy: string | null = null): HotmailSettingsView {
    const profile = this.getProfileSettings()
    const proxy = this.getProxySettings()
    const previews = proxy.entries
      .map(parseEmailProxyLine)
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .map((candidate) => candidate.display)
      .slice(0, 5)
    return {
      ...profile,
      proxyMode: proxy.mode,
      proxyCount: proxy.entries.length,
      proxyPreview: previews,
      currentProxy
    }
  }

  saveSettings(input: SaveHotmailSettingsInput, normalizedProxyEntries?: string[]): void {
    const now = Date.now()
    this.client.prepare(`
      INSERT INTO email_profile_settings (id, external_root, browser_executable, oauth_client_id, oauth_tenant, updated_at)
      VALUES (1, @profileRoot, @browserExecutable, @oauthClientId, @oauthTenant, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        external_root=excluded.external_root,
        browser_executable=excluded.browser_executable,
        oauth_client_id=excluded.oauth_client_id,
        oauth_tenant=excluded.oauth_tenant,
        updated_at=excluded.updated_at
    `).run({
      profileRoot: input.profileRoot.trim(),
      browserExecutable: input.browserExecutable.trim(),
      oauthClientId: input.oauthClientId.trim(),
      oauthTenant: normalizeTenant(input.oauthTenant),
      updatedAt: now
    })

    const current = this.getProxySettings()
    const entries = normalizedProxyEntries ?? current.entries
    this.client.prepare(`
      INSERT INTO email_proxy_settings (id, mode, proxy_list_json, updated_at)
      VALUES (1, @mode, @proxyListJson, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        mode=excluded.mode,
        proxy_list_json=excluded.proxy_list_json,
        updated_at=excluded.updated_at
    `).run({
      mode: input.proxyMode,
      proxyListJson: JSON.stringify(entries),
      updatedAt: now
    })
  }
}
