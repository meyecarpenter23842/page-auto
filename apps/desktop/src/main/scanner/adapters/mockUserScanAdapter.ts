import type { StartScanJobInput } from '../../../shared/scanner'
import type { ScanAdapter, ScanAdapterRecord } from '../scanAdapter'

export class MockUserScanAdapter implements ScanAdapter {
  readonly scanType = 'user' as const

  async scan(input: StartScanJobInput): Promise<ScanAdapterRecord[]> {
    const keyword = input.query.trim() || 'demo'
    const records: ScanAdapterRecord[] = [
      { entityId: '300001', displayName: `${keyword} · User 1`, url: 'https://www.facebook.com/300001', status: 'success', data: { username: 'demo.user.1', location: 'Hồ Chí Minh', gender: null, followers: 820 } },
      { entityId: '300002', displayName: `${keyword} · User 2`, url: 'https://www.facebook.com/300002', status: 'partial_success', data: { username: null, location: null, gender: null, followers: null } },
      { entityId: '300003', displayName: `${keyword} · User 3`, url: 'https://www.facebook.com/300003', status: 'success', data: { username: 'demo.user.3', location: 'Cần Thơ', gender: null, followers: 2140 } }
    ]
    return records.slice(0, input.limit)
  }
}
