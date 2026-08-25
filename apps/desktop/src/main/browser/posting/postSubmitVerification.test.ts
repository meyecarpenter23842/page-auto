import type { Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../../shared/appSettings'
import type { PublishBaseline } from './publishVerification'
import {
  POST_SUBMIT_VERIFICATION_DELAY_MS,
  POST_SUBMIT_VERIFICATION_SEQUENCE,
  groupPostSubmitContentUrl,
  sweepPostSubmitVerification
} from './postSubmitVerification'

class FakeLocator {
  constructor(private readonly texts: string[] = []) {}
  first(): Locator { return this as unknown as Locator }
  nth(index: number): Locator { return new FakeLocator(this.texts[index] ? [this.texts[index]!] : []) as unknown as Locator }
  async count(): Promise<number> { return this.texts.length }
  async isVisible(): Promise<boolean> { return this.texts.length > 0 }
  async innerText(): Promise<string> { return this.texts[0] ?? '' }
  async getAttribute(): Promise<string | null> { return null }
}

function fakePage(contentBucket: 'pending' | null): { page: Page; visits: string[]; waits: number[] } {
  let currentUrl = 'https://www.facebook.com/groups/123/'
  const visits: string[] = []
  const waits: number[] = []

  const page = {
    url: () => currentUrl,
    goto: async (url: string) => {
      currentUrl = url
      visits.push(url)
      return null
    },
    waitForTimeout: async (milliseconds: number) => { waits.push(milliseconds) },
    locator: (selector: string) => {
      if (selector === 'article, [role="article"]' && contentBucket === 'pending' && currentUrl.includes('/my_pending_content')) {
        return new FakeLocator(['Nội dung bài kiểm thử đủ dài để xác nhận đang chờ duyệt.']) as unknown as Locator
      }
      return new FakeLocator() as unknown as Locator
    },
    getByText: () => new FakeLocator() as unknown as Locator
  } as unknown as Page

  return { page, visits, waits }
}

const baseline: PublishBaseline = { captured: true, postKeys: new Set<string>() }
const content = 'Nội dung bài kiểm thử đủ dài để xác nhận đang chờ duyệt.'

describe('post-submit verification sweep', () => {
  it('uses posted -> pending -> declined -> removed -> posted with 2 seconds between loads', async () => {
    expect(POST_SUBMIT_VERIFICATION_SEQUENCE).toEqual(['posted', 'pending', 'declined', 'removed', 'posted'])
    expect(POST_SUBMIT_VERIFICATION_DELAY_MS).toBe(2_000)
    expect(groupPostSubmitContentUrl('123', 'posted')).toBe('https://www.facebook.com/groups/123/my_posted_content')
    expect(groupPostSubmitContentUrl('123', 'pending')).toBe('https://www.facebook.com/groups/123/my_pending_content')
    expect(groupPostSubmitContentUrl('123', 'declined')).toBe('https://www.facebook.com/groups/123/my_declined_content')
    expect(groupPostSubmitContentUrl('123', 'removed')).toBe('https://www.facebook.com/groups/123/my_removed_content')

    const fake = fakePage('pending')
    const result = await sweepPostSubmitVerification(
      fake.page,
      { ...DEFAULT_APP_SETTINGS.browser },
      '123',
      content,
      baseline
    )

    expect(result.visitedBuckets).toEqual(['posted', 'pending', 'declined', 'removed', 'posted'])
    expect(fake.waits).toEqual([2_000, 2_000, 2_000, 2_000, 2_000])
    expect(result.evidence).toEqual({ bucket: 'pending', publishedUrl: null })
    expect(result.finalUrl).toBe('https://www.facebook.com/groups/123/my_posted_content')
  })

  it('still finishes on my_posted_content when no matching item is found', async () => {
    const fake = fakePage(null)
    const result = await sweepPostSubmitVerification(
      fake.page,
      { ...DEFAULT_APP_SETTINGS.browser },
      '123',
      content,
      baseline
    )

    expect(result.evidence).toBeNull()
    expect(result.navigationErrors).toBe(0)
    expect(result.finalUrl).toBe('https://www.facebook.com/groups/123/my_posted_content')
  })
})
