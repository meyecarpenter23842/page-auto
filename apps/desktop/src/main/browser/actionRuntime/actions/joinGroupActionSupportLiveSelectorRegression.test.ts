import { describe, expect, it } from 'vitest'
import type { Locator, Page } from 'playwright-core'
import { JOIN_GROUP_SELECTORS, findSurfaceJoinButtons } from './joinGroupActionSupport'

function locator(input: { count?: number; visible?: boolean }): Locator {
  const count = input.count ?? 1
  const visible = input.visible ?? true
  const item = {
    count: async () => count,
    isVisible: async () => visible,
    first() { return this },
    nth() { return this },
    locator() { return this }
  }
  return item as unknown as Locator
}

describe('K4.3.1 live Join selector regression', () => {
  it('ignores a hidden stale selector match and keeps searching for the visible responsive Join control', async () => {
    const hiddenStale = locator({ visible: false })
    const visibleResponsive = locator({ visible: true })
    const empty = locator({ count: 0, visible: false })

    const page = {
      locator: (selector: string) => {
        if (selector === JOIN_GROUP_SELECTORS[0]) return hiddenStale
        if (selector === JOIN_GROUP_SELECTORS[2]) return visibleResponsive
        return empty
      }
    } as unknown as Page

    const result = await findSurfaceJoinButtons(page)

    expect(result).toBe(visibleResponsive)
  })

  it('keeps the first non-empty locator only as a diagnostic fallback when every match is hidden', async () => {
    const hidden = locator({ visible: false })
    const empty = locator({ count: 0, visible: false })
    const page = {
      locator: (selector: string) => selector === JOIN_GROUP_SELECTORS[0] ? hidden : empty
    } as unknown as Page

    expect(await findSurfaceJoinButtons(page)).toBe(hidden)
  })
})
