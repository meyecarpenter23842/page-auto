import type { StartScanJobInput } from '../../../shared/scanner'
import type { ScanAdapter, ScanAdapterRecord } from '../scanAdapter'

export class MockPageScanAdapter implements ScanAdapter {
  readonly scanType = 'page' as const

  async scan(input: StartScanJobInput): Promise<ScanAdapterRecord[]> {
    const keyword = input.query.trim() || 'demo'
    return [
      { entityId: '200001', displayName: `${keyword} · Page 1`, url: 'https://www.facebook.com/200001', status: 'success', data: { username: 'demo.page.1', category: 'Local business', followers: 12800, likes: 11900, location: 'Hồ Chí Minh', verified: false } },
      { entityId: '200002', displayName: `${keyword} · Page 2`, url: 'https://www.facebook.com/200002', status: 'partial_success', data: { username: null, category: 'Community', followers: 5400, likes: null, location: null, verified: null } },
      { entityId: '200003', displayName: `${keyword} · Page 3`, url: 'https://www.facebook.com/200003', status: 'success', data: { username: 'demo.page.3', category: 'Shopping & retail', followers: 28700, likes: 26400, location: 'Đà Nẵng', verified: false } }
    ].slice(0, input.limit)
  }
}
