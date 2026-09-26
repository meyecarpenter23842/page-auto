import type Database from 'better-sqlite3'
import type {
  ProxyCenterFolder,
  ProxyCenterInventoryRecord,
  ProxyCenterInventoryStatus,
  ProxyCenterInventoryUpsertInput,
  ProxyCenterInventoryUpsertResult,
  ProxyCenterIpFamily,
  ProxyCenterSourceKind
} from '../../shared/proxyBuilder'
import { parseProxyLine } from '../proxyBuilder/checkerService'

interface StoredProxyRow {
  id: number
  host: string
  port: number
  username: string
  password: string
  ipFamily: ProxyCenterIpFamily
  outboundIp: string | null
  status: ProxyCenterInventoryStatus
  latencyMs: number | null
  lastError: string | null
  sourceKind: ProxyCenterSourceKind
  sourceLabel: string | null
  lastCheckedAt: number | null
  folderId: number | null
  createdAt: number
  updatedAt: number
}

export interface ProxyCenterSecretRecord {
  id: number
  host: string
  port: number
  username: string | null
  password: string | null
  rawProxy: string
}

const SELECT_PROXY = `
  SELECT
    id,
    host,
    port,
    username,
    password,
    ip_family AS ipFamily,
    outbound_ip AS outboundIp,
    status,
    latency_ms AS latencyMs,
    last_error AS lastError,
    source_kind AS sourceKind,
    source_label AS sourceLabel,
    last_checked_at AS lastCheckedAt,
    folder_id AS folderId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM proxy_inventory
`

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function displayHost(host: string): string {
  return host.includes(':') ? '[' + host + ']' : host
}

function endpointKey(host: string, port: number, username: string | null | undefined): string {
  return host.trim().toLowerCase() + ':' + port + ':' + (username?.trim() ?? '')
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
}

function rowFromDatabase(row: Record<string, unknown>): StoredProxyRow {
  return {
    id: Number(row.id),
    host: String(row.host),
    port: Number(row.port),
    username: String(row.username ?? ''),
    password: String(row.password ?? ''),
    ipFamily: String(row.ipFamily ?? 'unknown') as ProxyCenterIpFamily,
    outboundIp: row.outboundIp === null ? null : String(row.outboundIp),
    status: String(row.status ?? 'unknown') as ProxyCenterInventoryStatus,
    latencyMs: row.latencyMs === null ? null : Number(row.latencyMs),
    lastError: row.lastError === null ? null : String(row.lastError),
    sourceKind: String(row.sourceKind ?? 'import') as ProxyCenterSourceKind,
    sourceLabel: row.sourceLabel === null ? null : String(row.sourceLabel),
    lastCheckedAt: row.lastCheckedAt === null ? null : Number(row.lastCheckedAt),
    folderId: row.folderId === null ? null : Number(row.folderId),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt)
  }
}

function publicRecord(row: StoredProxyRow): ProxyCenterInventoryRecord {
  const username = row.username || null
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    username,
    maskedProxy: displayHost(row.host) + ':' + row.port + (username ? ':' + username + ':••••' : ''),
    ipFamily: row.ipFamily,
    outboundIp: row.outboundIp,
    status: row.status,
    latencyMs: row.latencyMs,
    lastError: row.lastError,
    sourceKind: row.sourceKind,
    sourceLabel: row.sourceLabel,
    lastCheckedAt: row.lastCheckedAt,
    assignedAccountCount: 0,
    folderId: row.folderId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function rawProxy(row: StoredProxyRow): string {
  const base = displayHost(row.host) + ':' + row.port
  return row.username ? base + ':' + row.username + ':' + row.password : base
}

function secretRecord(row: StoredProxyRow): ProxyCenterSecretRecord {
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    username: row.username || null,
    password: row.password || null,
    rawProxy: rawProxy(row)
  }
}

export class ProxyCenterInventoryRepository {
  constructor(private readonly client: Database.Database) {}

  list(): ProxyCenterInventoryRecord[] {
    const rows = this.client
      .prepare(SELECT_PROXY + ' ORDER BY updated_at DESC, id DESC')
      .all() as Record<string, unknown>[]
    return rows.map(rowFromDatabase).map(publicRecord)
  }

