import type Database from 'better-sqlite3'
import {
  normalizeZaloPhone,
  type ZaloAccountDraft,
  type ZaloAccountRecord,
  type ZaloAccountUpdatePayload,
  type ZaloSessionStatus
} from '../../shared/zalo'

type ZaloAccountRow = {
  id: number
  phone: string
  password: string | null
  display_name: string | null
  status: string
  session_status: ZaloSessionStatus
  note: string | null
  last_opened_at: number | null
  last_login_at: number | null
  created_at: number
  updated_at: number
}

function toRecord(row: ZaloAccountRow): ZaloAccountRecord {
  return {
    id: row.id,
    phone: row.phone,
    password: row.password,
    displayName: row.display_name,
    status: row.status,
    sessionStatus: row.session_status,
    note: row.note,
    lastOpenedAt: row.last_opened_at,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function cleanOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed || null
}

export class ZaloAccountRepository {
  constructor(private readonly client: Database.Database) {}

  list(): ZaloAccountRecord[] {
    const rows = this.client.prepare(`
      SELECT id, phone, password, display_name, status, session_status, note,
             last_opened_at, last_login_at, created_at, updated_at
      FROM zalo_accounts
      ORDER BY id ASC
    `).all() as ZaloAccountRow[]
    return rows.map(toRecord)
  }

  get(id: number): ZaloAccountRecord | null {
    const row = this.client.prepare(`
      SELECT id, phone, password, display_name, status, session_status, note,
             last_opened_at, last_login_at, created_at, updated_at
      FROM zalo_accounts WHERE id = ?
    `).get(id) as ZaloAccountRow | undefined
    return row ? toRecord(row) : null
  }

  create(input: ZaloAccountDraft): ZaloAccountRecord {
    const now = Date.now()
    const phone = normalizeZaloPhone(input.phone)
    const result = this.client.prepare(`
      INSERT INTO zalo_accounts(phone, password, display_name, status, session_status, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'unknown', ?, ?, ?)
    `).run(
      phone,
      cleanOptional(input.password),
      cleanOptional(input.displayName),
      cleanOptional(input.status) ?? 'active',
      cleanOptional(input.note),
      now,
      now
    )
    return this.require(Number(result.lastInsertRowid))
  }

  update(payload: ZaloAccountUpdatePayload): ZaloAccountRecord {
    const current = this.require(payload.id)
    const patch = payload.patch
    const nextPhone = patch.phone === undefined ? current.phone : normalizeZaloPhone(patch.phone)
    const nextPassword = patch.password === undefined ? current.password : cleanOptional(patch.password)
    const nextDisplayName = patch.displayName === undefined ? current.displayName : cleanOptional(patch.displayName)
    const nextStatus = patch.status === undefined ? current.status : cleanOptional(patch.status) ?? 'active'
    const nextNote = patch.note === undefined ? current.note : cleanOptional(patch.note)
    this.client.prepare(`
      UPDATE zalo_accounts
      SET phone = ?, password = ?, display_name = ?, status = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(nextPhone, nextPassword, nextDisplayName, nextStatus, nextNote, Date.now(), payload.id)
    return this.require(payload.id)
  }

  delete(id: number): boolean {
    return this.client.prepare('DELETE FROM zalo_accounts WHERE id = ?').run(id).changes > 0
  }

  markOpened(id: number, sessionStatus: ZaloSessionStatus): ZaloAccountRecord {
    const now = Date.now()
    this.client.prepare(`
      UPDATE zalo_accounts
      SET session_status = ?, last_opened_at = ?,
          last_login_at = CASE WHEN ? = 'ready' THEN COALESCE(last_login_at, ?) ELSE last_login_at END,
          updated_at = ?
      WHERE id = ?
    `).run(sessionStatus, now, sessionStatus, now, now, id)
    return this.require(id)
  }

  updateSessionStatus(id: number, sessionStatus: ZaloSessionStatus): ZaloAccountRecord {
    const now = Date.now()
    this.client.prepare(`
      UPDATE zalo_accounts
      SET session_status = ?,
          last_login_at = CASE WHEN ? = 'ready' THEN ? ELSE last_login_at END,
          updated_at = ?
      WHERE id = ?
    `).run(sessionStatus, sessionStatus, now, now, id)
    return this.require(id)
  }

  private require(id: number): ZaloAccountRecord {
    const record = this.get(id)
    if (!record) throw new Error(`Không tìm thấy Zalo account #${id}.`)
    return record
  }
}
