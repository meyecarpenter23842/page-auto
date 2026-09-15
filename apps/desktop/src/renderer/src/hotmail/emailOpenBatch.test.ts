import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeEmailOpenConcurrency, runEmailOpenBatch } from './emailOpenBatch'

const hotmailUi = readFileSync(new URL('./HotmailAuto.tsx', import.meta.url), 'utf8')
const compactCss = readFileSync(new URL('./hotmailCompactUx.css', import.meta.url), 'utf8')
const selectionMenu = readFileSync(new URL('../accounts/AccountSelectionMenu.tsx', import.meta.url), 'utf8')

describe('Email manual open batch', () => {
  it('normalizes concurrency to the supported 1..20 range', () => {
    expect(normalizeEmailOpenConcurrency(undefined)).toBe(1)
    expect(normalizeEmailOpenConcurrency(0)).toBe(1)
    expect(normalizeEmailOpenConcurrency(3.9)).toBe(3)
    expect(normalizeEmailOpenConcurrency(99)).toBe(20)
  })

  it('keeps result order while limiting active open requests', async () => {
    let active = 0
    let peak = 0
    const completed: number[] = []

    const results = await runEmailOpenBatch([11, 12, 13, 14, 15], 2, async (accountId) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => setTimeout(resolve, accountId % 2 === 0 ? 5 : 1))
      completed.push(accountId)
      active -= 1
      return `opened-${accountId}`
    })

    expect(peak).toBeLessThanOrEqual(2)
    expect(results).toEqual(['opened-11', 'opened-12', 'opened-13', 'opened-14', 'opened-15'])
    expect(completed).toHaveLength(5)
  })

  it('deduplicates invalid account ids before opening', async () => {
    const opened: number[] = []
    await runEmailOpenBatch([7, 7, -1, 0, 8], 5, async (accountId) => {
      opened.push(accountId)
      return accountId
    })
    expect(opened.sort((a, b) => a - b)).toEqual([7, 8])
  })

  it('keeps the concurrency control outside settings and uses the bounded helper', () => {
    expect(hotmailUi).toContain('Mở đồng thời')
    expect(hotmailUi).toContain('runEmailOpenBatch(ids, openConcurrency')
    expect(hotmailUi).toContain('email-open-concurrency')
  })

  it('renders Email statuses as text-only and portals the context menu to the viewport', () => {
    expect(compactCss).toContain('background:transparent !important')
    expect(compactCss).toContain('.email-chip::before,.recovery-chip::before')
    expect(selectionMenu).toContain('createPortal(menu, document.body)')
    expect(hotmailUi).toContain('className="email-account-context-menu"')
  })
})
