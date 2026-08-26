import type { Page } from 'playwright-core'
import type { PostingCheckpointKind } from '../../../shared/posting'

export const FACEBOOK_CHECKPOINT_CLASSIFY_TIMEOUT_MS = 10_000
const CHECKPOINT_POLL_MS = 250
const KNOWN_CHECKPOINTS = ['282', '956'] as const

function knownCheckpointSuffix(value: string): '282' | '956' | null {
  const normalized = value.trim().toLowerCase()
  for (const code of KNOWN_CHECKPOINTS) {
    if (normalized === code || normalized.endsWith(code)) return code
  }
  return null
}

export function facebookCheckpointKindFromUrl(rawUrl: string): PostingCheckpointKind | null {
  try {
    const parsed = new URL(rawUrl)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const checkpointIndex = segments.findIndex((segment) => segment.toLowerCase() === 'checkpoint')
    if (checkpointIndex < 0) return null

    const pathId = segments[checkpointIndex + 1] ?? ''
    const pathKind = knownCheckpointSuffix(pathId)
    if (pathKind) return pathKind

    for (const key of ['checkpoint_code', 'checkpoint_type', 'checkpoint', 'cp']) {
      const value = parsed.searchParams.get(key)
      if (!value) continue
      const queryKind = knownCheckpointSuffix(value)
      if (queryKind) return queryKind
    }
    return 'unknown'
  } catch {
    return null
  }
}

export function facebookCheckpointKindFromText(text: string): '282' | '956' | null {
  const value = text.match(/\b(?:checkpoint|check\s*point|cp)\s*[:#-]?\s*(282|956)\b/i)?.[1]
  return value === '282' || value === '956' ? value : null
}

async function inspectCheckpointKind(page: Page): Promise<PostingCheckpointKind | null> {
  const urlKind = facebookCheckpointKindFromUrl(page.url())
  if (urlKind === '282' || urlKind === '956' || urlKind === null) return urlKind

  const bodyText = await page.locator('body').innerText({ timeout: 1_000 }).catch(() => '')
  return facebookCheckpointKindFromText(bodyText) ?? 'unknown'
}

/**
 * Observe an already-detected Facebook checkpoint for at most 10 seconds.
 * Time is only a classification window: 282/956 are determined from URL/DOM,
 * never inferred merely because the timeout elapsed.
 */
export async function detectFacebookCheckpointKind(
  page: Page,
  timeoutMs = FACEBOOK_CHECKPOINT_CLASSIFY_TIMEOUT_MS
): Promise<PostingCheckpointKind | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  let latest = await inspectCheckpointKind(page)
  if (latest === '282' || latest === '956' || latest === null) return latest

  while (Date.now() < deadline) {
    await page.waitForTimeout(Math.min(CHECKPOINT_POLL_MS, Math.max(1, deadline - Date.now())))
    latest = await inspectCheckpointKind(page)
    if (latest === '282' || latest === '956' || latest === null) return latest
  }
  return latest
}
