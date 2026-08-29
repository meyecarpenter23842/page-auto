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
  'div[role="button"]:has-text("Đã tham gia")'
] as const

const PENDING_SELECTORS = [
  '[role="button"][aria-label*="Cancel request" i]',
  '[role="button"][aria-label*="Hủy yêu cầu" i]',
  'div[role="button"]:has-text("Pending")',
  'div[role="button"]:has-text("Đang chờ")',
  'div[role="button"]:has-text("Hủy yêu cầu")'
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

export type GroupPrivacy = 'open' | 'closed' | 'unknown'
export type JoinAttemptOutcome = 'joined' | 'requested' | 'skipped_approval' | 'unverified'

export function normalizeGroupUrl(value: string): string {
  const input = value.trim()
  if (/^https?:\/\//i.test(input)) return input
  if (/^(?:www\.)?facebook\.com\//i.test(input)) return `https://${input}`
  return `https://www.facebook.com/groups/${encodeURIComponent(input.replace(/^\/+|\/+$/g, ''))}/`
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

  if (configBoolean(config, 'skipApprovalRequired') && textRequiresApproval(text)) return false

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

export async function joinCandidateText(button: Locator): Promise<string> {
  const article = button.locator('xpath=ancestor::*[@role="article"][1]')
  if (await article.count().catch(() => 0)) {
    const text = await article.innerText().catch(() => '')
    if (text.trim()) return text
  }
  const groupCard = button.locator('xpath=ancestor::div[.//a[contains(@href,"/groups/")]][1]')
  if (await groupCard.count().catch(() => 0)) {
    const text = await groupCard.innerText().catch(() => '')
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

async function fillQuestionAnswers(dialog: Locator, answers: readonly string[]): Promise<void> {
  if (!answers.length) return
  const fields = dialog.locator('textarea, [contenteditable="true"][role="textbox"], input[type="text"]')
  const count = await fields.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index)
    if (!await field.isVisible().catch(() => false)) continue
    const answer = answers[Math.min(index, answers.length - 1)]
    if (!answer) continue
    await field.fill(answer, { timeout: 5000 }).catch(() => undefined)
  }
}

async function verifyJoinOutcome(page: Page, clickedButton: Locator): Promise<JoinAttemptOutcome> {
  const clickedText = await clickedButton.innerText().catch(() => '')
  const clickedLabel = await clickedButton.getAttribute('aria-label').catch(() => null)
  const combined = `${clickedText} ${clickedLabel ?? ''}`
  if (/(?:\bjoined\b|đã tham gia)/i.test(combined)) return 'joined'
  if (/(?:pending|đang chờ|cancel request|hủy yêu cầu)/i.test(combined)) return 'requested'
  if (await firstVisible(page, JOINED_SELECTORS)) return 'joined'
  if (await firstVisible(page, PENDING_SELECTORS)) return 'requested'
  return 'unverified'
}

export async function submitJoinAttempt(
  page: Page,
  button: Locator,
  context: ActionExecutorContext,
  config: ActionConfig
): Promise<JoinAttemptOutcome> {
  if (!await button.click({ timeout: 5000 }).then(() => true).catch(() => false)) return 'unverified'
  if (!await sleepWithControl(context.control, 700)) return 'unverified'

  const dialog = await visibleJoinDialog(page)
  if (dialog) {
    const dialogText = await dialog.innerText().catch(() => '')
    if (configBoolean(config, 'skipApprovalRequired') && textRequiresApproval(dialogText)) {
      const cancel = await firstVisible(dialog, CANCEL_SELECTORS)
      await cancel?.click({ timeout: 5000 }).catch(() => undefined)
      return 'skipped_approval'
    }

    await fillQuestionAnswers(dialog, splitLines(configString(config, 'answerQuestions')))
    const submit = await firstVisible(dialog, SUBMIT_SELECTORS)
    if (submit) {
      await submit.click({ timeout: 5000 }).catch(() => undefined)
      if (!await sleepWithControl(context.control, 700)) return 'unverified'
    }
  }

  return verifyJoinOutcome(page, button)
}

export async function paceJoinGroup(
  context: ActionExecutorContext,
  config: ActionConfig,
  completed: number
): Promise<boolean> {
  const pauseAfter = configNumber(config, 'pauseAfterCount', 0)
  if (pauseAfter > 0 && completed > 0 && completed % pauseAfter === 0) {
    const pauseMs = configNumber(config, 'pauseMinutes', 0) * 60_000
    if (pauseMs > 0 && !await sleepWithControl(context.control, pauseMs)) return false
  }
  const delaySeconds = pickRange(
    configNumber(config, 'itemDelayMinSeconds', 0),
    configNumber(config, 'itemDelayMaxSeconds', 0)
  )
  return sleepWithControl(context.control, delaySeconds * 1000)
}
