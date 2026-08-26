import type { Locator, Page } from 'playwright-core'
import type { BrowserSettings } from '../../../shared/appSettings'
import {
  findNewPublishedPost,
  publishContentFingerprint,
  publishContentMatches,
  type PublishBaseline
} from './publishVerification'

export const POST_SUBMIT_VERIFICATION_DELAY_MS = 2_000
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

export function groupPostSubmitContentUrl(groupUid: string, bucket: PostSubmitContentBucket): string {
  const normalized = groupUid.trim()
  return `https://www.facebook.com/groups/${encodeURIComponent(normalized)}/${BUCKET_PATH[bucket]}`
}

export function postSubmitBucketLabel(bucket: PostSubmitContentBucket): string {
  return BUCKET_LABEL[bucket]
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

export async function sweepPostSubmitVerification(
  page: Page,
  browser: BrowserSettings,
  groupUid: string,
  content: string,
  baseline: PublishBaseline
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
      await page.waitForTimeout(POST_SUBMIT_VERIFICATION_DELAY_MS)

      if (evidence) continue

      if (bucket === 'posted') {
        const publishedPost = await findNewPublishedPost(page, content, baseline).catch(() => null)
        if (publishedPost) {
          evidence = { bucket, publishedUrl: publishedPost.publishedUrl }
        }
        continue
      }

      if (await visibleArticleWithContent(page, content)) {
        evidence = { bucket, publishedUrl: null }
      }
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
