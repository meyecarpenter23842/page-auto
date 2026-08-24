import type Database from 'better-sqlite3'
import type {
  AccountColumnLayout,
  AccountDraft,
  AccountImportRequest,
  AccountImportResult,
  AccountListFilters,
  AccountRecord,
  AccountStatus,
  ImportPreset,
  SaveImportPresetInput
} from '../../shared/accounts'
import { parseAccountImport, resolveImportOperation } from './accountImport'

const ACCOUNT_SELECT = `
  SELECT
    id,
    uid,
    username,
    password,
    name,
    status,
    category,
    friend_count AS friendCount,
    cookie,
    cookie_status AS cookieStatus,
    last_cookie_check AS lastCookieCheck,
    proxy,
    proxy_type AS proxyType,
    proxy_host AS proxyHost,
    proxy_port AS proxyPort,
    proxy_username AS proxyUsername,
    proxy_password AS proxyPassword,
    two_factor_secret AS twoFactorSecret,
    email,
    email_password AS emailPassword,
    backup_email AS backupEmail,
    phone,
    user_agent AS userAgent,
    created_date AS createdDate,
    note,
    last_used_at AS lastUsedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM accounts
`

function text(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeDraft(input: AccountDraft): Required<Omit<AccountDraft, 'uid'>> & { uid: string } {
  return {
    uid: input.uid.trim(),
    username: text(input.username),
    password: text(input.password),
    name: text(input.name),
    status: input.status ?? 'unknown',
    category: text(input.category),
    friendCount: input.friendCount ?? null,
    cookie: text(input.cookie),
    cookieStatus: text(input.cookieStatus),
    lastCookieCheck: input.lastCookieCheck ?? null,
    proxy: text(input.proxy),
    proxyType: text(input.proxyType),
    proxyHost: text(input.proxyHost),
    proxyPort: input.proxyPort ?? null,
    proxyUsername: text(input.proxyUsername),
    proxyPassword: text(input.proxyPassword),
    twoFactorSecret: text(input.twoFactorSecret),
    email: text(input.email),
    emailPassword: text(input.emailPassword),
    backupEmail: text(input.backupEmail),
    phone: text(input.phone),
    userAgent: text(input.userAgent),
    createdDate: text(input.createdDate),
    note: text(input.note),
    lastUsedAt: input.lastUsedAt ?? null
  }
}

function rowToAccount(row: Record<string, unknown>): AccountRecord {
  return {
    id: Number(row.id),
    uid: String(row.uid),
    username: row.username === null ? null : String(row.username),
    password: row.password === null ? null : String(row.password),
    name: row.name === null ? null : String(row.name),
    status: String(row.status) as AccountStatus,
    category: row.category === null ? null : String(row.category),
    friendCount: row.friendCount === null ? null : Number(row.friendCount),
    cookie: row.cookie === null ? null : String(row.cookie),
    cookieStatus: row.cookieStatus === null ? null : String(row.cookieStatus),
    lastCookieCheck: row.lastCookieCheck === null ? null : Number(row.lastCookieCheck),
    proxy: row.proxy === null ? null : String(row.proxy),
    proxyType: row.proxyType === null ? null : String(row.proxyType),
    proxyHost: row.proxyHost === null ? null : String(row.proxyHost),
    proxyPort: row.proxyPort === null ? null : Number(row.proxyPort),
    proxyUsername: row.proxyUsername === null ? null : String(row.proxyUsername),
    proxyPassword: row.proxyPassword === null ? null : String(row.proxyPassword),
    twoFactorSecret: row.twoFactorSecret === null ? null : String(row.twoFactorSecret),
    email: row.email === null ? null : String(row.email),
    emailPassword: row.emailPassword === null ? null : String(row.emailPassword),
    backupEmail: row.backupEmail === null ? null : String(row.backupEmail),
    phone: row.phone === null ? null : String(row.phone),
    userAgent: row.userAgent === null ? null : String(row.userAgent),
    createdDate: row.createdDate === null ? null : String(row.createdDate),
    note: row.note === null ? null : String(row.note),
    lastUsedAt: row.lastUsedAt === null ? null : Number(row.lastUsedAt),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt)
  }
}

export class AccountRepository {
  constructor(private readonly client: Database.Database) {}

  list(filters: AccountListFilters = {}): AccountRecord[] {
    const searchText = filters.search?.trim() ?? ''
    const searchPattern = `%${searchText}%`
    const status = filters.status ?? 'all'
    const category = filters.category?.trim() ?? ''

    const rows = this.client
      .prepare(`${ACCOUNT_SELECT}
        WHERE (
          @searchText = '' OR
          uid LIKE @searchPattern OR
          COALESCE(username, '') LIKE @searchPattern OR
          COALESCE(name, '') LIKE @searchPattern OR
          COALESCE(email, '') LIKE @searchPattern OR
          COALESCE(note, '') LIKE @searchPattern
        )
        AND (@status = 'all' OR status = @status)
        AND (@category = '' OR category = @category)
        ORDER BY id DESC
      `)
      .all({ searchText, searchPattern, status, category }) as Record<string, unknown>[]

    return rows.map(rowToAccount)
  }

