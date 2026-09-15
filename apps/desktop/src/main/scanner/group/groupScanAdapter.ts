import type { ScanResultStatus, StartScanJobInput } from '../../../shared/scanner'
import {
  ScanAdapterRuntimeError,
  type ScanAdapter,
  type ScanAdapterControl,
  type ScanAdapterRecord
} from '../scanAdapter'
import { groupRecordMatchesFilters, type GroupScanPrivacy } from './groupScanSupport'

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

      const terminalRecord = raw.status && raw.status !== 'success' && raw.status !== 'partial_success'
      if (!terminalRecord && !groupRecordMatchesFilters(raw, input.filters)) continue
      const displayName = raw.displayName.trim() || entityId
      const hasCoreMetadata = raw.members !== null && raw.privacy !== null
      yield {
        entityId,
        displayName,
        url: raw.url?.trim() || null,
        status: raw.status ?? (hasCoreMetadata ? 'success' : 'partial_success'),
        data: {
          members: raw.members,
          privacy: raw.privacy,
          locale: null,
          location: null,
          category: null,
          source: raw.source,
          filterScope: 'client'
        }
      }
    }
  }
}
