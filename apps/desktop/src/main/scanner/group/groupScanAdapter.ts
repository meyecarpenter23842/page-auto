import type { ScanResultStatus, StartScanJobInput } from '../../../shared/scanner'
import {
  ScanAdapterRuntimeError,
  type ScanAdapter,
  type ScanAdapterControl,
  type ScanAdapterRecord
} from '../scanAdapter'
import type { GroupScanPrivacy } from './groupScanSupport'

export interface GroupScanRawRecord {
  entityId: string
  displayName: string
  url: string | null
  members: number | null
  privacy: GroupScanPrivacy
  rawText: string
  source: 'keyword_search' | 'group_uid'
  status?: ScanResultStatus
}

export interface GroupScanRuntime {
  scan(input: StartScanJobInput, control: ScanAdapterControl): AsyncIterable<GroupScanRawRecord>
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function isIdentityName(value: string, entityId: string): boolean {
  return normalizeText(value).toLocaleLowerCase() === normalizeText(entityId).toLocaleLowerCase()
}

function nameFromFilterText(rawText: string, entityId: string): string {
  const text = normalizeText(rawText)
  if (!text) return ''
  const boundaries = [
    /\s(?:Public|Private|Công khai|Riêng tư)\b/i,
    /\s\d[\d.,]*\s*[kKmM]?\s*(?:members?|thành viên)\b/i
  ]
    .map((pattern) => text.search(pattern))
    .filter((index) => index > 0)
  const candidate = normalizeText(boundaries.length ? text.slice(0, Math.min(...boundaries)) : '')
    .replace(/[·|\-–—:]+$/g, '')
    .trim()
  return candidate && !isIdentityName(candidate, entityId) ? candidate : ''
}

export function groupResultDisplayName(raw: GroupScanRawRecord): string {
  const explicit = normalizeText(raw.displayName)
  if (explicit && !isIdentityName(explicit, raw.entityId)) return explicit
  return nameFromFilterText(raw.rawText, raw.entityId) || '—'
}

export class GroupScanAdapter implements ScanAdapter {
  readonly scanType = 'group' as const

  constructor(private readonly runtime: GroupScanRuntime) {}

  async *scan(input: StartScanJobInput, control: ScanAdapterControl): AsyncIterable<ScanAdapterRecord> {
    if (input.source.type !== 'account' || input.source.accountId === null) {
      throw new ScanAdapterRuntimeError(
        'needs_attention',
        input.source.type === 'token'
          ? 'Nguồn Access Token chưa có production path được hỗ trợ cho Quét Nhóm.'
          : 'Quét Nhóm production cần chọn một Account Page-Auto.'
      )
    }

    const seen = new Set<string>()
    for await (const raw of this.runtime.scan(input, control)) {
      if (control.isStopped()) return
      if (!await control.waitIfPaused()) return

      const entityId = raw.entityId.trim()
      if (!entityId) continue
      const dedupeKey = entityId.toLocaleLowerCase()
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const hasCoreMetadata = raw.members !== null && raw.privacy !== null
      yield {
        entityId,
        displayName: groupResultDisplayName(raw),
        url: raw.url?.trim() || null,
        status: raw.status ?? (hasCoreMetadata ? 'success' : 'partial_success'),
        data: {
          members: raw.members,
          privacy: raw.privacy,
          locale: null,
          location: null,
          category: null,
          source: raw.source,
          filterScope: 'client',
          filterText: normalizeText(raw.rawText)
        }
      }
    }
  }
}
