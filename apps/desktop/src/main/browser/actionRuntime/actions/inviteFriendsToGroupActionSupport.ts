import type { Locator, Page } from 'playwright-core'
import type { ActionConfig } from '../../../../shared/actionRegistry'
import type { ActionExecutorContext } from '../../../services/actionRunner'
import {
  configNumber,
  configString,
  firstVisible,
  pickRange,
  sleepWithControl,
  splitLines,
  type BaseViewActionDependencies
} from './actionSupport'

export interface InviteFriendsToGroupActionDependencies extends BaseViewActionDependencies {}

export interface InviteBatchOutcome {
  invited: number
  unverified: number
  candidates: number
  exhausted: boolean
}

const OPEN_INVITE_SELECTORS = [
  '[role="button"][aria-label*="Invite friends" i]',
  '[role="button"][aria-label*="Invite people" i]',
  '[role="button"][aria-label*="Mời bạn bè" i]',
  '[role="button"][aria-label*="Mời mọi người" i]',
  'div[role="button"]:has-text("Invite friends")',
  'div[role="button"]:has-text("Invite people")',
  'div[role="button"]:has-text("Mời bạn bè")',
  'div[role="button"]:has-text("Mời mọi người")',
  'button:has-text("Invite friends")',
  'button:has-text("Mời bạn bè")',
  '[role="button"][aria-label="Invite"]',
  '[role="button"][aria-label="Mời"]'
] as const

const ROW_INVITE_SELECTORS = [
  '[role="button"][aria-label^="Invite " i]',
  '[role="button"][aria-label^="Mời " i]',
  'div[role="button"]:text-is("Invite")',
  'div[role="button"]:text-is("Mời")',
  'button:text-is("Invite")',
  'button:text-is("Mời")'
] as const

const CHECKBOX_SELECTORS = [
  '[role="checkbox"]',
  'input[type="checkbox"]'
] as const

const SUBMIT_INVITES_SELECTORS = [
  'div[role="button"]:has-text("Send invites")',
  'div[role="button"]:has-text("Send invite")',
  'div[role="button"]:has-text("Gửi lời mời")',
  'div[role="button"]:has-text("Invite selected")',
  'div[role="button"]:has-text("Mời người đã chọn")',
  'button:has-text("Send invites")',
  'button:has-text("Gửi lời mời")',
] as const

const CLOSE_DIALOG_SELECTORS = [
  '[aria-label="Close"]',
  '[aria-label="Đóng"]',
  'div[role="button"]:has-text("Cancel")',
  'div[role="button"]:has-text("Hủy")',
  'button:has-text("Cancel")',
  'button:has-text("Hủy")'
] as const

const INVITE_DIALOG_TEXT = /(?:invite friends?|invite people|select (?:friends?|people)|mời bạn bè|mời mọi người|chọn bạn bè|chọn người)/i
const VERIFIED_INVITE_TEXT = /(?:\binvited\b|invite sent|invites sent|cancel invite|remove invite|đã mời|lời mời đã gửi|hủy lời mời)/i
const INVITE_WORDS = /(?:send invites?|gửi lời mời|đã mời|invite(?:d)?|mời)/gi

