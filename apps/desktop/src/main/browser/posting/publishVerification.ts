import type { Locator, Page } from 'playwright-core'

const FACEBOOK_POST_LINK_SELECTOR = [
  'a[href*="/posts/"]',
  'a[href*="/permalink/"]',
  'a[href*="permalink.php"]',
  'a[href*="story_fbid="]'
].join(', ')

export interface PublishBaseline {
  captured: boolean
  postKeys: ReadonlySet<string>
}

export interface NewPublishedPost {
  publishedUrl: string
  postKey: string
}

function normalizeText(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

export function groupMyPostedContentUrl(groupUid: string): string {
  const normalized = groupUid.trim()
  return `https://www.facebook.com/groups/${encodeURIComponent(normalized)}/my_posted_content`
}

export function publishContentFingerprint(content: string): string {
  return normalizeText(content).slice(0, 48)
}

export function publishContentMatchesAtLeast(
  renderedText: string,
  content: string,
  minimumFingerprintLength = 12
): boolean {
  const fingerprint = publishContentFingerprint(content)
  const minimum = Math.max(1, Math.round(minimumFingerprintLength))
  return fingerprint.length >= minimum && normalizeText(renderedText).includes(fingerprint)
}

export function publishContentMatches(renderedText: string, content: string): boolean {
  return publishContentMatchesAtLeast(renderedText, content, 12)
}

export function facebookPostKey(rawHref: string | null | undefined): string | null {
  if (!rawHref?.trim()) return null
  try {
    const parsed = new URL(rawHref, 'https://www.facebook.com')
    const hostname = parsed.hostname.toLowerCase()
    if (hostname !== 'facebook.com' && !hostname.endsWith('.facebook.com')) return null

    const storyId = parsed.searchParams.get('story_fbid')?.trim()
    if (storyId && /^\d+$/.test(storyId)) return `post:${storyId}`

    const pathMatch = parsed.pathname.match(/\/(?:posts|permalink)\/(\d+)(?:\/|$)/i)
    if (pathMatch?.[1]) return `post:${pathMatch[1]}`
    return null
  } catch {
    return null
  }
}

export function absoluteFacebookPostUrl(rawHref: string): string | null {
  if (!facebookPostKey(rawHref)) return null
  try {
    return new URL(rawHref, 'https://www.facebook.com').toString()
  } catch {
    return null
  }
}

async function collectPostKeys(root: Page | Locator): Promise<Set<string>> {
  const links = root.locator(FACEBOOK_POST_LINK_SELECTOR)
  const count = await links.count()
  const keys = new Set<string>()
  for (let index = 0; index < count; index += 1) {
    const href = await links.nth(index).getAttribute('href').catch(() => null)
    const key = facebookPostKey(href)
    if (key) keys.add(key)
  }
  return keys
}

export async function capturePublishBaseline(page: Page): Promise<PublishBaseline> {
  try {
    return { captured: true, postKeys: await collectPostKeys(page) }
  } catch {
    return { captured: false, postKeys: new Set<string>() }
  }
}

export function isNewFacebookPostHref(rawHref: string | null | undefined, baseline: PublishBaseline): boolean {
  if (!baseline.captured) return false
  const key = facebookPostKey(rawHref)
  return Boolean(key && !baseline.postKeys.has(key))
}

export async function findNewPublishedPost(
  page: Page,
  content: string,
  baseline: PublishBaseline,
  allowKeyOnly = false,
  minimumFingerprintLength = 12
): Promise<NewPublishedPost | null> {
  if (!baseline.captured) return null
  const fingerprint = publishContentFingerprint(content)
  const minimum = Math.max(1, Math.round(minimumFingerprintLength))
  const canMatchContent = fingerprint.length >= minimum
  if (!canMatchContent && !allowKeyOnly) return null

  const links = page.locator(FACEBOOK_POST_LINK_SELECTOR)
  const linkCount = Math.min(await links.count(), 400)
  let keyOnlyCandidate: NewPublishedPost | null = null

  for (let linkIndex = 0; linkIndex < linkCount; linkIndex += 1) {
    const link = links.nth(linkIndex)
    const href = await link.getAttribute('href').catch(() => null)
    if (!isNewFacebookPostHref(href, baseline) || !href) continue

    const postKey = facebookPostKey(href)
    const publishedUrl = absoluteFacebookPostUrl(href)
    if (!postKey || !publishedUrl) continue
    const candidate = { postKey, publishedUrl }
    if (!keyOnlyCandidate) keyOnlyCandidate = candidate
    if (!canMatchContent) continue

    const article = link.locator('xpath=ancestor::*[self::article or @role="article"][1]')
    if (!await article.isVisible().catch(() => false)) continue
    const text = await article.innerText().catch(() => '')
    if (publishContentMatchesAtLeast(text, content, minimum)) return candidate
  }

  return allowKeyOnly ? keyOnlyCandidate : null
}
