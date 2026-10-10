import { describe, expect, it } from 'vitest'
import type { Locator } from 'playwright-core'
import {
  isPageWallUsePageAccessibleName,
  probePageWallUsePagePrompt,
  resolvePageWallUsePageDecision,
  waitForPageWallUsePageDismissal,
  type PageWallUsePageResolution
} from './pageWallUsePagePrompt'

describe('Page Wall Use Page prompt ownership', () => {
  it('matches only the supported Use Page labels', () => {
    expect(isPageWallUsePageAccessibleName('Use Page')).toBe(true)
    expect(isPageWallUsePageAccessibleName('Use this Page')).toBe(true)
    expect(isPageWallUsePageAccessibleName('Dùng Trang')).toBe(true)
    expect(isPageWallUsePageAccessibleName('Sử dụng Trang này')).toBe(true)
    expect(isPageWallUsePageAccessibleName('Use profile')).toBe(false)
    expect(isPageWallUsePageAccessibleName('Continue')).toBe(false)
  })

  it('clicks exactly one owned CTA and refuses ambiguous matches', () => {
    expect(resolvePageWallUsePageDecision(0)).toBe('skip')
    expect(resolvePageWallUsePageDecision(1)).toBe('click')
    expect(resolvePageWallUsePageDecision(2)).toBe('ambiguous')
  })

  it('keeps a short bounded probe alive when the dialog appears after the first sample', async () => {
    const button = {} as Locator
    const samples: PageWallUsePageResolution[] = [
      { button: null, visibleDialogCount: 0, candidateCount: 0 },
      { button: null, visibleDialogCount: 0, candidateCount: 0 },
      { button, visibleDialogCount: 1, candidateCount: 1 }
    ]
    const waits: number[] = []
    let index = 0

    const result = await probePageWallUsePagePrompt({
      resolve: async () => samples[Math.min(index++, samples.length - 1)]!,
      wait: async (delayMs) => { waits.push(delayMs) },
      graceMs: 500,
      pollMs: 100
    })

    expect(result).toEqual({ button, visibleDialogCount: 1, candidateCount: 1 })
    expect(waits).toEqual([100, 100])
  })

  it('stops probing after the configured grace window when no popup appears', async () => {
    let resolves = 0
    const waits: number[] = []

    const result = await probePageWallUsePagePrompt({
      resolve: async () => {
        resolves += 1
        return { button: null, visibleDialogCount: 0, candidateCount: 0 }
      },
      wait: async (delayMs) => { waits.push(delayMs) },
      graceMs: 300,
      pollMs: 100
    })

    expect(result.candidateCount).toBe(0)
    expect(resolves).toBe(4)
    expect(waits).toEqual([100, 100, 100])
  })

  it('verifies the owned CTA is really gone after click instead of trusting a stale locator', async () => {
    const button = {} as Locator
    const samples: PageWallUsePageResolution[] = [
      { button, visibleDialogCount: 1, candidateCount: 1 },
      { button, visibleDialogCount: 1, candidateCount: 1 },
      { button: null, visibleDialogCount: 0, candidateCount: 0 }
    ]
    let index = 0

    await expect(waitForPageWallUsePageDismissal({
      resolve: async () => samples[Math.min(index++, samples.length - 1)]!,
      wait: async () => undefined,
      graceMs: 300,
      pollMs: 100
    })).resolves.toBe(true)
  })
})
