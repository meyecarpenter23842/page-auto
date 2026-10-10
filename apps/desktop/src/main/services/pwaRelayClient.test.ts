import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PwaBridgeSnapshot } from '../../shared/pwaBridge'
import { PwaRelayClient } from './pwaRelayClient'

const snapshot = {
  schemaVersion: 1,
  generatedAt: 1_789_000_000_000,
  staleAfterMs: 15_000,
  summary: { totalPages: 0, activePages: 0, pausedPages: 0, successToday: 0, failedToday: 0, nextActionAt: null },
  pages: [],
  recentLogs: []
} as PwaBridgeSnapshot

describe('PwaRelayClient', () => {
  it('creates stable local credentials and pushes a signed channel snapshot without exposing the token in the body', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'page-auto-pwa-relay-'))
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const first = new PwaRelayClient({
      dataDirectory,
      getSnapshot: () => snapshot,
      relayBaseUrl: 'https://relay.example.test/',
      fetchImpl
    })
    await first.pushNow()

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://relay.example.test/api/relay/push')
    const headers = new Headers(requests[0]?.init?.headers)
    expect(headers.get('authorization')).toMatch(/^Bearer [A-Za-z0-9_-]{40,96}$/)
    expect(headers.get('x-page-auto-device-id')).toMatch(/^[a-f0-9]{32}$/)
    expect(requests[0]?.init?.body).toBe(JSON.stringify({ snapshot }))
    expect(String(requests[0]?.init?.body)).not.toContain(headers.get('authorization') ?? 'Bearer never')

    const code = await first.getPairingCode()
    const pairingFile = await readFile(first.getPairingFilePath(), 'utf8')
    expect(pairingFile).toContain(`?pair=${code}`)
    expect(pairingFile).toContain('Không chia sẻ')

    const second = new PwaRelayClient({
      dataDirectory,
      getSnapshot: () => snapshot,
      relayBaseUrl: 'https://relay.example.test',
      fetchImpl
    })
    expect(await second.getPairingCode()).toBe(code)
  })

  it('skips network pushes when only generatedAt changes and pushes again for meaningful snapshot changes', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'page-auto-pwa-relay-dedupe-'))
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch
    let currentSnapshot: PwaBridgeSnapshot = { ...snapshot, summary: { ...snapshot.summary } }
    const client = new PwaRelayClient({
      dataDirectory,
      getSnapshot: () => currentSnapshot,
      relayBaseUrl: 'https://relay.example.test',
      fetchImpl
    })

    await client.pushNow()
    currentSnapshot = { ...currentSnapshot, generatedAt: currentSnapshot.generatedAt + 5_000 }
    await client.pushNow()
    expect(requests).toHaveLength(1)

    currentSnapshot = {
      ...currentSnapshot,
      generatedAt: currentSnapshot.generatedAt + 5_000,
      summary: { ...currentSnapshot.summary, totalPages: 1 }
    }
    await client.pushNow()
    expect(requests).toHaveLength(2)
  })
})
