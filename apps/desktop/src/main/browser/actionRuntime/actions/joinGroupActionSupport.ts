import type { Locator, Page } from 'playwright-core'
import type { ActionConfig } from '../../../../shared/actionRegistry'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import {
  configBoolean,
  configNumber,
  configString,
  firstVisible,
  pickRange,
  sleepWithControl,
  splitLines,
  type BaseViewActionDependencies
} from './actionSupport'

export interface JoinGroupActionDependencies extends BaseViewActionDependencies {}

export const JOIN_GROUP_SELECTORS = [
  '[role="button"][aria-label="Join group"]',
  '[role="button"][aria-label="Tham gia nhóm"]',
  'div[role="button"]:has-text("Join group")',
  'div[role="button"]:has-text("Tham gia nhóm")',
  'button:has-text("Join group")',
  'button:has-text("Tham gia nhóm")'
] as const

const JOINED_SELECTORS = [
  '[role="button"][aria-label="Joined"]',
  '[role="button"][aria-label="Đã tham gia"]',
  'div[role="button"]:has-text("Joined")',
  'div[role="button"]:has-text("Đã tham gia")',
  'button:has-text("Joined")',
  'button:has-text("Đã tham gia")'
] as const

const PENDING_SELECTORS = [
  '[role="button"][aria-label*="Cancel request" i]',
  '[role="button"][aria-label*="Hủy yêu cầu" i]',
  'div[role="button"]:has-text("Pending")',
  'div[role="button"]:has-text("Đang chờ")',
  'div[role="button"]:has-text("Hủy yêu cầu")',
  'button:has-text("Pending")',
  'button:has-text("Đang chờ")',
  'button:has-text("Hủy yêu cầu")'
] as const

const SUBMIT_SELECTORS = [
  'div[role="button"]:has-text("Submit")',
  'div[role="button"]:has-text("Gửi")',
  'button:has-text("Submit")',
  'button:has-text("Gửi")',
  'div[role="button"]:has-text("Join group")',
  'div[role="button"]:has-text("Tham gia nhóm")'
] as const

const CANCEL_SELECTORS = [
  'div[role="button"]:has-text("Cancel")',
  'div[role="button"]:has-text("Hủy")',
  'button:has-text("Cancel")',
  'button:has-text("Hủy")',
  '[aria-label="Close"]',
  '[aria-label="Đóng"]'
] as const

const NON_GROUP_SURFACES = new Set(['discover', 'feed', 'joins', 'notifications', 'search'])

export type GroupPrivacy = 'open' | 'closed' | 'unknown'
export type JoinAttemptOutcome = 'joined' | 'requested' | 'skipped_approval' | 'unverified'

export function normalizeGroupUrl(value: string): string {
  const input = value.trim()
  if (/^https?:\/\//i.test(input)) return input
  if (/^(?:www\.)?facebook\.com\//i.test(input)) return `https://${input}`
  return `https://www.facebook.com/groups/${encodeURIComponent(input.replace(/^\/+|\/+$/g, ''))}/`
}

export function canAttemptAnotherJoin(attempted: number, target: number): boolean {
  return attempted < Math.max(0, target)
}

export function crossedJoinPauseThreshold(previous: number, current: number, every: number): boolean {
  if (every <= 0 || current <= previous) return false
  return Math.floor(previous / every) < Math.floor(current / every)
}

export function groupIdentityFromHref(value: string): string | null {
  try {
    const url = new URL(value, 'https://www.facebook.com')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0]?.toLocaleLowerCase() !== 'groups' || !parts[1]) return null
    const identity = decodeURIComponent(parts[1]).trim()
    if (!identity || NON_GROUP_SURFACES.has(identity.toLocaleLowerCase())) return null
    return identity
  } catch {
    return null
  }
}

export function isDirectGroupPageUrl(value: string): boolean {
  return groupIdentityFromHref(value) !== null
}

function compactNumber(raw: string, suffix: string | undefined): number | null {
  const source = raw.trim().replace(/\s+/g, '')
  if (!source) return null
  let normalized = source
  if (suffix) {
    if (source.includes(',') && !source.includes('.')) normalized = source.replace(',', '.')
  } else {
    normalized = source.replace(/[.,](?=\d{3}(?:\D|$))/g, '')
  }
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  const factor = suffix?.toLocaleLowerCase() === 'k'
    ? 1_000
    : suffix?.toLocaleLowerCase() === 'm'
      ? 1_000_000
      : 1
  return Math.round(value * factor)
}

