import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type NetworkSettings } from '../../shared/appSettings'
import { effectiveNavigationTimeoutMs, runProxyPreflight } from './proxyPreflight'

function settings(patch: Partial<NetworkSettings> = {}): NetworkSettings {
  return { ...DEFAULT_APP_SETTINGS.network, ...patch }
}

describe('proxy preflight', () => {
  it('skips probing when the setting is disabled', async () => {
    const probe = vi.fn(async () => undefined)
    const result = await runProxyPreflight(settings({ checkProxyBeforeRun: false }), probe)

    expect(result).toMatchObject({ status: 'skipped', attempts: 0 })
    expect(probe).not.toHaveBeenCalled()
  })

  it('retries transient proxy failures then succeeds', async () => {
    let calls = 0
    const waits: number[] = []
    const result = await runProxyPreflight(
      settings({ checkProxyBeforeRun: true, proxyRetryCount: 2, proxyConnectionTimeoutMs: 4_000 }),
      async (timeoutMs) => {
        expect(timeoutMs).toBe(4_000)
        calls += 1
        if (calls < 3) throw new Error('secret proxy error must not leak')
      },
      async (milliseconds) => { waits.push(milliseconds) }
    )

    expect(result).toMatchObject({ status: 'success', attempts: 3 })
    expect(waits).toEqual([250, 250])
    expect(result.message).not.toContain('secret proxy error')
  })

  it('fails with a generic message after exhausting configured retries', async () => {
    const result = await runProxyPreflight(
      settings({ checkProxyBeforeRun: true, proxyRetryCount: 1 }),
      async () => { throw new Error('password=do-not-log') },
      async () => undefined
    )

    expect(result).toMatchObject({ status: 'failed', attempts: 2 })
    expect(result.message).not.toContain('do-not-log')
  })

  it('caps navigation by the stricter browser/network timeout', () => {
    expect(effectiveNavigationTimeoutMs(30_000, 12_000)).toBe(12_000)
    expect(effectiveNavigationTimeoutMs(8_000, 30_000)).toBe(8_000)
  })
})
