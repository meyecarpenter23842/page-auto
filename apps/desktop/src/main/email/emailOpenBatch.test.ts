import { describe, expect, it } from 'vitest'
import { normalizeHotmailOpenConcurrency, runHotmailOpenBatch } from './emailOpenBatch'

describe('Email Main open batch', () => {
  it('normalizes concurrency to the supported 1..20 range', () => {
    expect(normalizeHotmailOpenConcurrency(undefined)).toBe(1)
    expect(normalizeHotmailOpenConcurrency(0)).toBe(1)
    expect(normalizeHotmailOpenConcurrency(3.9)).toBe(3)
    expect(normalizeHotmailOpenConcurrency(99)).toBe(20)
  })

  it('keeps result order while limiting active opens', async () => {
    let active = 0
    let peak = 0
    const results = await runHotmailOpenBatch([11, 12, 13, 14, 15], 2, async (accountId) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => setTimeout(resolve, accountId % 2 === 0 ? 5 : 1))
      active -= 1
      return `opened-${accountId}`
    })

    expect(peak).toBeLessThanOrEqual(2)
    expect(results).toEqual(['opened-11', 'opened-12', 'opened-13', 'opened-14', 'opened-15'])
  })

  it('deduplicates invalid account ids before opening', async () => {
    const opened: number[] = []
    await runHotmailOpenBatch([7, 7, -1, 0, 8], 5, async (accountId) => {
      opened.push(accountId)
      return accountId
    })
    expect(opened.sort((a, b) => a - b)).toEqual([7, 8])
  })
})