export function extractGroupMemberCount(text: string): number | null {
  const match = text.match(/(\d[\d.,]*)\s*([kKmM])?\s*(?:members?|thành viên)/i)
  if (!match?.[1]) return null
  return compactNumber(match[1], match[2])
}

export function detectGroupPrivacy(text: string): GroupPrivacy {
  if (/(?:\bpublic\b|công khai|\bopen\b)/i.test(text)) return 'open'
  if (/(?:\bprivate\b|riêng tư|\bclosed\b|\bsecret\b|bí mật)/i.test(text)) return 'closed'
  return 'unknown'
}

export function textRequiresApproval(text: string): boolean {
  return /(?:admin approval|requires? approval|membership approval|admin must approve|phải (?:được )?phê duyệt|cần phê duyệt|yêu cầu phê duyệt|quản trị viên phê duyệt)/i.test(text)
}

export function shouldSkipApprovalRequest(config: ActionConfig): boolean {
  return configBoolean(config, 'skipApprovalRequired') && !configString(config, 'answerQuestions').trim()
}

function localeMatches(text: string, locale: string): boolean {
  const normalized = locale.trim().toLocaleLowerCase()
  if (!normalized) return true
  if (normalized.startsWith('vi')) return /(?:thành viên|công khai|riêng tư|tham gia|quản trị viên)/i.test(text)
  if (normalized.startsWith('en')) return /(?:members?|public|private|join|admin)/i.test(text)
  return text.toLocaleLowerCase().includes(normalized)
}

export function groupTextMatchesFilters(text: string, config: ActionConfig): boolean {
  if (configBoolean(config, 'memberFilterEnabled')) {
    const members = extractGroupMemberCount(text)
    if (members === null || members < configNumber(config, 'memberMin', 0)) return false
  }

  const privacy = detectGroupPrivacy(text)
  const allowOpen = configBoolean(config, 'privacyOpen')
  const allowClosed = configBoolean(config, 'privacyClosed')
  if (privacy === 'open' && !allowOpen) return false
  if (privacy === 'closed' && !allowClosed) return false
  if (privacy === 'unknown' && !(allowOpen && allowClosed)) return false

  if (shouldSkipApprovalRequest(config) && textRequiresApproval(text)) return false

  if (configBoolean(config, 'locationEnabled')) {
    const location = configString(config, 'locationKeyword').trim().toLocaleLowerCase()
    if (location && !text.toLocaleLowerCase().includes(location)) return false
  }

  if (configBoolean(config, 'localeEnabled') && !localeMatches(text, configString(config, 'locale'))) return false
  return true
}

export function configuredGroupTargets(config: ActionConfig): string[] {
  return splitLines(configString(config, 'sourceTargets'))
}

async function candidateContainer(button: Locator): Promise<Locator | null> {
  const article = button.locator('xpath=ancestor::*[@role="article"][1]')
  if (await article.count().catch(() => 0)) return article
  const groupCard = button.locator('xpath=ancestor::div[.//a[contains(@href,"/groups/")]][1]')
  if (await groupCard.count().catch(() => 0)) return groupCard
  return null
}

async function candidateGroupIdentity(button: Locator): Promise<string | null> {
  const container = await candidateContainer(button)
  if (!container) return null
  const links = container.locator('a[href*="/groups/"]')
  const count = await links.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const href = await links.nth(index).getAttribute('href').catch(() => null)
    const identity = href ? groupIdentityFromHref(href) : null
    if (identity) return identity
  }
  return null
}

async function candidateContainerByIdentity(page: Page, identity: string): Promise<Locator | null> {
  const links = page.locator('a[href*="/groups/"]')
  const count = await links.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index)
    const href = await link.getAttribute('href').catch(() => null)
    if (!href || groupIdentityFromHref(href) !== identity) continue

    const article = link.locator('xpath=ancestor::*[@role="article"][1]')
    if (await article.count().catch(() => 0)) return article
    const groupCard = link.locator('xpath=ancestor::div[.//a[contains(@href,"/groups/")]][1]')
    if (await groupCard.count().catch(() => 0)) return groupCard
  }
  return null
}

export async function joinCandidateText(button: Locator): Promise<string> {
  const container = await candidateContainer(button)
  if (container) {
    const text = await container.innerText().catch(() => '')
    if (text.trim()) return text
  }
  return button.innerText().catch(() => '')
}

