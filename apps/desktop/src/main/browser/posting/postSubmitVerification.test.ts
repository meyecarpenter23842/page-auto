import type { Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '../../../shared/appSettings'
import type { PublishBaseline } from './publishVerification'
import {
  POST_SUBMIT_VERIFICATION_DELAY_MS,
  POST_SUBMIT_VERIFICATION_SEQUENCE,
  groupPostSubmitContentUrl,
  pollForPostSubmitEvidenceUntilDeadline,
  postSubmitBucketReadinessTimeoutMs,
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

function fakePage(
  contentBucket: 'pending' | null,
  readyAfterMs = 0
): {
  page: Page
  visits: string[]
  waits: number[]
  now: () => number
  evidenceObservedAfterMs: () => number | null
} {
  let currentUrl = 'https://www.facebook.com/groups/123/'
  let elapsedSinceNavigation = 0
  let clockNow = 0
  let observedAfterMs: number | null = null
  const visits: string[] = []
  const waits: number[] = []

  const page = {
    url: () => currentUrl,
    goto: async (url: string) => {
      currentUrl = url
      elapsedSinceNavigation = 0
      visits.push(url)
      return null
    },
    waitForTimeout: async (milliseconds: number) => {
      waits.push(milliseconds)
      elapsedSinceNavigation += milliseconds
      clockNow += milliseconds
    },
    locator: (selector: string) => {
      if (
        selector === 'article, [role="article"]'
        && contentBucket === 'pending'
        && currentUrl.includes('/my_pending_content')
        && elapsedSinceNavigation >= readyAfterMs
      ) {
        observedAfterMs ??= elapsedSinceNavigation
        return new FakeLocator(['Nội dung bài kiểm thử đủ dài để xác nhận đang chờ duyệt.']) as unknown as Locator
      }
      return new FakeLocator() as unknown as Locator
    },
    getByText: () => new FakeLocator() as unknown as Locator
  } as unknown as Page

  return {
    page,
    visits,
    waits,
    now: () => clockNow,
    evidenceObservedAfterMs: () => observedAfterMs
  }
}

const baseline: PublishBaseline = { captured: true, postKeys: new Set<string>() }
const content = 'Nội dung bài kiểm thử đủ dài để xác nhận đang chờ duyệt.'
const browser = { ...DEFAULT_APP_SETTINGS.browser }

describe('post-submit verification sweep', () => {
  it('uses posted -> pending -> declined -> removed -> posted and scales readiness from browser timing', async () => {
    expect(POST_SUBMIT_VERIFICATION_SEQUENCE).toEqual(['posted', 'pending', 'declined', 'removed', 'posted'])
    expect(POST_SUBMIT_VERIFICATION_DELAY_MS).toBe(2_000)
    expect(postSubmitBucketReadinessTimeoutMs(browser)).toBe(6_000)
    expect(groupPostSubmitContentUrl('123', 'posted')).toBe('https://www.facebook.com/groups/123/my_posted_content')
    expect(groupPostSubmitContentUrl('123', 'pending')).toBe('https://www.facebook.com/groups/123/my_pending_content')
    expect(groupPostSubmitContentUrl('123', 'declined')).toBe('https://www.facebook.com/groups/123/my_declined_content')
    expect(groupPostSubmitContentUrl('123', 'removed')).toBe('https://www.facebook.com/groups/123/my_removed_content')

    const fake = fakePage('pending')
    const result = await sweepPostSubmitVerification(
      fake.page,
      browser,
      '123',
      content,
      baseline,
      { now: fake.now }
    )

    expect(result.visitedBuckets).toEqual(['posted', 'pending', 'declined', 'removed', 'posted'])
    expect(result.evidence).toEqual({ bucket: 'pending', publishedUrl: null })
    expect(result.finalUrl).toBe('https://www.facebook.com/groups/123/my_posted_content')
    expect(fake.waits.reduce((total, value) => total + value, 0)).toBe(14_000)
  })

  it('keeps polling when a slow feed renders after the old fixed 2-second settle', async () => {
    const fake = fakePage('pending', 3_000)
    const result = await sweepPostSubmitVerification(
      fake.page,
      browser,
      '123',
      content,
      baseline,
      { now: fake.now }
    )

    expect(result.evidence).toEqual({ bucket: 'pending', publishedUrl: null })
    expect(fake.evidenceObservedAfterMs()).toBe(3_000)
    expect(fake.waits).toContain(250)
  })

  it('bounds a no-evidence sweep by the configured per-bucket readiness deadline and finishes on posted', async () => {
    const fake = fakePage(null)
    const result = await sweepPostSubmitVerification(
      fake.page,
      browser,
      '123',
      content,
      baseline,
      { now: fake.now }
    )

    expect(result.evidence).toBeNull()
    expect(result.navigationErrors).toBe(0)
    expect(result.finalUrl).toBe('https://www.facebook.com/groups/123/my_posted_content')
    expect(fake.waits.reduce((total, value) => total + value, 0)).toBe(30_000)
  })

  it('counts expensive probe duration against the wall-clock deadline instead of launching every nominal poll', async () => {
    let now = 0
    let probes = 0
    let sleeps = 0

    const result = await pollForPostSubmitEvidenceUntilDeadline(
      async () => {
        probes += 1
        now += 2_200
        return null
      },
      6_000,
      250,
      async (milliseconds) => {
        sleeps += 1
        now += milliseconds
      },
      () => now
    )

    expect(result).toBeNull()
    expect(probes).toBe(3)
    expect(sleeps).toBe(2)
    expect(now).toBe(7_100)
  })

  it('honors a larger configured page-settle budget on slow pages', () => {
    expect(postSubmitBucketReadinessTimeoutMs({
      ...browser,
      navigationTimeoutMs: 20_000,
      pageSettleDelayMs: 9_000
    })).toBe(9_000)
  })
})
