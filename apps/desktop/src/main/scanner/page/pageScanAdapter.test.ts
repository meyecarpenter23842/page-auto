import { describe, expect, it } from 'vitest'
import type { StartScanJobInput } from '../../../shared/scanner'
import { ScanAdapterRuntimeError, type ScanAdapterControl, type ScanAdapterRecord, type ScanControlState } from '../scanAdapter'
import { PageScanAdapter, type PageScanRawRecord, type PageScanRuntime } from './pageScanAdapter'

const control: ScanAdapterControl = {
  isStopped: () => false,
  isPaused: () => false,
  waitIfPaused: async () => true,
  onStateChange: (_listener: (state: ScanControlState) => void) => () => undefined
}

function input(filters: StartScanJobInput['filters'] = {}): StartScanJobInput {
  return {
    scanType: 'page',
    source: { type: 'account', accountId: 1 },
    query: 'demo',
    filters,
    limit: 100
  }
}

function runtime(records: PageScanRawRecord[]): PageScanRuntime {
  return {
    async *scan() {
      for (const record of records) yield record
    }
  }
}

async function collect(adapter: PageScanAdapter, request: StartScanJobInput): Promise<ScanAdapterRecord[]> {
  const results: ScanAdapterRecord[] = []
  for await (const record of adapter.scan(request, control)) results.push(record)
  return results
}

describe('PageScanAdapter', () => {
  it('dedupes by verified Page UID and preserves nullable metadata', async () => {
    const adapter = new PageScanAdapter(runtime([
      { entityId: '100', displayName: 'Page A', url: 'https://www.facebook.com/page.a/', username: 'page.a', category: 'Software', followers: 5000, likes: 4000, location: null, rawText: '', source: 'keyword_search' },
      { entityId: '100', displayName: 'Duplicate', url: null, username: null, category: null, followers: null, likes: null, location: null, rawText: '', source: 'keyword_search' },
      { entityId: '200', displayName: 'Page B', url: 'https://www.facebook.com/200/', username: null, category: null, followers: null, likes: null, location: null, rawText: '', source: 'page_uid_or_url' },
      { entityId: '300', displayName: '300', url: 'https://www.facebook.com/300/', username: null, category: null, followers: null, likes: null, location: null, rawText: '', source: 'page_uid_or_url', status: 'permission_limited' },
      { entityId: 'not-a-uid', displayName: 'Bad', url: null, username: null, category: null, followers: null, likes: null, location: null, rawText: '', source: 'keyword_search' }
    ]))

    const results = await collect(adapter, input())
    expect(results.map((item) => item.entityId)).toEqual(['100', '200', '300'])
    expect(results[0]?.status).toBe('success')
    expect(results[0]?.data).toMatchObject({ username: 'page.a', category: 'Software', followers: 5000, likes: 4000, location: null })
    expect(results[1]?.status).toBe('success')
    expect(results[2]?.status).toBe('permission_limited')
  })

  it('keeps Page filters client-side and excludes unknown metadata when a filter requires it', async () => {
    const adapter = new PageScanAdapter(runtime([
      { entityId: '100', displayName: 'A', url: 'https://www.facebook.com/100/', username: null, category: 'Software', followers: 5000, likes: 3000, location: 'Ho Chi Minh City', rawText: '', source: 'keyword_search' },
      { entityId: '200', displayName: 'B', url: 'https://www.facebook.com/200/', username: null, category: null, followers: null, likes: null, location: null, rawText: '', source: 'keyword_search' }
    ]))
    const results = await collect(adapter, input({ followersMin: 1000, category: 'soft', location: 'chi minh' }))
    expect(results).toHaveLength(1)
    expect(results[0]?.entityId).toBe('100')
    expect(results[0]?.data.filterScope).toBe('client')
  })

  it('rejects token source until a production Page token path is audited', async () => {
    const adapter = new PageScanAdapter(runtime([]))
    const request: StartScanJobInput = { ...input(), source: { type: 'token', credentialId: 'secret-ref' } }
    await expect(collect(adapter, request)).rejects.toMatchObject({
      jobStatus: 'needs_attention'
    } satisfies Partial<ScanAdapterRuntimeError>)
  })
})
