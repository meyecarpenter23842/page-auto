import type Database from 'better-sqlite3'
import type {
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function rawProxy(row: StoredProxyRow): string {
  const base = displayHost(row.host) + ':' + row.port
  return row.username ? base + ':' + row.username + ':' + row.password : base
}

export class ProxyCenterInventoryRepository {
  constructor(private readonly client: Database.Database) {}

  list(): ProxyCenterInventoryRecord[] {
    const rows = this.client
      .prepare(SELECT_PROXY + ' ORDER BY updated_at DESC, id DESC')
      .all() as Record<string, unknown>[]
    return rows.map(rowFromDatabase).map(publicRecord)
  }

  getSecret(id: number): ProxyCenterSecretRecord | null {
    const row = this.client.prepare(SELECT_PROXY + ' WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    const stored = rowFromDatabase(row)
    return {
      id: stored.id,
      host: stored.host,
      port: stored.port,
      username: stored.username || null,
      password: stored.password || null,
      rawProxy: rawProxy(stored)
    }
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
              created_at, updated_at
            ) VALUES (
              @host, @port, @username, @password, @ipFamily, @outboundIp, @status,
              @latencyMs, @lastError, @sourceKind, @sourceLabel, @lastCheckedAt,
              @createdAt, @updatedAt
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
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
    if (!unique.length) return 0
    const placeholders = unique.map(() => '?').join(', ')
    return this.client.prepare('DELETE FROM proxy_inventory WHERE id IN (' + placeholders + ')').run(...unique).changes
  }

  keyOf(record: Pick<ProxyCenterInventoryRecord, 'host' | 'port' | 'username'>): string {
    return endpointKey(record.host, record.port, record.username)
  }
}
