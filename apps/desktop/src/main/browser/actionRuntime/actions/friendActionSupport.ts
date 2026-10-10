import type { Locator, Page } from 'playwright-core'
import type { ActionConfig } from '../../../../shared/actionRegistry'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import {
  configNumber,
  configString,
  firstVisible,
  pickOne,
  pickRange,
  selectedReactions,
  sleepWithControl,
  splitLines,
  visibleSubmittedTextCount,
  waitForSubmittedTextIncrease,
  type BaseViewActionDependencies
} from './actionSupport'

export interface FriendActionDependencies extends BaseViewActionDependencies {}

export const ADD_FRIEND_SELECTORS = [
  '[role="button"][aria-label="Add friend"]',
  '[role="button"][aria-label="Thêm bạn bè"]',
  'div[role="button"]:has-text("Add friend")',
  'div[role="button"]:has-text("Thêm bạn bè")'
] as const

const LIKE_SELECTORS = ['[role="button"][aria-label="Like"]', '[role="button"][aria-label="Thích"]'] as const
const COMMENT_BOX_SELECTORS = [
  '[contenteditable="true"][aria-label*="comment" i]',
  '[contenteditable="true"][aria-label*="bình luận" i]'
] as const
const REACTION_SELECTORS: Record<string, readonly string[]> = {
  like: LIKE_SELECTORS,
  love: ['[role="button"][aria-label="Love"]', '[role="button"][aria-label="Yêu thích"]'],
  care: ['[role="button"][aria-label="Care"]', '[role="button"][aria-label="Thương thương"]'],
  haha: ['[role="button"][aria-label="Haha"]'],
  wow: ['[role="button"][aria-label="Wow"]'],
  sad: ['[role="button"][aria-label="Sad"]', '[role="button"][aria-label="Buồn"]'],
  angry: ['[role="button"][aria-label="Angry"]', '[role="button"][aria-label="Phẫn nộ"]']
}