export async function findSurfaceJoinButtons(page: Page): Promise<Locator | null> {
  for (const selector of JOIN_GROUP_SELECTORS) {
    const buttons = page.locator(selector)
    if (await buttons.count().catch(() => 0)) return buttons
  }
  return null
}

async function visibleJoinDialog(page: Page): Promise<Locator | null> {
  const dialogs = page.locator('[role="dialog"]')
  const count = await dialogs.count().catch(() => 0)
  for (let index = count - 1; index >= 0; index -= 1) {
    const dialog = dialogs.nth(index)
    if (!await dialog.isVisible().catch(() => false)) continue
    const text = await dialog.innerText().catch(() => '')
    if (/(?:join|tham gia|question|câu hỏi|approval|phê duyệt)/i.test(text)) return dialog
  }
  return null
}

async function fillQuestionAnswers(
  dialog: Locator,
  answers: readonly string[],
  context: ActionExecutorContext
): Promise<number> {
  if (!answers.length) return 0
  const fields = dialog.locator('textarea, [contenteditable="true"][role="textbox"], input[type="text"]')
  const count = await fields.count().catch(() => 0)
  let filled = 0
  for (let index = 0; index < count; index += 1) {
    if (context.control.isStopped()) return filled
    await context.control.waitIfPaused()
    if (context.control.isStopped()) return filled
    const field = fields.nth(index)
    if (!await field.isVisible().catch(() => false)) continue
    const answer = answers[Math.min(index, answers.length - 1)]
    if (!answer) continue
    const didFill = await field.fill(answer, { timeout: 5000 }).then(() => true).catch(() => false)
    if (didFill) filled += 1
  }
  return filled
}

async function verifyJoinOutcome(page: Page, candidateIdentity: string | null): Promise<JoinAttemptOutcome> {
  if (candidateIdentity) {
    const candidate = await candidateContainerByIdentity(page, candidateIdentity)
    if (candidate) {
      if (await firstVisible(candidate, JOINED_SELECTORS)) return 'joined'
      if (await firstVisible(candidate, PENDING_SELECTORS)) return 'requested'
    }
  }

  if (isDirectGroupPageUrl(page.url())) {
    if (await firstVisible(page, JOINED_SELECTORS)) return 'joined'
    if (await firstVisible(page, PENDING_SELECTORS)) return 'requested'
  }

  return 'unverified'
}

export async function submitJoinAttempt(
  page: Page,
  button: Locator,
  context: ActionExecutorContext,
  config: ActionConfig
): Promise<JoinAttemptOutcome> {
  const candidateIdentity = await candidateGroupIdentity(button)
  if (!await button.click({ timeout: 5000 }).then(() => true).catch(() => false)) return 'unverified'

  // Technical settle only lets the dialog/state render. Facebook Common Runtime owns operator pacing.
  if (!await sleepWithControl(context.control, 700)) return 'unverified'

  const dialog = await visibleJoinDialog(page)
  if (dialog) {
    const dialogText = await dialog.innerText().catch(() => '')
    if (shouldSkipApprovalRequest(config) && textRequiresApproval(dialogText)) {
      const cancel = await firstVisible(dialog, CANCEL_SELECTORS)
      await cancel?.click({ timeout: 5000 }).catch(() => undefined)
      return 'skipped_approval'
    }

    await fillQuestionAnswers(
      dialog,
      splitLines(configString(config, 'answerQuestions')),
      context
    )
    const submit = await firstVisible(dialog, SUBMIT_SELECTORS)
    if (submit) {
      if (context.control.isStopped()) return 'unverified'
      await submit.click({ timeout: 5000 }).catch(() => undefined)
      if (!await sleepWithControl(context.control, 700)) return 'unverified'
    }
  }

  return verifyJoinOutcome(page, candidateIdentity)
}

export async function paceJoinGroup(
  context: ActionExecutorContext,
  config: ActionConfig,
  previousAttempted: number,
  currentAttempted: number
): Promise<boolean> {
  const pauseAfter = configNumber(config, 'pauseAfterCount', 0)
  if (crossedJoinPauseThreshold(previousAttempted, currentAttempted, pauseAfter)) {
    const pauseMs = configNumber(config, 'pauseMinutes', 0) * 60_000
    if (pauseMs > 0 && !await sleepWithControl(context.control, pauseMs)) return false
  }

  const delaySeconds = pickRange(
    configNumber(config, 'itemDelayMinSeconds', 0),
    configNumber(config, 'itemDelayMaxSeconds', 0)
  )
  return sleepWithControl(context.control, delaySeconds * 1000)
}
