import type { ScanResultStatus, StartScanJobInput } from '../../../shared/scanner'
import {
  ScanAdapterRuntimeError,
  type ScanAdapter,
  type ScanAdapterControl,
  type ScanAdapterRecord
} from '../scanAdapter'

export interface UserScanRawRecord {
  entityId: string
  displayName: string
  url: string | null
  username: string | null
  location: string | null
  gender: string | null
  followers: number | null
  source: 'profile_uid_or_url'
  status?: ScanResultStatus
}

export interface UserScanRuntime {
  scan(input: StartScanJobInput, control: ScanAdapterControl): AsyncIterable<UserScanRawRecord>
}

export class UserScanAdapter implements ScanAdapter {
  readonly scanType = 'user' as const

  constructor(private readonly runtime: UserScanRuntime) {}

  async *scan(input: StartScanJobInput, control: ScanAdapterControl): AsyncIterable<ScanAdapterRecord> {
    if (input.source.type !== 'account' || input.source.accountId === null) {
      throw new ScanAdapterRuntimeError(
        'needs_attention',
        input.source.type === 'token'
          ? 'Nguồn Access Token chưa có production path được audit cho Quét Người dùng.'
          : 'Quét Người dùng production cần chọn một Account Page-Auto.'
      )
    }

    const seen = new Set<string>()
    for await (const raw of this.runtime.scan(input, control)) {
      if (control.isStopped()) return
      if (!await control.waitIfPaused()) return
      const entityId = raw.entityId.trim()
      if (!/^\d+$/.test(entityId) || seen.has(entityId)) continue
      seen.add(entityId)

      const displayName = raw.displayName.trim() || entityId
      const hasCoreMetadata = displayName !== entityId && Boolean(raw.url)
      yield {
        entityId,
        displayName,
        url: raw.url?.trim() || null,
        status: raw.status ?? (hasCoreMetadata ? 'success' : 'partial_success'),
        data: {
          username: raw.username,
          location: raw.location,
          gender: raw.gender,
          followers: raw.followers,
          source: raw.source
        }
      }
    }
  }
}
