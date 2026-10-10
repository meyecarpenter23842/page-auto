import type { ScanType } from '../../shared/scanner'
import type { ScanAdapter } from './scanAdapter'
import { MockGroupScanAdapter } from './adapters/mockGroupScanAdapter'
import { MockPageScanAdapter } from './adapters/mockPageScanAdapter'
import { MockUserScanAdapter } from './adapters/mockUserScanAdapter'
import { MockGroupMembersScanAdapter } from './adapters/mockGroupMembersScanAdapter'

export class ScannerAdapterRegistry {
  private readonly adapters = new Map<ScanType, ScanAdapter>()

  constructor(adapters: ScanAdapter[] = [
    new MockGroupScanAdapter(),
    new MockPageScanAdapter(),
    new MockUserScanAdapter(),
    new MockGroupMembersScanAdapter()
  ]) {
    for (const adapter of adapters) this.adapters.set(adapter.scanType, adapter)
  }

  get(scanType: ScanType): ScanAdapter {
    const adapter = this.adapters.get(scanType)
    if (!adapter) throw new Error(`Chưa có scanner adapter cho ${scanType}.`)
    return adapter
  }
}
