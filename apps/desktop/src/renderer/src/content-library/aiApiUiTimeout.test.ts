import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { withAiApiUiTimeout } from './aiApiUiTimeout'

const panel = readFileSync(fileURLToPath(new URL('./AiApiConnectionPanel.tsx', import.meta.url)), 'utf8')

describe('AI model test UI timeout', () => {
  it('offers 60/120-second model tests, real cancellation and verified-only saving', () => {
    expect(panel).toContain('AI_MODEL_TEST_TIMEOUT_OPTIONS_MS.map')
    expect(panel).toContain('window.pageAuto.cancelAiApiTest(requestId)')
    expect(panel).toContain("activeTestId.current !== requestId")
    expect(panel).toContain('||tested!==modelId')
    expect(panel).toContain('||editingTested!==editingSelected')
  })
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
