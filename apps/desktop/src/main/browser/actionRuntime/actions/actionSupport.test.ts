import type { Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { firstVisible } from './actionSupport'

function candidate(visible: boolean): Locator {
  return {
    isVisible: async () => visible
  } as unknown as Locator
}

function candidateList(items: Locator[]): Locator {
  return {
    count: async () => items.length,
    nth: (index: number) => items[index]!
  } as unknown as Locator
}

describe('actionSupport firstVisible', () => {
  it('skips hidden duplicate controls and returns the first actually visible candidate', async () => {
    const hidden = candidate(false)
    const visible = candidate(true)
    const direct = candidateList([hidden, visible])
    const empty = candidateList([])
    const scope = {
      locator: () => direct,
      getByRole: () => empty
    } as unknown as Page

    await expect(firstVisible(scope, ['[role="button"][aria-label="Like"]'])).resolves.toBe(visible)
  })

  it('falls back to accessible button role so native Facebook buttons are supported', async () => {
    const nativeButton = candidate(true)
    const empty = candidateList([])
    const accessible = candidateList([nativeButton])
    const scope = {
      locator: () => empty,
      getByRole: () => accessible
    } as unknown as Page

    await expect(firstVisible(scope, ['[role="button"][aria-label="Like"]'])).resolves.toBe(nativeButton)
  })

  it('uses the same accessible fallback for Vietnamese Like controls', async () => {
    const vietnameseButton = candidate(true)
    const empty = candidateList([])
    const accessible = candidateList([vietnameseButton])
    const scope = {
      locator: () => empty,
      getByRole: () => accessible
    } as unknown as Page

    await expect(firstVisible(scope, ['[role="button"][aria-label="Thích"]'])).resolves.toBe(vietnameseButton)
  })
})