  getById(id: number): AccountRecord | null {
    const row = this.client.prepare(`${ACCOUNT_SELECT} WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    return row ? rowToAccount(row) : null
  }

  getByUid(uid: string): AccountRecord | null {
    const row = this.client.prepare(`${ACCOUNT_SELECT} WHERE uid = ?`).get(uid) as Record<string, unknown> | undefined
    return row ? rowToAccount(row) : null
  }

  create(input: AccountDraft): AccountRecord {
    const account = normalizeDraft(input)
    if (!account.uid) throw new Error('UID/UserName là bắt buộc.')

    const now = Date.now()
    const result = this.client
      .prepare(`
        INSERT INTO accounts (
          uid, username, password, name, status, category, friend_count,
          cookie, cookie_status, last_cookie_check,
          proxy, proxy_type, proxy_host, proxy_port, proxy_username, proxy_password,
          two_factor_secret, email, email_password, backup_email, phone, user_agent,
          created_date, note, last_used_at, created_at, updated_at
        ) VALUES (
          @uid, @username, @password, @name, @status, @category, @friendCount,
          @cookie, @cookieStatus, @lastCookieCheck,
          @proxy, @proxyType, @proxyHost, @proxyPort, @proxyUsername, @proxyPassword,
          @twoFactorSecret, @email, @emailPassword, @backupEmail, @phone, @userAgent,
          @createdDate, @note, @lastUsedAt, @createdAt, @updatedAt
        )
      `)
      .run({ ...account, createdAt: now, updatedAt: now })

    const created = this.getById(Number(result.lastInsertRowid))
    if (!created) throw new Error('Không thể đọc lại account vừa tạo.')
    return created
  }

  update(id: number, patch: Partial<AccountDraft>): AccountRecord {
    const current = this.getById(id)
    if (!current) throw new Error(`Không tìm thấy account #${id}.`)

    const merged: AccountDraft = {
      uid: patch.uid !== undefined ? patch.uid : current.uid,
      username: patch.username !== undefined ? patch.username : current.username,
      password: patch.password !== undefined ? patch.password : current.password,
      name: patch.name !== undefined ? patch.name : current.name,
      status: patch.status !== undefined ? patch.status : current.status,
      category: patch.category !== undefined ? patch.category : current.category,
      friendCount: patch.friendCount !== undefined ? patch.friendCount : current.friendCount,
      cookie: patch.cookie !== undefined ? patch.cookie : current.cookie,
      cookieStatus: patch.cookieStatus !== undefined ? patch.cookieStatus : current.cookieStatus,
      lastCookieCheck: patch.lastCookieCheck !== undefined ? patch.lastCookieCheck : current.lastCookieCheck,
      proxy: patch.proxy !== undefined ? patch.proxy : current.proxy,
      proxyType: patch.proxyType !== undefined ? patch.proxyType : current.proxyType,
      proxyHost: patch.proxyHost !== undefined ? patch.proxyHost : current.proxyHost,
      proxyPort: patch.proxyPort !== undefined ? patch.proxyPort : current.proxyPort,
      proxyUsername: patch.proxyUsername !== undefined ? patch.proxyUsername : current.proxyUsername,
      proxyPassword: patch.proxyPassword !== undefined ? patch.proxyPassword : current.proxyPassword,
      twoFactorSecret: patch.twoFactorSecret !== undefined ? patch.twoFactorSecret : current.twoFactorSecret,
      email: patch.email !== undefined ? patch.email : current.email,
      emailPassword: patch.emailPassword !== undefined ? patch.emailPassword : current.emailPassword,
      backupEmail: patch.backupEmail !== undefined ? patch.backupEmail : current.backupEmail,
      phone: patch.phone !== undefined ? patch.phone : current.phone,
      userAgent: patch.userAgent !== undefined ? patch.userAgent : current.userAgent,
      createdDate: patch.createdDate !== undefined ? patch.createdDate : current.createdDate,
      note: patch.note !== undefined ? patch.note : current.note,
      lastUsedAt: patch.lastUsedAt !== undefined ? patch.lastUsedAt : current.lastUsedAt
    }
    const account = normalizeDraft(merged)

    this.client
      .prepare(`
        UPDATE accounts SET
          uid=@uid,
          username=@username,
          password=@password,
          name=@name,
          status=@status,
          category=@category,
          friend_count=@friendCount,
          cookie=@cookie,
          cookie_status=@cookieStatus,
          last_cookie_check=@lastCookieCheck,
          proxy=@proxy,
          proxy_type=@proxyType,
          proxy_host=@proxyHost,
          proxy_port=@proxyPort,
          proxy_username=@proxyUsername,
          proxy_password=@proxyPassword,
          two_factor_secret=@twoFactorSecret,
          email=@email,
          email_password=@emailPassword,
          backup_email=@backupEmail,
          phone=@phone,
          user_agent=@userAgent,
          created_date=@createdDate,
          note=@note,
          last_used_at=@lastUsedAt,
          updated_at=@updatedAt
        WHERE id=@id
      `)
      .run({ ...account, id, updatedAt: Date.now() })

    const updated = this.getById(id)
    if (!updated) throw new Error('Không thể đọc lại account vừa cập nhật.')
    return updated
  }

  delete(ids: number[]): number {
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
    if (uniqueIds.length === 0) return 0

    const placeholders = uniqueIds.map(() => '?').join(', ')
    return this.client.prepare(`DELETE FROM accounts WHERE id IN (${placeholders})`).run(...uniqueIds).changes
  }

  import(request: AccountImportRequest): AccountImportResult {
    const parsed = parseAccountImport(request)
    const operation = resolveImportOperation(request)
    const result: AccountImportResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [...parsed.errors]
    }

    const run = this.client.transaction(() => {
      for (const draft of parsed.accounts) {
        const existing = this.getByUid(draft.uid)

        if (operation === 'insert') {
          if (existing) {
            result.skipped += 1
            continue
          }

          try {
            this.create(draft)
            result.imported += 1
          } catch (error) {
            result.errors.push({ line: 0, message: error instanceof Error ? error.message : String(error) })
          }
          continue
        }

        if (!existing) {
          result.skipped += 1
          result.errors.push({ line: 0, message: `Không tìm thấy UID/UserName để cập nhật: ${draft.uid}` })
          continue
        }

        // UID is the lookup key for batch update; never rewrite it from the
        // import payload. Missing properties stay unchanged, explicit nulls
        // clear existing values.
        const { uid: _uid, ...patch } = draft
        if (Object.keys(patch).length === 0) {
          result.skipped += 1
          result.errors.push({ line: 0, message: `Không có trường nào để cập nhật cho UID/UserName: ${draft.uid}` })
          continue
        }

        try {
          this.update(existing.id, patch)
          result.updated += 1
        } catch (error) {
          result.errors.push({ line: 0, message: error instanceof Error ? error.message : String(error) })
        }
      }
    })

    run()
    return result
  }