export function targetUrl(value: string): string {
  const input = value.trim()
  if (/^https?:\/\//i.test(input)) return input
  if (/^(?:www\.)?facebook\.com\//i.test(input)) return `https://${input}`
  return `https://www.facebook.com/${encodeURIComponent(input)}`
}

export function groupMembersUrl(value: string): string {
  const input = value.trim()
  if (/^https?:\/\//i.test(input) || /^(?:www\.)?facebook\.com\//i.test(input)) {
    return `${targetUrl(input).replace(/\/$/, '')}/members`
  }
  return `https://www.facebook.com/groups/${encodeURIComponent(input)}/members`
}

export function configTargets(config: ActionConfig, key: string): string[] {
  return splitLines(configString(config, key))
}

export async function reactAtVisibleLike(page: Page, config: ActionConfig): Promise<boolean> {
  const like = await firstVisible(page, LIKE_SELECTORS)
  if (!like) return false
  const reaction = pickOne(selectedReactions(config)) ?? 'like'
  if (reaction === 'like') return like.click({ timeout: 5000 }).then(() => true).catch(() => false)
  if (!await like.hover({ timeout: 5000 }).then(() => true).catch(() => false)) return false
  const choice = await firstVisible(page, REACTION_SELECTORS[reaction] ?? LIKE_SELECTORS)
  return choice ? choice.click({ timeout: 5000 }).then(() => true).catch(() => false) : false
}

export async function commentAtVisibleBox(page: Page, text: string, imagePath = ''): Promise<boolean> {
  const value = text.trim()
  if (!value) return false
  const box = await firstVisible(page, COMMENT_BOX_SELECTORS)
  if (!box) return false
  const baseline = await visibleSubmittedTextCount(page, value)
  if (imagePath.trim()) {
    const input = page.locator('input[type="file"][accept*="image" i]').first()
    await input.setInputFiles(imagePath.trim()).catch(() => undefined)
  }
  if (!await box.fill(value, { timeout: 5000 }).then(() => true).catch(() => false)) return false
  if (!await box.press('Enter', { timeout: 5000 }).then(() => true).catch(() => false)) return false
  return waitForSubmittedTextIncrease(page, page, value, baseline)
}

export async function paced(context: ActionExecutorContext, config: ActionConfig, completed: number): Promise<boolean> {
  const pauseAfter = configNumber(config, 'pauseAfterCount', 0)
  if (pauseAfter > 0 && completed > 0 && completed % pauseAfter === 0) {
    const pauseMs = configNumber(config, 'pauseMinutes', 0) * 60_000
    if (pauseMs > 0 && !await sleepWithControl(context.control, pauseMs)) return false
  }
  const delaySeconds = pickRange(configNumber(config, 'itemDelayMinSeconds', 0), configNumber(config, 'itemDelayMaxSeconds', 0))
  return sleepWithControl(context.control, delaySeconds * 1000)
}

async function candidateCard(button: Locator): Promise<Locator> {
  return button.locator('xpath=ancestor::div[@role="article"][1]')
}

function mutualCount(text: string): number | null {
  const match = text.match(/(\d[\d.,]*)\s+(?:mutual friends?|bạn chung)/i)
  if (!match?.[1]) return null
  const value = Number(match[1].replace(/[.,]/g, ''))
  return Number.isFinite(value) ? value : null
}

export async function candidateMatches(button: Locator, config: ActionConfig): Promise<boolean> {
  const card = await candidateCard(button)
  const text = await card.innerText().catch(() => '')
  const lower = text.toLocaleLowerCase('vi')
  const locale = configString(config, 'locale').trim().toLocaleLowerCase('vi')
  const location = configString(config, 'locationKeyword').trim().toLocaleLowerCase('vi')
  const hometown = configString(config, 'hometownKeyword').trim().toLocaleLowerCase('vi')
  if (locale && !lower.includes(locale)) return false
  if (location && !lower.includes(location)) return false
  if (hometown && !lower.includes(hometown)) return false
  const mutual = mutualCount(text)
  const min = configNumber(config, 'mutualMin', 0)
  const max = configNumber(config, 'mutualMax', 10000)
  if (mutual !== null && (mutual < min || mutual > max)) return false
  if (config['requireAvatar'] === true && await card.locator('img').count().catch(() => 0) === 0) return false
  return true
}

export async function clickButtons(
  page: Page,
  selectors: readonly string[],
  target: number,
  context: ActionExecutorContext,
  config: ActionConfig,
  filter?: (button: Locator) => Promise<boolean>,
  onRejected?: (button: Locator) => Promise<void>
): Promise<number> {
  let completed = 0
  for (const selector of selectors) {
    const buttons = page.locator(selector)
    const count = await buttons.count().catch(() => 0)
    for (let index = 0; index < count && completed < target; index += 1) {
      if (context.control.isStopped()) return completed
      await context.control.waitIfPaused()
      const button = buttons.nth(index)
      if (!await button.isVisible().catch(() => false)) continue
      if (filter && !await filter(button)) {
        await onRejected?.(button)
        continue
      }
      if (!await button.click({ timeout: 5000 }).then(() => true).catch(() => false)) continue
      completed += 1
      if (!await paced(context, config, completed)) return completed
    }
    if (completed >= target) break
  }
  return completed
}

export async function collectProfileHrefs(page: Page, selectors: readonly string[], limit: number): Promise<string[]> {
  const output: string[] = []
  const seen = new Set<string>()
  for (const selector of selectors) {
    const links = page.locator(selector)
    const count = Math.min(await links.count().catch(() => 0), Math.max(0, limit))
    for (let index = 0; index < count && output.length < limit; index += 1) {
      const href = await links.nth(index).getAttribute('href').catch(() => null)
      if (!href || !/facebook\.com\//i.test(href)) continue
      const clean = href.split('?')[0] ?? href
      if (seen.has(clean)) continue
      seen.add(clean)
      output.push(clean)
    }
    if (output.length >= limit) break
  }
  return output
}
