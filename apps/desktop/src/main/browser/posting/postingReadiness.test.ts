import { describe, expect, it, vi } from 'vitest'
import { pollForReady, readinessAttempts } from './postingReadiness'

describe('posting readiness polling', () => {
  it('returns immediately when the first probe is ready', async () => {
    const sleep = vi.fn(async () => undefined)
    const probe = vi.fn(async () => 'ready')

    await expect(pollForReady(probe, { attempts: 5, intervalMs: 250, sleep })).resolves.toBe('ready')
    expect(probe).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('waits across transient not-ready states instead of failing after one check', async () => {
    const sleep = vi.fn(async () => undefined)
    let count = 0

    const result = await pollForReady(async () => {
      count += 1
      return count >= 3 ? 'ready' : null
    }, { attempts: 5, intervalMs: 250, sleep })

    expect(result).toBe('ready')
    expect(count).toBe(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('returns null after the configured readiness window is exhausted', async () => {
    const sleep = vi.fn(async () => undefined)
    const probe = vi.fn(async () => null)

    await expect(pollForReady(probe, { attempts: 3, intervalMs: 250, sleep })).resolves.toBeNull()
    expect(probe).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('converts timeout windows to bounded polling attempts', () => {
    expect(readinessAttempts(12_000, 250)).toBe(48)
    expect(readinessAttempts(0, 250)).toBe(1)
    expect(readinessAttempts(1_001, 250)).toBe(5)
  })
})
