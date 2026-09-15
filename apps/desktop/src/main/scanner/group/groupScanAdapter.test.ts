import { describe, expect, it } from 'vitest'
import type { StartScanJobInput } from '../../../shared/scanner'
import { AccountExecutionCoordinator } from '../../services/accountExecutionCoordinator'
import { ScanAdapterRuntimeError, type ScanAdapterControl, type ScanAdapterRecord, type ScanControlState } from '../scanAdapter'
import { GroupScanAdapter, type GroupScanRawRecord, type GroupScanRuntime } from './groupScanAdapter'

const control: ScanAdapterControl = {
  isStopped: () => false,
  isPaused: () => false,
  waitIfPaused: async () => true,
  onStateChange: (_listener: (state: ScanControlState) => void) => () => undefined
}

function input(filters: StartScanJobInput['filters'] = {}): StartScanJobInput {
  return {
    scanType: 'group',
    source: { type: 'account', accountId: 1 },
    query: 'demo',
    filters,
    limit: 100
  }
}

function runtime(records: GroupScanRawRecord[]): GroupScanRuntime {
  return {
    async *scan() {
      for (const record of records) yield record
    }
  }
}

async function collect(adapter: GroupScanAdapter, request: StartScanJobInput): Promise<ScanAdapterRecord[]> {
  const results: ScanAdapterRecord[] = []
  for await (const record of adapter.scan(request, control)) results.push(record)
  return results
}

describe('GroupScanAdapter', () => {
  it('dedupes Group UID, maps nullable fields and preserves typed permission results', async () => {
    const adapter = new GroupScanAdapter(runtime([
      { entityId: '100', displayName: 'Group A', url: 'https://www.facebook.com/groups/100/', members: 5000, privacy: 'Public', rawText: 'Public · 5K members', source: 'keyword_search' },
      { entityId: '100', displayName: 'Group A duplicate', url: null, members: 5000, privacy: 'Public', rawText: 'Public · 5K members', source: 'keyword_search' },
      { entityId: '200', displayName: 'Group B', url: 'https://www.facebook.com/groups/200/', members: null, privacy: null, rawText: '', source: 'keyword_search' },
      { entityId: '300', displayName: 'Group C', url: 'https://www.facebook.com/groups/300/', members: null, privacy: null, rawText: '', source: 'group_uid', status: 'permission_limited' }
    ]))

    const results = await collect(adapter, input())
    expect(results.map((item) => item.entityId)).toEqual(['100', '200', '300'])
    expect(results[0]?.status).toBe('success')
    expect(results[1]?.status).toBe('partial_success')
    expect(results[1]?.data).toMatchObject({ members: null, privacy: null, locale: null, location: null, category: null })
    expect(results[2]?.status).toBe('permission_limited')
  })

  it('applies members/privacy/location filters without turning them into server-side claims', async () => {
    const adapter = new GroupScanAdapter(runtime([
      { entityId: '100', displayName: 'HCM', url: null, members: 5000, privacy: 'Public', rawText: 'Hồ Chí Minh Public 5K members', source: 'keyword_search' },
      { entityId: '200', displayName: 'HN', url: null, members: 50000, privacy: 'Private', rawText: 'Hà Nội Private 50K members', source: 'keyword_search' }
    ]))
    const results = await collect(adapter, input({ membersMin: 1000, privacy: 'public', location: 'Hồ Chí Minh' }))
    expect(results).toHaveLength(1)
    expect(results[0]?.entityId).toBe('100')
    expect(results[0]?.data.filterScope).toBe('client')
  })

  it('rejects unsupported token source as needs_attention instead of inventing a token path', async () => {
    const adapter = new GroupScanAdapter(runtime([]))
    const request: StartScanJobInput = { ...input(), source: { type: 'token', credentialId: 'secret-ref' } }
    await expect(collect(adapter, request)).rejects.toMatchObject({
      jobStatus: 'needs_attention'
    } satisfies Partial<ScanAdapterRuntimeError>)
  })

  it('uses the app-wide account lease table across coordinator instances', () => {
    const scannerCoordinator = new AccountExecutionCoordinator()
    const otherWorkflowCoordinator = new AccountExecutionCoordinator()
    const lease = otherWorkflowCoordinator.tryAcquireLease(99123)
    expect(lease).not.toBeNull()
    expect(scannerCoordinator.tryAcquireLease(99123)).toBeNull()
    lease?.release()
    const scannerLease = scannerCoordinator.tryAcquireLease(99123)
    expect(scannerLease).not.toBeNull()
    scannerLease?.release()
  })
})
