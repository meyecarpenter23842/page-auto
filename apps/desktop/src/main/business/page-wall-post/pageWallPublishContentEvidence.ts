import type { Locator, Page } from 'playwright-core'
import { publishContentFingerprint } from '../../browser/posting/publishVerification'

const PAGE_WALL_TEXT_SCAN_LIMIT = 80
const PAGE_WALL_FINGERPRINT_MIN = 12
const EXCLUDED_ANCESTOR_SELECTOR = [
  'a',
  'button',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[role="alert"]',
  '[role="status"]'
].join(', ')
const MAIN_SURFACE_SELECTOR = 'main, [role="main"]'

export interface PageWallContentBaseline {
  captured: boolean
  fingerprint: string
  matchCount: number
  fingerprintMatchCount?: number
}

function normalizeText(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

async function isOwnedWallContentMatch(locator: Locator): Promise<boolean> {
  if (!await locator.isVisible().catch(() => false)) return false
  return locator.evaluate((element, selectors) => {
    if (element.closest(selectors.excluded)) return false
    return Boolean(element.closest(selectors.main))
  }, {
    excluded: EXCLUDED_ANCESTOR_SELECTOR,
    main: MAIN_SURFACE_SELECTOR
  }).catch(() => false)
}

async function countOwnedWallTextMatches(page: Page, text: string, exact: boolean): Promise<number> {
  const normalized = normalizeText(text)
  if (!normalized) return 0

  const matches = page.getByText(normalized, { exact })
  const count = Math.min(await matches.count().catch(() => 0), PAGE_WALL_TEXT_SCAN_LIMIT)
  let ownedMatches = 0
  for (let index = 0; index < count; index += 1) {
    if (await isOwnedWallContentMatch(matches.nth(index))) ownedMatches += 1
  }
  return ownedMatches
}

/**
 * Count exact, visible, non-interactive occurrences of the submitted wall text on the
 * Page's main surface. This intentionally avoids assuming that role=article is a post.
 */
export function countPageWallContentMatches(page: Page, content: string): Promise<number> {
  return countOwnedWallTextMatches(page, content, true)
}

/**
 * Facebook can split/truncate a rendered post body, so a full exact-text match is not
 * always present even when the post is visible. Count a sufficiently long leading
 * fingerprint on the owned main surface as a secondary baseline signal.
 */
export async function countPageWallFingerprintMatches(page: Page, content: string): Promise<number> {
  const fingerprint = publishContentFingerprint(normalizeText(content))
  if (fingerprint.length < PAGE_WALL_FINGERPRINT_MIN) return 0
  return countOwnedWallTextMatches(page, fingerprint, false)
}

export async function capturePageWallContentBaseline(
  page: Page,
  content: string
): Promise<PageWallContentBaseline> {
  const normalized = normalizeText(content)
  const fingerprint = publishContentFingerprint(normalized)
  if (!fingerprint) return { captured: false, fingerprint: '', matchCount: 0, fingerprintMatchCount: 0 }

  try {
    const [matchCount, fingerprintMatchCount] = await Promise.all([
      countPageWallContentMatches(page, normalized),
      countPageWallFingerprintMatches(page, normalized)
    ])
    return {
      captured: true,
      fingerprint,
      matchCount,
      fingerprintMatchCount
    }
  } catch {
    return { captured: false, fingerprint, matchCount: 0, fingerprintMatchCount: 0 }
  }
}

export function pageWallContentCountIncreased(
  baseline: PageWallContentBaseline,
  content: string,
  currentMatchCount: number
): boolean {
  if (!baseline.captured) return false
  if (baseline.fingerprint !== publishContentFingerprint(normalizeText(content))) return false
  return Number.isInteger(currentMatchCount) && currentMatchCount > baseline.matchCount
}

export function pageWallFingerprintCountIncreased(
  baseline: PageWallContentBaseline,
  content: string,
  currentFingerprintMatchCount: number
): boolean {
  if (!baseline.captured) return false
  const fingerprint = publishContentFingerprint(normalizeText(content))
  if (fingerprint.length < PAGE_WALL_FINGERPRINT_MIN || baseline.fingerprint !== fingerprint) return false
  return Number.isInteger(currentFingerprintMatchCount)
    && currentFingerprintMatchCount > (baseline.fingerprintMatchCount ?? 0)
}

export async function hasNewPageWallContentEvidence(
  page: Page,
  content: string,
  baseline: PageWallContentBaseline
): Promise<boolean> {
  if (!baseline.captured || !normalizeText(content)) return false
  const [currentMatchCount, currentFingerprintMatchCount] = await Promise.all([
    countPageWallContentMatches(page, content),
    countPageWallFingerprintMatches(page, content)
  ])
  return pageWallContentCountIncreased(baseline, content, currentMatchCount)
    || pageWallFingerprintCountIncreased(baseline, content, currentFingerprintMatchCount)
}
