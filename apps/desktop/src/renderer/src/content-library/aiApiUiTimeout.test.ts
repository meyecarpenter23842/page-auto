import { describe, expect, it, vi } from 'vitest'
import { withAiApiUiTimeout } from './aiApiUiTimeout'

describe('AI model test UI timeout', () => {
  it('rejects an unanswered IPC operation within the configured deadline', async () => {
    vi.useFakeTimers()
    try {
      const test = withAiApiUiTimeout(new Promise<never>(() => undefined), 30_000)
      const rejected = expect(test).rejects.toThrow('hết thời gian chờ kiểm tra Model')
      await vi.advanceTimersByTimeAsync(30_000)
      await rejected
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('passes successful test results through without a leftover timer', async () => {
    vi.useFakeTimers()
    try {
      expect(await withAiApiUiTimeout(Promise.resolve(true))).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
