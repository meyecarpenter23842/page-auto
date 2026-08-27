import type { Locator, Page } from 'playwright-core'

const FACEBOOK_POST_LINK_SELECTOR = [
  'a[href*="/posts/"]',
  'a[href*="/permalink/"]',
  'a[href*="permalink.php"]',
  'a[href*="story_fbid="]'
].join(', ')

const FACEBOOK_POST_ID_PATTERN = /^[A-Za-z0-9_-]{3,}$/
const INTERACTIVE_TEXT_TAGS = new Set(['a', 'button'])
const INTERACTIVE_TEXT_ROLES = new Set(['button', 'link', 'menuitem', 'tab'])
const INTERACTIVE_ANCESTOR_SELECTOR = 'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"]'

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

function normalizedPostId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return FACEBOOK_POST_ID_PATTERN.test(normalized) ? normalized : null
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

    const storyId = normalizedPostId(parsed.searchParams.get('story_fbid'))
    if (storyId) return `post:${storyId}`

    const pathMatch = parsed.pathname.match(/\/(?:posts|permalink)\/([^/?#]+)(?:\/|$)/i)
    const pathId = normalizedPostId(pathMatch?.[1])
    if (pathId) return `post:${pathId}`
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

async function hasExactNonInteractiveText(article: Locator, content: string): Promise<boolean> {
  const normalized = normalizeText(content)
  if (!normalized) return false

  const matches = article.getByText(normalized, { exact: true })
  const count = Math.min(await matches.count().catch(() => 0), 20)
  for (let index = 0; index < count; index += 1) {
    const match = matches.nth(index)
    if (!await match.isVisible().catch(() => false)) continue
    const metadata = await match.evaluate((element, interactiveSelector) => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role')?.trim().toLowerCase() ?? '',
      insideInteractive: Boolean(element.closest(interactiveSelector))
    }), INTERACTIVE_ANCESTOR_SELECTOR).catch(() => null)
    if (!metadata) continue
    if (metadata.insideInteractive) continue
    if (INTERACTIVE_TEXT_TAGS.has(metadata.tag) || INTERACTIVE_TEXT_ROLES.has(metadata.role)) continue
    return true
  }
  return false
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
  minimumFingerprintLength = 12,
  allowExactShortContent = false
): Promise<NewPublishedPost | null> {
  if (!baseline.captured) return null
  const fingerprint = publishContentFingerprint(content)
  const minimum = Math.max(1, Math.round(minimumFingerprintLength))
  const canMatchContent = fingerprint.length >= minimum
  const canMatchExactShortContent = allowExactShortContent && fingerprint.length > 0 && !canMatchContent
  if (!canMatchContent && !canMatchExactShortContent && !allowKeyOnly) return null

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
    if (!canMatchContent && !canMatchExactShortContent) continue

    const article = link.locator('xpath=ancestor::*[self::article or @role="article"][1]')
    if (!await article.isVisible().catch(() => false)) continue
    if (canMatchContent) {
      const text = await article.innerText().catch(() => '')
      if (publishContentMatchesAtLeast(text, content, minimum)) return candidate
      continue
    }
    if (canMatchExactShortContent && await hasExactNonInteractiveText(article, content)) return candidate
  }

  return allowKeyOnly ? keyOnlyCandidate : null
}