export function normalizeInviteGroupUrl(value: string): string {
  const input = value.trim()
  if (/^https?:\/\//i.test(input)) return input
  if (/^(?:www\.)?facebook\.com\//i.test(input)) return `https://${input}`
  return `https://www.facebook.com/groups/${encodeURIComponent(input.replace(/^\/+|\/+$/g, ''))}/`
}

export function configuredInviteGroupTargets(config: ActionConfig): string[] {
  return splitLines(configString(config, 'groupTargets'))
}

export function crossedPauseThreshold(previous: number, current: number, every: number): boolean {
  if (every <= 0 || current <= previous) return false
  return Math.floor(previous / every) < Math.floor(current / every)
}

async function locatorText(locator: Locator): Promise<string> {
  const text = await locator.innerText().catch(() => '')
  const aria = await locator.getAttribute('aria-label').catch(() => null)
  return `${text} ${aria ?? ''}`.replace(/\s+/g, ' ').trim()
}

async function candidateContainer(control: Locator): Promise<Locator | null> {
  const listItem = control.locator('xpath=ancestor::*[@role="listitem"][1]')
  if (await listItem.count().catch(() => 0)) return listItem
  const article = control.locator('xpath=ancestor::*[@role="article"][1]')
  if (await article.count().catch(() => 0)) return article
  const profileRow = control.locator('xpath=ancestor::div[count(.//a[@role="link"]) >= 1 and count(.//a[@role="link"]) <= 3][1]')
  if (await profileRow.count().catch(() => 0)) return profileRow
  return null
}

export function inviteCandidateSignature(text: string): string {
  const normalized = text
    .replace(INVITE_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.length >= 2 ? normalized.slice(0, 400) : ''
}

async function candidateSignature(control: Locator): Promise<string> {
  const container = await candidateContainer(control)
  if (!container) return ''
  return inviteCandidateSignature(await locatorText(container))
}

async function visibleInviteDialog(page: Page): Promise<Locator | null> {
  const dialogs = page.locator('[role="dialog"]')
  const count = await dialogs.count().catch(() => 0)
  for (let index = count - 1; index >= 0; index -= 1) {
    const dialog = dialogs.nth(index)
    if (!await dialog.isVisible().catch(() => false)) continue
    if (INVITE_DIALOG_TEXT.test(await dialog.innerText().catch(() => ''))) return dialog
  }
  return null
}

async function openInviteDialog(page: Page, context: ActionExecutorContext): Promise<Locator | null> {
  const existing = await visibleInviteDialog(page)
  if (existing) return existing

  const main = page.locator('[role="main"]').first()
  const scopes: Array<Page | Locator> = []
  if (await main.count().catch(() => 0)) scopes.push(main)
  scopes.push(page)

  for (const scope of scopes) {
    const button = await firstVisible(scope, OPEN_INVITE_SELECTORS)
    if (!button) continue
    if (!await button.click({ timeout: 5000 }).then(() => true).catch(() => false)) continue
    if (!await sleepWithControl(context.control, 600)) return null
    const dialog = await visibleInviteDialog(page)
    if (dialog) return dialog
  }
  return null
}

async function closeInviteDialog(page: Page, dialog: Locator): Promise<void> {
  const close = await firstVisible(dialog, CLOSE_DIALOG_SELECTORS)
  if (close) {
    await close.click({ timeout: 3000 }).catch(() => undefined)
    return
  }
  await page.keyboard.press('Escape').catch(() => undefined)
}

async function verifyRowInvite(control: Locator, container: Locator | null, context: ActionExecutorContext): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!await sleepWithControl(context.control, 350)) return false
    const controlState = await locatorText(control)
    const rowState = container ? await locatorText(container) : ''
    if (VERIFIED_INVITE_TEXT.test(`${controlState} ${rowState}`)) return true
  }
  return false
}

async function inviteWithRowButtons(
  dialog: Locator,
  context: ActionExecutorContext,
  limit: number,
  seen: Set<string>
): Promise<InviteBatchOutcome> {
  let invited = 0
  let unverified = 0
  let candidates = 0
  const attempted = () => invited + unverified

  for (const selector of ROW_INVITE_SELECTORS) {
    let safety = 0
    while (attempted() < limit && safety < Math.max(20, limit * 6)) {
      safety += 1
      const buttons = dialog.locator(selector)
      const count = await buttons.count().catch(() => 0)
      let handled = false

      for (let index = 0; index < count; index += 1) {
        if (context.control.isStopped()) {
          return { invited, unverified, candidates, exhausted: false }
        }
        await context.control.waitIfPaused()
        const button = buttons.nth(index)
        if (!await button.isVisible().catch(() => false)) continue

        const signature = await candidateSignature(button)
        if (!signature || seen.has(signature)) continue
        seen.add(signature)
        candidates += 1
        handled = true

        const container = await candidateContainer(button)
        if (!await button.click({ timeout: 5000 }).then(() => true).catch(() => false)) break
        if (await verifyRowInvite(button, container, context)) invited += 1
        else unverified += 1
        break
      }

      if (!handled) break
    }
    if (attempted() >= limit) break
  }

  return { invited, unverified, candidates, exhausted: candidates === 0 }
}

