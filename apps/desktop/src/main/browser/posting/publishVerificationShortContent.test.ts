import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { findNewPublishedPost, type PublishBaseline } from './publishVerification'

function pageWithShortCaption(tag: string, role: string | null, insideInteractive = false): Page {
  const exactMatch = {
    isVisible: async () => true,
    evaluate: async () => ({ tag, role: role ?? '', insideInteractive })
  }
  const exactMatches = {
    count: async () => 1,
    nth: () => exactMatch
  }
  const article = {
    isVisible: async () => true,
    innerText: async () => 'Page header and unrelated controls',
    getByText: () => exactMatches
  }
  const link = {
    getAttribute: async () => '/ExamplePage/posts/pfbidNewShortCaption',
    locator: () => article
  }
  const links = {
    count: async () => 1,
    nth: () => link
  }
  return { locator: () => links } as unknown as Page
}

const baseline: PublishBaseline = {
  captured: true,
  postKeys: new Set(['post:pfbidOld'])
}

describe('Page Wall short-content publish evidence', () => {
  it('accepts a new post key plus an exact non-interactive short caption', async () => {
    await expect(findNewPublishedPost(
      pageWithShortCaption('span', null),
      'OK',
      baseline,
      false,
      12,
      true
    )).resolves.toMatchObject({ postKey: 'post:pfbidNewShortCaption' })
  })

  it('does not accept an interactive element that happens to equal the short caption', async () => {
    await expect(findNewPublishedPost(
      pageWithShortCaption('button', 'button'),
      'OK',
      baseline,
      false,
      12,
      true
    )).resolves.toBeNull()
  })

  it('does not accept short-caption text nested inside an interactive control', async () => {
    await expect(findNewPublishedPost(
      pageWithShortCaption('span', null, true),
      'OK',
      baseline,
      false,
      12,
      true
    )).resolves.toBeNull()
  })
})
