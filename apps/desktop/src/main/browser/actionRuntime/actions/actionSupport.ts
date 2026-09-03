import type { Locator, Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionRunControl, ActionRunRequest } from '../../../../shared/actionRuntime'
import { pollActionVerificationState } from '../actionVerification'

export type ActionPageResolver = (request: ActionRunRequest) => Promise<Page | null>

export interface BaseViewActionDependencies {
  resolvePage: ActionPageResolver
  navigationTimeoutMs?: number
}

export function configNumber(config: ActionConfig, key: string, fallback = 0): number {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function configBoolean(config: ActionConfig, key: string): boolean {
  return config[key] === true
}

export function configString(config: ActionConfig, key: string): string {
  const value = config[key]
  return typeof value === 'string' ? value : ''
}

export function selectedReactions(config: ActionConfig): string[] {
  const mapping = [
    ['reactionLike', 'like'], ['reactionLove', 'love'], ['reactionCare', 'care'],
    ['reactionHaha', 'haha'], ['reactionWow', 'wow'], ['reactionSad', 'sad'], ['reactionAngry', 'angry']
  ] as const
  const selected = mapping.filter(([key]) => configBoolean(config, key)).map(([, reaction]) => reaction)
  return selected.length ? selected : ['like']
}

export function splitLines(value: string): string[] {
  return value.split(/\r?\n|\|/).map((item) => item.trim()).filter(Boolean)
}

export function pickRange(min: number, max: number): number {
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  return high <= low ? low : Math.floor(low + Math.random() * (high - low + 1))
}

export function pickOne<T>(items: readonly T[]): T | undefined {
  return items.length ? items[Math.floor(Math.random() * items.length)] : undefined
}

export function shuffled<T>(items: readonly T[]): T[] {
  const output = [...items]
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const current = output[index]
    output[index] = output[target]!
    output[target] = current!
  }
  return output
}

export async function sleepWithControl(control: ActionRunControl, delayMs: number): Promise<boolean> {
  let remaining = Math.max(0, delayMs)
  while (remaining > 0) {
    if (control.isStopped()) return false
    await control.waitIfPaused()
    if (control.isStopped()) return false
    const chunk = Math.min(1000, remaining)
    await control.sleep(chunk)
    remaining -= chunk
  }
  return !control.isStopped()
}

const MAX_VISIBLE_CANDIDATES_PER_SELECTOR = 32
const MAX_RENDERED_TEXT_CANDIDATES = 100
const SUBMITTED_TEXT_VERIFY_TIMEOUT_MS = 3000
const SUBMITTED_TEXT_VERIFY_POLL_MS = 150
const CLICKABLE_TEXT_ANCESTOR = 'xpath=ancestor-or-self::*[self::button or @role="button" or @tabindex="0" or self::a][1]'

function exactAriaButtonName(selector: string): string | null {
  return selector.match(/^\[role="button"\]\[aria-label="([^"]+)"\]$/)?.[1] ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function firstVisibleCandidate(locator: Locator): Promise<Locator | null> {
  const count = Math.min(await locator.count().catch(() => 0), MAX_VISIBLE_CANDIDATES_PER_SELECTOR)
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function clickableTextFallback(scope: Page | Locator, name: string): Promise<Locator | null> {
  const textMatches = scope.getByText(name, { exact: true })
  const count = Math.min(await textMatches.count().catch(() => 0), MAX_VISIBLE_CANDIDATES_PER_SELECTOR)
  for (let index = 0; index < count; index += 1) {
    const text = textMatches.nth(index)
    if (!await text.isVisible().catch(() => false)) continue

    const clickable = text.locator(CLICKABLE_TEXT_ANCESTOR).first()
    if (await clickable.isVisible().catch(() => false)) return clickable

    // Facebook sometimes puts the visible Like/Thích text inside a clickable wrapper that exposes
    // neither role=button nor a stable aria-label/tabindex. Clicking the visible text itself still
    // bubbles through the real control, and is safer than guessing another unstable selector.
    return text
  }
  return null
}

async function accessibleButtonFallback(scope: Page | Locator, name: string): Promise<Locator | null> {
  const exact = await firstVisibleCandidate(scope.getByRole('button', { name, exact: true }))
  if (exact) return exact

  if (!/^(?:Like|Thích)$/i.test(name)) return null
  const prefix = new RegExp(`^${escapeRegExp(name)}(?:$|\\s|[:.,])`, 'i')
  const accessible = await firstVisibleCandidate(scope.getByRole('button', { name: prefix }))
  if (accessible) return accessible

  return clickableTextFallback(scope, name)
}

export async function firstVisible(page: Page | Locator, selectors: readonly string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const direct = await firstVisibleCandidate(page.locator(selector))
    if (direct) return direct

    const accessibleName = exactAriaButtonName(selector)
    if (!accessibleName) continue
    const fallback = await accessibleButtonFallback(page, accessibleName)
    if (fallback) return fallback
  }
  return null
}

async function isRenderedSubmittedText(candidate: Locator): Promise<boolean> {
  if (!await candidate.isVisible().catch(() => false)) return false
  return candidate.evaluate((element) => {
    return element.closest('[contenteditable="true"], [role="textbox"], textarea, input') === null
  }).catch(() => false)
}

/**
 * Counts rendered exact text while ignoring composer/editor content. This lets comment actions
 * distinguish a real DOM mutation from text that is merely still sitting in the input after Enter.
 */
export async function visibleSubmittedTextCount(scope: Page | Locator, text: string): Promise<number> {
  const value = text.trim()
  if (!value) return 0
  const matches = scope.getByText(value, { exact: true })
  const count = Math.min(await matches.count().catch(() => 0), MAX_RENDERED_TEXT_CANDIDATES)
  let visible = 0
  for (let index = 0; index < count; index += 1) {
    if (await isRenderedSubmittedText(matches.nth(index))) visible += 1
  }
  return visible
}

/**
 * Verifies that submitting text created a new rendered occurrence. Existing identical comments are
 * safe because callers capture the baseline before filling the composer.
 */
export async function waitForSubmittedTextIncrease(
  page: Page,
  scope: Page | Locator,
  text: string,
  baseline: number,
  timeoutMs = SUBMITTED_TEXT_VERIFY_TIMEOUT_MS
): Promise<boolean> {
  const value = text.trim()
  if (!value) return false
  const verified = await pollActionVerificationState(
    async () => await visibleSubmittedTextCount(scope, value) > baseline ? true : null,
    {
      timeoutMs,
      intervalMs: SUBMITTED_TEXT_VERIFY_POLL_MS,
      wait: (delayMs) => page.waitForTimeout(delayMs).then(() => true).catch(() => false)
    }
  )
  return verified === true
}

export async function clickFirstVisible(page: Page | Locator, selectors: readonly string[]): Promise<boolean> {
  const locator = await firstVisible(page, selectors)
  if (!locator) return false
  await locator.scrollIntoViewIfNeeded().catch(() => undefined)
  return locator.click({ timeout: 5000 }).then(() => true).catch(() => false)
}

export function browserUnavailable(label: string): ActionResult {
  return { status: 'failed', code: 'browser_unavailable', message: `${label}: không lấy được Playwright Page từ runtime.` }
}

export function navigationFailed(label: string, cause: unknown): ActionResult {
  return {
    status: 'failed',
    code: 'navigation_failed',
    message: `${label}: không mở được surface Facebook.`,
    data: { reason: cause instanceof Error ? cause.name : 'navigation_error' }
  }
}
