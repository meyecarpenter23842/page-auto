import type { ScanResultStatus, StartScanJobInput } from '../../../shared/scanner'
import {
  ScanAdapterRuntimeError,
  type ScanAdapter,
  type ScanAdapterControl,
  type ScanAdapterRecord
} from '../scanAdapter'
import { pageRecordMatchesFilters } from './pageScanSupport'

export interface PageScanRawRecord {
  entityId: string
  displayName: string
  url: string | null
  username: string | null
  category: string | null
  followers: number | null
  likes: number | null
  location: string | null
  rawText: string
  source: 'keyword_search' | 'page_uid_or_url'
  status?: ScanResultStatus
}

export interface PageScanRuntime {
  scan(input: StartScanJobInput, control: ScanAdapterControl): AsyncIterable<PageScanRawRecord>
}

export class PageScanAdapter implements ScanAdapter {
  readonly scanType = 'page' as const

  constructor(private readonly runtime: PageScanRuntime) {}

  async *scan(input: StartScanJobInput, control: ScanAdapterControl): AsyncIterable<ScanAdapterRecord> {
    if (input.source.type !== 'account' || input.source.accountId === null) {
      throw new ScanAdapterRuntimeError(
        'needs_attention',
        input.source.type === 'token'
          ? 'Nguồn Access Token chưa có production path được audit cho Quét Page.'
          : 'Quét Page production cần chọn một Account Page-Auto.'
      )
    }

    const seen = new Set<string>()
    for await (const raw of this.runtime.scan(input, control)) {
      if (control.isStopped()) return
      if (!await control.waitIfPaused()) return

      const entityId = raw.entityId.trim()
      if (!/^\d+$/.test(entityId)) continue
      if (seen.has(entityId)) continue
      seen.add(entityId)

      const terminalRecord = raw.status && raw.status !== 'success' && raw.status !== 'partial_success'
      if (!terminalRecord && !pageRecordMatchesFilters(raw, input.filters)) continue
      const displayName = raw.displayName.trim() || entityId
      const hasCoreMetadata = displayName !== entityId && Boolean(raw.url)
      yield {
        entityId,
        displayName,
        url: raw.url?.trim() || null,
        status: raw.status ?? (hasCoreMetadata ? 'success' : 'partial_success'),
        data: {
          username: raw.username,
          category: raw.category,
          followers: raw.followers,
          likes: raw.likes,
          location: raw.location,
          source: raw.source,
          filterScope: 'client'
        }
      }
    }
  }
}
