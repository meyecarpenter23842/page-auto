import type { StartScanJobInput } from '../../../shared/scanner'
import type { ScanAdapter, ScanAdapterRecord } from '../scanAdapter'

export class MockGroupMembersScanAdapter implements ScanAdapter {
  readonly scanType = 'group_members' as const

  async scan(input: StartScanJobInput): Promise<ScanAdapterRecord[]> {
    const groupId = input.query.trim() || 'group-demo'
    return [
      { entityId: '400001', displayName: 'Thành viên demo 1', url: 'https://www.facebook.com/400001', status: 'success', data: { sourceGroupId: groupId, username: 'member.demo.1', location: 'Hồ Chí Minh' } },
      { entityId: '400002', displayName: 'Thành viên demo 2', url: 'https://www.facebook.com/400002', status: 'success', data: { sourceGroupId: groupId, username: 'member.demo.2', location: null } },
      { entityId: '400003', displayName: 'Thành viên demo 3', url: 'https://www.facebook.com/400003', status: 'partial_success', data: { sourceGroupId: groupId, username: null, location: null } }
    ].slice(0, input.limit)
  }
}