async function selectCheckboxCandidates(
  dialog: Locator,
  context: ActionExecutorContext,
  limit: number,
  seen: Set<string>
): Promise<{ selected: number; candidates: number }> {
  let selected = 0
  let candidates = 0

  for (const selector of CHECKBOX_SELECTORS) {
    const controls = dialog.locator(selector)
    const count = await controls.count().catch(() => 0)
    for (let index = 0; index < count && selected < limit; index += 1) {
      if (context.control.isStopped()) return { selected, candidates }
      await context.control.waitIfPaused()
      const control = controls.nth(index)
      if (!await control.isVisible().catch(() => false)) continue

      const signature = await candidateSignature(control)
      if (!signature || seen.has(signature)) continue
      seen.add(signature)
      candidates += 1

      const checked = await control.getAttribute('aria-checked').catch(() => null)
      if (checked === 'true') continue
      const nativeChecked = await control.isChecked().catch(() => false)
      if (nativeChecked) continue
      if (!await control.click({ timeout: 5000 }).then(() => true).catch(() => false)) continue
      selected += 1
      if (!await sleepWithControl(context.control, 150)) break
    }
    if (selected >= limit) break
  }
  return { selected, candidates }
}

async function checkboxSubmitVerified(page: Page, dialog: Locator, context: ActionExecutorContext): Promise<boolean> {
  if (!await sleepWithControl(context.control, 700)) return false
  if (!await dialog.isVisible().catch(() => false)) return true
  if (VERIFIED_INVITE_TEXT.test(await dialog.innerText().catch(() => ''))) return true
  const bodyText = await page.locator('body').innerText().catch(() => '')
  return /(?:invites? sent|lời mời đã gửi|đã gửi lời mời)/i.test(bodyText)
}

async function inviteWithCheckboxes(
  page: Page,
  dialog: Locator,
  context: ActionExecutorContext,
  limit: number,
  seen: Set<string>
): Promise<InviteBatchOutcome> {
  const selection = await selectCheckboxCandidates(dialog, context, limit, seen)
  if (selection.selected === 0) {
    return { invited: 0, unverified: 0, candidates: selection.candidates, exhausted: selection.candidates === 0 }
  }

  const submit = await firstVisible(dialog, SUBMIT_INVITES_SELECTORS)
  if (context.control.isStopped()) {
    return { invited: 0, unverified: 0, candidates: selection.candidates, exhausted: false }
  }
  if (!submit || !await submit.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
    return { invited: 0, unverified: selection.selected, candidates: selection.candidates, exhausted: false }
  }

  const verified = await checkboxSubmitVerified(page, dialog, context)
  return {
    invited: verified ? selection.selected : 0,
    unverified: verified ? 0 : selection.selected,
    candidates: selection.candidates,
    exhausted: false
  }
}

export async function inviteFriendsBatch(
  page: Page,
  context: ActionExecutorContext,
  limit: number,
  seen: Set<string>
): Promise<InviteBatchOutcome> {
  const dialog = await openInviteDialog(page, context)
  if (!dialog) return { invited: 0, unverified: 0, candidates: 0, exhausted: true }

  let outcome = await inviteWithRowButtons(dialog, context, limit, seen)
  if (outcome.invited + outcome.unverified === 0 && !context.control.isStopped()) {
    outcome = await inviteWithCheckboxes(page, dialog, context, limit, seen)
  }

  await closeInviteDialog(page, dialog)
  return outcome
}

export async function paceInviteFriendsBatch(
  context: ActionExecutorContext,
  config: ActionConfig,
  previousInvited: number,
  currentInvited: number
): Promise<boolean> {
  const pauseAfter = configNumber(config, 'pauseAfterCount', 0)
  if (crossedPauseThreshold(previousInvited, currentInvited, pauseAfter)) {
    const pauseMs = configNumber(config, 'pauseMinutes', 0) * 60_000
    if (pauseMs > 0 && !await sleepWithControl(context.control, pauseMs)) return false
  }

  const delaySeconds = pickRange(
    configNumber(config, 'itemDelayMinSeconds', 0),
    configNumber(config, 'itemDelayMaxSeconds', 0)
  )
  return sleepWithControl(context.control, delaySeconds * 1000)
}
