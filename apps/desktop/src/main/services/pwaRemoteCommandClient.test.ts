import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PwaBridgeSnapshot, PwaGroupPostCommandResult } from '../../shared/pwaBridge'
import { PwaRemoteCommandClient } from './pwaRemoteCommandClient'

const snapshot: PwaBridgeSnapshot = {
  schemaVersion: 1,
  generatedAt: 5_000,
  staleAfterMs: 15_000,
  summary: { totalPages: 1, activePages: 1, pausedPages: 0, successToday: 0, failedToday: 0, nextActionAt: null },
  pages: [],
  recentLogs: []
}

const result: PwaGroupPostCommandResult = {
  schemaVersion: 1,
  commandId: 'remote_command_001',
  target: 'group_post',
  pageTabId: 3,
  action: 'start',
  ok: true,
  code: 'ok',
  message: null,
  handledAt: 5_000,
  fromStatus: 'idle',
  runtimeStatus: 'running',
  runId: 7
}

describe('PwaRemoteCommandClient', () => {
  it('polls a signed command and posts ACK with the authoritative snapshot', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'page-auto-pwa-command-'))
    const relayDirectory = join(dataDirectory, 'pwa-relay')
    await mkdir(relayDirectory, { recursive: true })
    await writeFile(join(relayDirectory, 'credentials.json'), JSON.stringify({
      schemaVersion: 1,
      deviceId: '0123456789abcdef0123456789abcdef',
      deviceToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN1234567890_-'
    }))

    const command = {
      schemaVersion: 1,
      target: 'group_post',
      commandId: 'remote_command_001',
      pageTabId: 3,
      action: 'start',
      issuedAt: 1_000,
      expiresAt: 20_000
    }
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      if (requests.length === 1) return new Response(JSON.stringify({ command }), { status: 200 })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
    const executeCommand = vi.fn(() => result)
    const client = new PwaRemoteCommandClient({
      dataDirectory,
      getSnapshot: () => snapshot,
      executeCommand,
      relayBaseUrl: 'https://relay.example.test',
      fetchImpl
    })

    await client.pollNow()

    expect(executeCommand).toHaveBeenCalledWith(command)
    expect(requests.map((entry) => entry.url)).toEqual([
      'https://relay.example.test/api/relay/command',
      'https://relay.example.test/api/relay/result'
    ])
    const headers = new Headers(requests[0]?.init?.headers)
    expect(headers.get('authorization')).toMatch(/^Bearer /)
    expect(headers.get('x-page-auto-device-id')).toBe('0123456789abcdef0123456789abcdef')
    expect(requests[1]?.init?.body).toBe(JSON.stringify({ result, snapshot }))
  })

  it('does nothing until the snapshot relay has created credentials', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'page-auto-pwa-command-empty-'))
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const client = new PwaRemoteCommandClient({ dataDirectory, getSnapshot: () => snapshot, executeCommand: () => result, fetchImpl })
    await client.pollNow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
