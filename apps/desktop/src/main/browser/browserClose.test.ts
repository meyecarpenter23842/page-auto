import { describe, expect, it } from 'vitest'
import { closeBrowserTarget } from './browserClose'

describe('closeBrowserTarget', () => {
  it('closes once when Chrome accepts shutdown', async () => {
    let calls = 0
    const target = { close: async () => { calls += 1 } }

    await closeBrowserTarget(target, 'Chrome test', { retryDelayMs: 0 })

    expect(calls).toBe(1)
  })

  it('retries one rejected Chrome close before succeeding', async () => {
    let calls = 0
    const target = {
      close: async () => {
        calls += 1
        if (calls === 1) throw new Error('CDP đang bận')
      }
    }

    await closeBrowserTarget(target, 'Chrome test', { retryDelayMs: 0 })

    expect(calls).toBe(2)
  })

  it('propagates a repeated close failure instead of reporting false success', async () => {
    let calls = 0
    const target = {
      close: async () => {
        calls += 1
        throw new Error(`lỗi lần ${calls}`)
      }
    }

    await expect(closeBrowserTarget(target, 'Chrome account #20', { retryDelayMs: 0 }))
      .rejects.toThrow('Chrome account #20 không đóng được sau 2 lần thử')
    expect(calls).toBe(2)
  })
})
