import { describe, expect, it } from 'vitest'
import type { StartScanJobInput } from '../../../shared/scanner'
import type { ScanAdapterControl } from '../scanAdapter'
import { GroupMembersScanAdapter, type GroupMembersScanRuntime } from './groupMembersScanAdapter'

const input: StartScanJobInput = {
  scanType: 'group_members',
  source: { type: 'account', accountId: 1 },
  query: '1750186668328113',
  filters: {},
  limit: 10
}

const control: ScanAdapterControl = {
  isStopped: () => false,
  isPaused: () => false,
  waitIfPaused: async () => true,
  onStateChange: () => () => undefined
}

describe('GroupMembersScanAdapter', () => {
  it('collapses duplicate users across Groups and preserves first source provenance', async () => {
    const runtime: GroupMembersScanRuntime = {
      async *scan() {
        yield { entityId: '123', displayName: 'Member A', url: 'https://www.facebook.com/profile.php?id=123', sourceGroupId: 'g1', sourceUrl: 'https://www.facebook.com/groups/g1/user/123', username: null, location: null, role: null }
        yield { entityId: '123', displayName: 'Member A', url: 'https://www.facebook.com/profile.php?id=123', sourceGroupId: 'g2', sourceUrl: 'https://www.facebook.com/groups/g2/user/123', username: null, location: null, role: null }
        yield { entityId: 'not-a-uid', displayName: 'Invalid', url: null, sourceGroupId: 'g1', sourceUrl: null, username: null, location: null, role: null }
      }
    }
    const records = []
    for await (const record of new GroupMembersScanAdapter(runtime).scan(input, control)) records.push(record)
    expect(records).toHaveLength(1)
    expect(records[0]?.entityId).toBe('123')
    expect(records[0]?.data.sourceGroupId).toBe('g1')
  })

  it('refuses token source until a Group Members token path is audited', async () => {
    const runtime: GroupMembersScanRuntime = { async *scan() { /* no-op */ } }
    const adapter = new GroupMembersScanAdapter(runtime)
    await expect(async () => {
      for await (const _ of adapter.scan({ ...input, source: { type: 'token', credentialId: 'cred' } }, control)) void _
    }).rejects.toThrow(/Access Token chưa có production path/)
  })
})
