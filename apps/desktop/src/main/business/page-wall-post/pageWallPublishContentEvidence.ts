import type { Locator, Page } from 'playwright-core'
import { publishContentFingerprint } from '../../browser/posting/publishVerification'

const PAGE_WALL_EXACT_TEXT_SCAN_LIMIT = 80
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

/**
 * Count exact, visible, non-interactive occurrences of the submitted wall text on the
 * Page's main surface. This intentionally avoids assuming that role=article is a post.
 */
export async function countPageWallContentMatches(page: Page, content: string): Promise<number> {
  const normalized = normalizeText(content)
  if (!normalized) return 0

  const matches = page.getByText(normalized, { exact: true })
  const count = Math.min(await matches.count().catch(() => 0), PAGE_WALL_EXACT_TEXT_SCAN_LIMIT)
  let ownedMatches = 0
  for (let index = 0; index < count; index += 1) {
    if (await isOwnedWallContentMatch(matches.nth(index))) ownedMatches += 1
  }
  return ownedMatches
}

export async function capturePageWallContentBaseline(
  page: Page,
  content: string
): Promise<PageWallContentBaseline> {
  const normalized = normalizeText(content)
  const fingerprint = publishContentFingerprint(normalized)
  if (!fingerprint) return { captured: false, fingerprint: '', matchCount: 0 }

  try {
    return {
      captured: true,
      fingerprint,
      matchCount: await countPageWallContentMatches(page, normalized)
    }
  } catch {
    return { captured: false, fingerprint, matchCount: 0 }
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

export async function hasNewPageWallContentEvidence(
  page: Page,
  content: string,
  baseline: PageWallContentBaseline
): Promise<boolean> {
  if (!baseline.captured || !normalizeText(content)) return false
  const currentMatchCount = await countPageWallContentMatches(page, content)
  return pageWallContentCountIncreased(baseline, content, currentMatchCount)
}