  listFolders(): ProxyCenterFolder[] {
    return (this.client.prepare(`
      SELECT f.id, f.name, f.created_at AS createdAt, f.updated_at AS updatedAt,
             COUNT(p.id) AS proxyCount
      FROM proxy_folders f
      LEFT JOIN proxy_inventory p ON p.folder_id = f.id
      GROUP BY f.id
      ORDER BY f.name COLLATE NOCASE, f.id
    `).all() as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      proxyCount: Number(row.proxyCount ?? 0),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt)
    }))
  }

  createFolder(name: string): ProxyCenterFolder[] {
    const normalized = normalizeText(name)
    if (!normalized) throw new Error('Tên thư mục không được để trống.')
    if (normalized.length > 80) throw new Error('Tên thư mục tối đa 80 ký tự.')
    const now = Date.now()
    try {
      this.client.prepare('INSERT INTO proxy_folders (name, created_at, updated_at) VALUES (?, ?, ?)')
        .run(normalized, now, now)
    } catch {
      throw new Error('Tên thư mục đã tồn tại.')
    }
    return this.listFolders()
  }

  renameFolder(id: number, name: string): ProxyCenterFolder[] {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Thư mục không hợp lệ.')
    const normalized = normalizeText(name)
    if (!normalized) throw new Error('Tên thư mục không được để trống.')
    if (normalized.length > 80) throw new Error('Tên thư mục tối đa 80 ký tự.')
    try {
      const changed = this.client.prepare('UPDATE proxy_folders SET name = ?, updated_at = ? WHERE id = ?')
        .run(normalized, Date.now(), id).changes
      if (!changed) throw new Error('Thư mục không còn tồn tại.')
    } catch (error) {
      if (error instanceof Error && error.message === 'Thư mục không còn tồn tại.') throw error
      throw new Error('Tên thư mục đã tồn tại.')
    }
    return this.listFolders()
  }

  deleteFolder(id: number): ProxyCenterFolder[] {
    if (!Number.isInteger(id) || id <= 0) throw new Error('Thư mục không hợp lệ.')
    const run = this.client.transaction(() => {
      this.client.prepare('UPDATE proxy_inventory SET folder_id = NULL, updated_at = ? WHERE folder_id = ?')
        .run(Date.now(), id)
      this.client.prepare('DELETE FROM proxy_folders WHERE id = ?').run(id)
    })
    run()
    return this.listFolders()
  }

  assignFolder(ids: number[], folderId: number | null): ProxyCenterInventoryRecord[] {
    const normalizedIds = uniqueIds(ids)
    if (!normalizedIds.length) return this.list()
    if (folderId !== null) {
      if (!Number.isInteger(folderId) || folderId <= 0) throw new Error('Thư mục không hợp lệ.')
      const exists = this.client.prepare('SELECT 1 FROM proxy_folders WHERE id = ?').get(folderId)
      if (!exists) throw new Error('Thư mục không còn tồn tại.')
    }
    const placeholders = normalizedIds.map(() => '?').join(', ')
    this.client.prepare('UPDATE proxy_inventory SET folder_id = ?, updated_at = ? WHERE id IN (' + placeholders + ')')
      .run(folderId, Date.now(), ...normalizedIds)
    return this.list()
  }

  getSecret(id: number): ProxyCenterSecretRecord | null {
    const row = this.client.prepare(SELECT_PROXY + ' WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? secretRecord(rowFromDatabase(row)) : null
  }

  getSecrets(ids: number[]): ProxyCenterSecretRecord[] {
    const normalizedIds = uniqueIds(ids)
    if (!normalizedIds.length) return []
    const placeholders = normalizedIds.map(() => '?').join(', ')
    const rows = this.client
      .prepare(SELECT_PROXY + ' WHERE id IN (' + placeholders + ')')
      .all(...normalizedIds) as Record<string, unknown>[]
    const byId = new Map(rows.map((row) => {
      const stored = rowFromDatabase(row)
      return [stored.id, stored] as const
    }))
    const result: ProxyCenterSecretRecord[] = []
    for (const id of normalizedIds) {
      const stored = byId.get(id)
      if (stored) result.push(secretRecord(stored))
    }
    return result
  }

  upsert(input: ProxyCenterInventoryUpsertInput): ProxyCenterInventoryUpsertResult {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      return { inserted: 0, updated: 0, errors: [], records: this.list() }
    }
    if (input.items.length > 10_000) throw new Error('Tối đa 10.000 proxy mỗi lần nhập kho.')

    let inserted = 0
    let updated = 0
    const errors: string[] = []

    const run = this.client.transaction(() => {
      input.items.forEach((item, index) => {
        let parsed: ReturnType<typeof parseProxyLine>
        try {
          parsed = parseProxyLine(item.rawProxy)
        } catch (error) {
          errors.push('Dòng ' + (index + 1) + ': ' + (error instanceof Error ? error.message : 'Proxy không hợp lệ.'))
          return
        }

        const host = parsed.host.trim().toLowerCase()
        const username = parsed.username?.trim() ?? ''
        const password = parsed.password ?? ''
        const existingRow = this.client
          .prepare(SELECT_PROXY + ' WHERE host = ? AND port = ? AND username = ?')
          .get(host, parsed.port, username) as Record<string, unknown> | undefined
        const now = Date.now()

        if (!existingRow) {
          this.client.prepare(`
            INSERT INTO proxy_inventory (
              host, port, username, password, ip_family, outbound_ip, status,
              latency_ms, last_error, source_kind, source_label, last_checked_at,
              folder_id, created_at, updated_at
            ) VALUES (
              @host, @port, @username, @password, @ipFamily, @outboundIp, @status,
              @latencyMs, @lastError, @sourceKind, @sourceLabel, @lastCheckedAt,
              NULL, @createdAt, @updatedAt
            )
          `).run({
            host,
            port: parsed.port,
            username,
            password,
            ipFamily: item.ipFamily ?? 'unknown',
            outboundIp: normalizeText(item.outboundIp),
            status: item.status ?? 'unknown',
            latencyMs: item.latencyMs ?? null,
            lastError: normalizeText(item.lastError),
            sourceKind: item.sourceKind ?? 'import',
            sourceLabel: normalizeText(item.sourceLabel),
            lastCheckedAt: item.lastCheckedAt ?? null,
            createdAt: now,
            updatedAt: now
          })
          inserted += 1
          return
        }

        const existing = rowFromDatabase(existingRow)
        this.client.prepare(`
          UPDATE proxy_inventory SET
            password=@password,
            ip_family=@ipFamily,
            outbound_ip=@outboundIp,
            status=@status,
            latency_ms=@latencyMs,
            last_error=@lastError,
            source_kind=@sourceKind,
            source_label=@sourceLabel,
            last_checked_at=@lastCheckedAt,
            updated_at=@updatedAt
          WHERE id=@id
        `).run({
          id: existing.id,
          password,
          ipFamily: item.ipFamily ?? existing.ipFamily,
          outboundIp: item.outboundIp !== undefined ? normalizeText(item.outboundIp) : existing.outboundIp,
          status: item.status ?? existing.status,
          latencyMs: item.latencyMs !== undefined ? item.latencyMs : existing.latencyMs,
          lastError: item.lastError !== undefined ? normalizeText(item.lastError) : existing.lastError,
          sourceKind: item.sourceKind ?? existing.sourceKind,
          sourceLabel: item.sourceLabel !== undefined ? normalizeText(item.sourceLabel) : existing.sourceLabel,
          lastCheckedAt: item.lastCheckedAt !== undefined ? item.lastCheckedAt : existing.lastCheckedAt,
          updatedAt: now
        })
        updated += 1
      })
    })

    run()
    return { inserted, updated, errors, records: this.list() }
  }

  applyCheck(
    id: number,
    result: { live: boolean; outboundIp: string | null; ipFamily: ProxyCenterIpFamily; latencyMs: number | null; error: string | null }
  ): void {
    const now = Date.now()
    this.client.prepare(`
      UPDATE proxy_inventory SET
        status=?,
        outbound_ip=?,
        ip_family=?,
        latency_ms=?,
        last_error=?,
        last_checked_at=?,
        updated_at=?
      WHERE id=?
    `).run(
      result.live ? 'live' : 'dead',
      result.outboundIp,
      result.ipFamily,
      result.latencyMs,
      normalizeText(result.error),
      now,
      now,
      id
    )
  }

  delete(ids: number[]): number {
    const unique = uniqueIds(ids)
    if (!unique.length) return 0
    const placeholders = unique.map(() => '?').join(', ')
    return this.client.prepare('DELETE FROM proxy_inventory WHERE id IN (' + placeholders + ')').run(...unique).changes
  }

  keyOf(record: Pick<ProxyCenterInventoryRecord, 'host' | 'port' | 'username'>): string {
    return endpointKey(record.host, record.port, record.username)
  }
}
