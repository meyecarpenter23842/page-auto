import { describe, expect, it } from 'vitest'
import type { StartScanJobInput } from '../../../shared/scanner'
import type { ScanAdapterControl } from '../scanAdapter'
import { UserScanAdapter, type UserScanRuntime } from './userScanAdapter'

const input: StartScanJobInput = {
  scanType: 'user',
  source: { type: 'account', accountId: 1 },
  query: '123',
  filters: {},
  limit: 10
}

const control: ScanAdapterControl = {
  isStopped: () => false,
  isPaused: () => false,
  waitIfPaused: async () => true,
  onStateChange: () => () => undefined
}

describe('UserScanAdapter', () => {
  it('keeps only verified numeric canonical user identities and deduplicates UID', async () => {
    const runtime: UserScanRuntime = {
      async *scan() {
        yield { entityId: '123', displayName: 'User A', url: 'https://www.facebook.com/user.a/', username: 'user.a', location: null, gender: null, followers: 12, source: 'profile_uid_or_url' }
        yield { entityId: '123', displayName: 'Duplicate', url: null, username: null, location: null, gender: null, followers: null, source: 'profile_uid_or_url' }
        yield { entityId: 'not-a-uid', displayName: 'Invalid', url: null, username: null, location: null, gender: null, followers: null, source: 'profile_uid_or_url' }
      }
    }
    const records = []
    for await (const record of new UserScanAdapter(runtime).scan(input, control)) records.push(record)
    expect(records).toHaveLength(1)
    expect(records[0]?.entityId).toBe('123')
    expect(records[0]?.data.username).toBe('user.a')
  })

  it('refuses token source until a User token path is audited', async () => {
    const runtime: UserScanRuntime = { async *scan() { /* no-op */ } }
    const adapter = new UserScanAdapter(runtime)
    await expect(async () => {
      for await (const _ of adapter.scan({ ...input, source: { type: 'token', credentialId: 'cred' } }, control)) void _
    }).rejects.toThrow(/Access Token chưa có production path/)
  })
})
