import type { ScanResultStatus, StartScanJobInput } from '../../../shared/scanner'
import {
  ScanAdapterRuntimeError,
  type ScanAdapter,
  type ScanAdapterControl,
  type ScanAdapterRecord
} from '../scanAdapter'

export interface GroupMembersScanRawRecord {
  entityId: string
  displayName: string
  url: string | null
  sourceGroupId: string
  sourceUrl: string | null
  username: string | null
  location: string | null
  role: string | null
  status?: ScanResultStatus
}

export interface GroupMembersScanRuntime {
  scan(input: StartScanJobInput, control: ScanAdapterControl): AsyncIterable<GroupMembersScanRawRecord>
}

export class GroupMembersScanAdapter implements ScanAdapter {
  readonly scanType = 'group_members' as const

  constructor(private readonly runtime: GroupMembersScanRuntime) {}

  async *scan(input: StartScanJobInput, control: ScanAdapterControl): AsyncIterable<ScanAdapterRecord> {
    if (input.source.type !== 'account' || input.source.accountId === null) {
      throw new ScanAdapterRuntimeError(
        'needs_attention',
        input.source.type === 'token'
          ? 'Nguồn Access Token chưa có production path được audit cho Thành viên nhóm.'
          : 'Thành viên nhóm production cần chọn một Account Page-Auto.'
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
      yield {
        entityId,
        displayName,
        url: raw.url?.trim() || null,
        status: raw.status ?? (displayName !== entityId ? 'success' : 'partial_success'),
        data: {
          sourceGroupId: raw.sourceGroupId,
          sourceUrl: raw.sourceUrl,
          username: raw.username,
          location: raw.location,
          role: raw.role,
          source: 'group_members'
        }
      }
    }
  }
}
