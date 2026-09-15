import type { StartScanJobInput } from '../../../shared/scanner'
import type { ScanAdapter, ScanAdapterRecord } from '../scanAdapter'

export class MockGroupScanAdapter implements ScanAdapter {
  readonly scanType = 'group' as const

  async scan(input: StartScanJobInput): Promise<ScanAdapterRecord[]> {
    const keyword = input.query.trim() || 'demo'
    return [
      { entityId: '100001', displayName: `${keyword} · Cộng đồng 1`, url: 'https://www.facebook.com/groups/100001', status: 'success', data: { members: 42800, privacy: 'Public', locale: 'vi_VN', location: 'Hồ Chí Minh', category: 'Community' } },
      { entityId: '100002', displayName: `${keyword} · Cộng đồng 2`, url: 'https://www.facebook.com/groups/100002', status: 'success', data: { members: 17600, privacy: 'Private', locale: 'vi_VN', location: 'Hà Nội', category: 'Community' } },
      { entityId: '100003', displayName: `${keyword} · Cộng đồng 3`, url: 'https://www.facebook.com/groups/100003', status: 'partial_success', data: { members: 9300, privacy: 'Public', locale: null, location: null, category: null } }
    ].slice(0, input.limit)
  }
}
