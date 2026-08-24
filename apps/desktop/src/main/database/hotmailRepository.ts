import type Database from 'better-sqlite3'
import type {
  EmailProxyMode,
  HotmailDashboardRow,
  HotmailMailStatus,
  HotmailOAuthStatus,
  HotmailSettings,
  SaveHotmailSettingsInput
} from '../../shared/hotmail'

interface DashboardDatabaseRow {
  accountId: number
  uid: string
  email: string | null
  emailPassword: string | null
  backupEmail: string | null
  oauthStatus: string | null
  mailStatus: string | null
  lastCheckAt: number | null
  lastCode: string | null
  lastCodeAt: number | null
  lastError: string | null
}

interface SettingsRow {
  profileRoot: string | null
  browserExecutablePath: string | null
  oauthClientId: string | null
  oauthTenant: string
  proxyMode: string
  proxyListJson: string
  currentProxy: string | null
  updatedAt: number
}

function text(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function parseProxyMode(value: string): EmailProxyMode {
  return value === 'random_ipv4' ? 'random_ipv4' : 'direct'
}

function parseProxyList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function oauthStatus(value: string | null): HotmailOAuthStatus {
  return value === 'pending' || value === 'valid' || value === 'expired' || value === 'error' ? value : 'missing'
}

function mailStatus(value: string | null): HotmailMailStatus {
  return value === 'ready' || value === 'error' ? value : 'unknown'
}

export class HotmailRepository {
  constructor(private readonly client: Database.Database) {}

  listDashboardRows(): Array<Omit<HotmailDashboardRow, 'profileStatus' | 'runtimeStatus' | 'runtimeMessage'>> {
    const rows = this.client.prepare(`
      SELECT
        a.id AS accountId,
        a.uid,
        a.email,
        a.email_password AS emailPassword,
        a.backup_email AS backupEmail,
        s.oauth_status AS oauthStatus,
        s.mail_status AS mailStatus,
        s.last_check_at AS lastCheckAt,
        s.last_code AS lastCode,
        s.last_code_at AS lastCodeAt,
        s.last_error AS lastError
      FROM accounts a
      LEFT JOIN account_email_state s ON s.account_id = a.id
      ORDER BY a.id DESC
    `).all() as DashboardDatabaseRow[]

    return rows.map((row) => ({
      accountId: Number(row.accountId),
      uid: row.uid,
      email: row.email,
      emailPasswordMasked: row.emailPassword ? '••••••••' : null,
      backupEmail: row.backupEmail,
      oauthStatus: oauthStatus(row.oauthStatus),
      mailStatus: mailStatus(row.mailStatus),
      latestCode: row.lastCode,
      lastCodeAt: row.lastCodeAt === null ? null : Number(row.lastCodeAt),
      lastCheckAt: row.lastCheckAt === null ? null : Number(row.lastCheckAt)
    }))
  }

  getSettings(): HotmailSettings {
    const row = this.client.prepare(`
      SELECT
        profile_root AS profileRoot,
        browser_executable_path AS browserExecutablePath,
        oauth_client_id AS oauthClientId,
        oauth_tenant AS oauthTenant,
        proxy_mode AS proxyMode,
        proxy_list_json AS proxyListJson,
        current_proxy AS currentProxy,
        updated_at AS updatedAt
      FROM email_settings
      WHERE id = 1
    `).get() as SettingsRow | undefined

    if (!row) {
      return {
        profileRoot: null,
        browserExecutablePath: null,
        oauthClientId: null,
        oauthTenant: 'consumers',
        proxyMode: 'direct',
        proxyList: [],
        currentProxy: null,
        updatedAt: null
      }
    }

    return {
      profileRoot: row.profileRoot,
      browserExecutablePath: row.browserExecutablePath,
      oauthClientId: row.oauthClientId,
      oauthTenant: row.oauthTenant || 'consumers',
      proxyMode: parseProxyMode(row.proxyMode),
      proxyList: parseProxyList(row.proxyListJson),
      currentProxy: row.currentProxy,
      updatedAt: Number(row.updatedAt)
    }
  }

  saveSettings(input: SaveHotmailSettingsInput): HotmailSettings {
    const now = Date.now()
    const proxyList = input.proxyList.map((item) => item.trim()).filter(Boolean)
    const current = this.getSettings().currentProxy
    const currentProxy = input.proxyMode === 'random_ipv4' && current && proxyList.includes(current) ? current : null
    const oauthTenant = input.oauthTenant.trim() || 'consumers'

    this.client.prepare(`
      INSERT INTO email_settings (
        id, profile_root, browser_executable_path, oauth_client_id, oauth_tenant,
        proxy_mode, proxy_list_json, current_proxy, updated_at
      ) VALUES (1, @profileRoot, @browserExecutablePath, @oauthClientId, @oauthTenant, @proxyMode, @proxyListJson, @currentProxy, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        profile_root=excluded.profile_root,
        browser_executable_path=excluded.browser_executable_path,
        oauth_client_id=excluded.oauth_client_id,
        oauth_tenant=excluded.oauth_tenant,
        proxy_mode=excluded.proxy_mode,
        proxy_list_json=excluded.proxy_list_json,
        current_proxy=excluded.current_proxy,
        updated_at=excluded.updated_at
    `).run({
      profileRoot: text(input.profileRoot),
      browserExecutablePath: text(input.browserExecutablePath),
      oauthClientId: text(input.oauthClientId),
      oauthTenant,
      proxyMode: input.proxyMode,
      proxyListJson: JSON.stringify(proxyList),
      currentProxy,
      updatedAt: now
    })
    return this.getSettings()
  }

  setCurrentProxy(proxy: string | null): HotmailSettings {
    const settings = this.getSettings()
    const now = Date.now()
    this.client.prepare(`
      INSERT INTO email_settings (
        id, profile_root, browser_executable_path, oauth_client_id, oauth_tenant,
        proxy_mode, proxy_list_json, current_proxy, updated_at
      ) VALUES (1, @profileRoot, @browserExecutablePath, @oauthClientId, @oauthTenant, @proxyMode, @proxyListJson, @currentProxy, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET current_proxy=excluded.current_proxy, updated_at=excluded.updated_at
    `).run({
      profileRoot: settings.profileRoot,
      browserExecutablePath: settings.browserExecutablePath,
      oauthClientId: settings.oauthClientId,
      oauthTenant: settings.oauthTenant,
      proxyMode: settings.proxyMode,
      proxyListJson: JSON.stringify(settings.proxyList),
      currentProxy: text(proxy),
      updatedAt: now
    })
    return this.getSettings()
  }

  getRefreshTokenSecret(accountId: number): string | null {
    const row = this.client.prepare('SELECT refresh_token_secret AS secret FROM account_email_state WHERE account_id = ?')
      .get(accountId) as { secret: string | null } | undefined
    return row?.secret ?? null
  }

  setOAuthState(accountId: number, status: HotmailOAuthStatus, refreshTokenSecret: string | null, lastError: string | null): void {
    const now = Date.now()
    this.client.prepare(`
      INSERT INTO account_email_state (
        account_id, provider, oauth_status, refresh_token_secret, mail_status,
        last_check_at, last_code, last_code_at, last_error, updated_at
      ) VALUES (@accountId, 'microsoft', @status, @refreshTokenSecret, 'unknown', NULL, NULL, NULL, @lastError, @updatedAt)
      ON CONFLICT(account_id) DO UPDATE SET
        oauth_status=excluded.oauth_status,
        refresh_token_secret=COALESCE(excluded.refresh_token_secret, account_email_state.refresh_token_secret),
        last_error=excluded.last_error,
        updated_at=excluded.updated_at
    `).run({ accountId, status, refreshTokenSecret, lastError, updatedAt: now })
  }

  setMailState(
    accountId: number,
    status: HotmailMailStatus,
    lastCheckAt: number,
    lastCode: string | null,
    lastCodeAt: number | null,
    lastError: string | null
  ): void {
    const now = Date.now()
    this.client.prepare(`
      INSERT INTO account_email_state (
        account_id, provider, oauth_status, refresh_token_secret, mail_status,
        last_check_at, last_code, last_code_at, last_error, updated_at
      ) VALUES (@accountId, 'microsoft', 'missing', NULL, @status, @lastCheckAt, @lastCode, @lastCodeAt, @lastError, @updatedAt)
      ON CONFLICT(account_id) DO UPDATE SET
        mail_status=excluded.mail_status,
        last_check_at=excluded.last_check_at,
        last_code=CASE WHEN excluded.last_code IS NULL THEN account_email_state.last_code ELSE excluded.last_code END,
        last_code_at=CASE WHEN excluded.last_code_at IS NULL THEN account_email_state.last_code_at ELSE excluded.last_code_at END,
        last_error=excluded.last_error,
        updated_at=excluded.updated_at
    `).run({ accountId, status, lastCheckAt, lastCode, lastCodeAt, lastError, updatedAt: now })
  }
}