  listImportPresets(): ImportPreset[] {
    const rows = this.client
      .prepare(`
        SELECT id, name, delimiter, mapping_json AS mappingJson, created_at AS createdAt, updated_at AS updatedAt
        FROM import_presets
        ORDER BY name COLLATE NOCASE
      `)
      .all() as Array<Record<string, unknown>>

    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      delimiter: String(row.delimiter),
      mapping: JSON.parse(String(row.mappingJson)) as ImportPreset['mapping'],
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt)
    }))
  }

  saveImportPreset(input: SaveImportPresetInput): ImportPreset {
    const name = input.name.trim()
    if (!name) throw new Error('Tên preset là bắt buộc.')

    const now = Date.now()
    this.client
      .prepare(`
        INSERT INTO import_presets (name, delimiter, mapping_json, created_at, updated_at)
        VALUES (@name, @delimiter, @mappingJson, @createdAt, @updatedAt)
        ON CONFLICT(name) DO UPDATE SET
          delimiter=excluded.delimiter,
          mapping_json=excluded.mapping_json,
          updated_at=excluded.updated_at
      `)
      .run({
        name,
        delimiter: input.delimiter || '|',
        mappingJson: JSON.stringify(input.mapping),
        createdAt: now,
        updatedAt: now
      })

    const preset = this.client
      .prepare(`
        SELECT id, name, delimiter, mapping_json AS mappingJson, created_at AS createdAt, updated_at AS updatedAt
        FROM import_presets WHERE name = ?
      `)
      .get(name) as Record<string, unknown> | undefined

    if (!preset) throw new Error('Không thể đọc lại preset vừa lưu.')

    return {
      id: Number(preset.id),
      name: String(preset.name),
      delimiter: String(preset.delimiter),
      mapping: JSON.parse(String(preset.mappingJson)) as ImportPreset['mapping'],
      createdAt: Number(preset.createdAt),
      updatedAt: Number(preset.updatedAt)
    }
  }

  deleteImportPreset(id: number): boolean {
    return this.client.prepare('DELETE FROM import_presets WHERE id = ?').run(id).changes > 0
  }

  getColumnLayout(viewKey: string): AccountColumnLayout | null {
    const row = this.client
      .prepare('SELECT layout_json AS layoutJson FROM column_layouts WHERE view_key = ?')
      .get(viewKey) as { layoutJson: string } | undefined

    if (!row) return null

    try {
      return JSON.parse(row.layoutJson) as AccountColumnLayout
    } catch {
      return null
    }
  }

  saveColumnLayout(viewKey: string, layout: AccountColumnLayout): void {
    this.client
      .prepare(`
        INSERT INTO column_layouts (view_key, layout_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(view_key) DO UPDATE SET
          layout_json=excluded.layout_json,
          updated_at=excluded.updated_at
      `)
      .run(viewKey, JSON.stringify(layout), Date.now())
  }
}
