import type { Locator, Page } from 'playwright-core'
import type { BrowserSettings } from '../../../shared/appSettings'
import {
  findNewPublishedPost,
  publishContentFingerprint,
  publishContentMatches,
  type PublishBaseline
} from './publishVerification'

export const POST_SUBMIT_VERIFICATION_DELAY_MS = 2_000
export const POST_SUBMIT_VERIFICATION_POLL_MS = 250
export const POST_SUBMIT_VERIFICATION_SEQUENCE = ['posted', 'pending', 'declined', 'removed', 'posted'] as const
export type PostSubmitContentBucket = (typeof POST_SUBMIT_VERIFICATION_SEQUENCE)[number]

const BUCKET_PATH: Record<PostSubmitContentBucket, string> = {
  posted: 'my_posted_content',
  pending: 'my_pending_content',
  declined: 'my_declined_content',
  removed: 'my_removed_content'
}

const BUCKET_LABEL: Record<PostSubmitContentBucket, string> = {
  posted: 'Đã đăng',
  pending: 'Đang chờ duyệt',
  declined: 'Bị từ chối',
  removed: 'Bị gỡ'
}

export interface PostSubmitVerificationEvidence {
  bucket: PostSubmitContentBucket
  publishedUrl: string | null
}

export interface PostSubmitVerificationSweepResult {
  evidence: PostSubmitVerificationEvidence | null
  visitedBuckets: PostSubmitContentBucket[]
  finalUrl: string
  navigationErrors: number
}

export interface PostSubmitVerificationClock {
  now: () => number
}

export function groupPostSubmitContentUrl(groupUid: string, bucket: PostSubmitContentBucket): string {
  const normalized = groupUid.trim()
  return `https://www.facebook.com/groups/${encodeURIComponent(normalized)}/${BUCKET_PATH[bucket]}`
}

export function postSubmitBucketLabel(bucket: PostSubmitContentBucket): string {
  return BUCKET_LABEL[bucket]
}

export function postSubmitBucketReadinessTimeoutMs(browser: BrowserSettings): number {
  const navigationShare = Math.ceil(
    Math.max(1_000, browser.navigationTimeoutMs) / POST_SUBMIT_VERIFICATION_SEQUENCE.length
  )
  return Math.max(
    POST_SUBMIT_VERIFICATION_DELAY_MS,
    Math.max(0, browser.pageSettleDelayMs),
    navigationShare
  )
}

export async function pollForPostSubmitEvidenceUntilDeadline<T>(
  probe: () => Promise<T | null>,
  deadlineMs: number,
  intervalMs: number,
  sleep: (milliseconds: number) => Promise<void>,
  now: () => number = () => Date.now()
): Promise<T | null> {
  const interval = Math.max(1, Math.round(intervalMs))

  while (true) {
    const value = await probe()
    if (value !== null) return value

    const remainingMs = deadlineMs - now()
    if (remainingMs <= 0) return null
    await sleep(Math.min(interval, remainingMs))
  }
}

async function visibleArticleWithContent(page: Page, content: string): Promise<boolean> {
  const fingerprint = publishContentFingerprint(content)
  if (fingerprint.length < 12) return false

  const articles = page.locator('article, [role="article"]')
  const count = Math.min(await articles.count().catch(() => 0), 120)
  for (let index = 0; index < count; index += 1) {
    const article = articles.nth(index)
    if (!await article.isVisible().catch(() => false)) continue
    const text = await article.innerText().catch(() => '')
    if (publishContentMatches(text, content)) return true
  }

  const textMarker: Locator = page.getByText(fingerprint, { exact: false }).first()
  return textMarker.isVisible().catch(() => false)
}

async function bucketEvidence(
  page: Page,
  bucket: PostSubmitContentBucket,
  content: string,
  baseline: PublishBaseline
): Promise<PostSubmitVerificationEvidence | null> {
  if (bucket === 'posted') {
    const publishedPost = await findNewPublishedPost(page, content, baseline).catch(() => null)
    return publishedPost
      ? { bucket, publishedUrl: publishedPost.publishedUrl }
      : null
  }

  return await visibleArticleWithContent(page, content)
    ? { bucket, publishedUrl: null }
    : null
}

async function waitForBucketEvidence(
  page: Page,
  browser: BrowserSettings,
  bucket: PostSubmitContentBucket,
  content: string,
  baseline: PublishBaseline,
  clock: PostSubmitVerificationClock
): Promise<PostSubmitVerificationEvidence | null> {
  const timeoutMs = postSubmitBucketReadinessTimeoutMs(browser)
  const deadlineMs = clock.now() + timeoutMs
  const initialDelayMs = Math.min(POST_SUBMIT_VERIFICATION_DELAY_MS, timeoutMs)
  if (initialDelayMs > 0) await page.waitForTimeout(initialDelayMs)

  return pollForPostSubmitEvidenceUntilDeadline(
    () => bucketEvidence(page, bucket, content, baseline),
    deadlineMs,
    POST_SUBMIT_VERIFICATION_POLL_MS,
    (milliseconds) => page.waitForTimeout(milliseconds),
    clock.now
  )
}

export async function sweepPostSubmitVerification(
  page: Page,
  browser: BrowserSettings,
  groupUid: string,
  content: string,
  baseline: PublishBaseline,
  clock: PostSubmitVerificationClock = { now: () => Date.now() }
): Promise<PostSubmitVerificationSweepResult> {
  let evidence: PostSubmitVerificationEvidence | null = null
  let navigationErrors = 0
  const visitedBuckets: PostSubmitContentBucket[] = []

  for (const bucket of POST_SUBMIT_VERIFICATION_SEQUENCE) {
    const url = groupPostSubmitContentUrl(groupUid, bucket)
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: browser.navigationTimeoutMs
      })
      visitedBuckets.push(bucket)

      // Keep the established 2-second minimum settle, then poll delayed
      // React/feed evidence against a wall-clock deadline. Probe time counts
      // against the budget so a large DOM cannot multiply a slow scan by a
      // fixed attempt count. Once evidence is confirmed we still visit the
      // remaining buckets so the browser finishes on my_posted_content.
      if (evidence) {
        await page.waitForTimeout(POST_SUBMIT_VERIFICATION_DELAY_MS)
        continue
      }

      evidence = await waitForBucketEvidence(page, browser, bucket, content, baseline, clock)
    } catch {
      navigationErrors += 1
    }
  }

  return {
    evidence,
    visitedBuckets,
    finalUrl: page.url(),
    navigationErrors
  }
}
