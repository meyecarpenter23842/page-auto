import type { Locator, Page } from 'playwright-core'
import type { MailMessageSnapshot } from './verificationCodeParser'
import type { MailboxCodeSurface } from './emailAuthV2Contracts'
import { mailDomainFromAddress } from './mailProviderRegistry'
import { normalizeMailboxAddress } from './mailProvider'
import type {
  InboxesEnsureMailboxResult,
  InboxesMailboxDriver,
  InboxesMessageSummary
} from './inboxesProvider'
import {
  parseInboxesMessageRowCells,
  retryInboxesClickAfterOverlay
} from './inboxesPlaywrightDriver'

const INBOXES_URL = 'https://inboxes.com/'
const INBOXES_CLICK_TIMEOUT_MS = 2_500
const EMAIL_IN_TEXT = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const INBOXES_HOST = /(^|\.)inboxes\.com$/i

export interface InboxesBackgroundSurfaceSnapshot {
  pageClosed: boolean
  bodyText: string
  expectedMailbox: string
  activeMailbox: string | null
  lastKnownMailbox: string | null
  overlayVisible: boolean
  usernameInputVisible: boolean
  domainControlVisible: boolean
  addInboxButtonVisible: boolean
}

export function isInboxesProviderPageUrl(value: string): boolean {
  try {
    return INBOXES_HOST.test(new URL(value).hostname)
  } catch {
    return false
  }
}

export function classifyInboxesBackgroundSurface(snapshot: InboxesBackgroundSurfaceSnapshot): MailboxCodeSurface {
  if (snapshot.pageClosed) return 'provider_closed'

  const text = snapshot.bodyText.replace(/\s+/g, ' ').trim().toLowerCase()
  const expectedMailbox = normalizeMailboxAddress(snapshot.expectedMailbox)
  const activeMailbox = snapshot.activeMailbox ? normalizeMailboxAddress(snapshot.activeMailbox) : null
  const lastKnownMailbox = snapshot.lastKnownMailbox ? normalizeMailboxAddress(snapshot.lastKnownMailbox) : null
  const hasInboxTable = /\bfrom\b/.test(text) && /subject\s*-?\s*preview/.test(text) && /\breceived\b/.test(text)
  const hasMessageDetail = /security code|verification code|mã bảo mật|mã xác minh/.test(text)

  if (/service unavailable|temporarily unavailable|bad gateway|gateway timeout|access denied/.test(text)) {
    return 'provider_unavailable'
  }
  // The legitimate Add Inbox form may itself be rendered inside a dialog/modal.
  // Prefer the audited form controls over the generic overlay signal so we do not
  // dismiss the business form as if it were a promotional blocker.
  if (snapshot.usernameInputVisible && snapshot.domainControlVisible && snapshot.addInboxButtonVisible) {
    return 'add_inbox_dialog'
  }
  if (snapshot.overlayVisible) return 'overlay_blocking'
  if (hasInboxTable && expectedMailbox && activeMailbox === expectedMailbox) return 'mailbox_ready_expected'
  if (hasInboxTable && activeMailbox) return 'mailbox_ready_other'
  if (hasInboxTable) return 'message_list'
  if (hasMessageDetail) {
    return expectedMailbox && lastKnownMailbox === expectedMailbox
      ? 'message_detail_expected'
      : 'message_detail_other'
  }
  return 'home'
}

async function visible(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0 && await locator.first().isVisible().catch(() => false)
}

function splitMailbox(mailbox: string): { local: string; domain: string } | null {
  const normalized = normalizeMailboxAddress(mailbox)
  if (!normalized) return null
  const separator = normalized.lastIndexOf('@')
  return { local: normalized.slice(0, separator), domain: normalized.slice(separator + 1) }
}

function normalizeRowKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function mailboxFromText(value: string): string | null {
  const match = value.match(EMAIL_IN_TEXT)?.[0]
  return match ? normalizeMailboxAddress(match) : null
}

/**
 * Inboxes adapter for Auth V2 background mailbox ownership.
 *
 * Unlike the legacy adapter, this driver never navigates message detail back to
 * the Inboxes home page. It uses browser history only when it can verify that
 * history stayed on Inboxes; otherwise it fails closed and leaves the provider
 * state intact for a later bounded recovery attempt.
 *
 * No method calls bringToFront(): the Microsoft/operator page keeps foreground
 * ownership while mailbox work happens on this provider page.
 */
export class InboxesBackgroundPlaywrightDriver implements InboxesMailboxDriver {
  private lastKnownMailbox: string | null = null

  constructor(private readonly page: Page) {}

  async ensureMailbox(mailboxInput: string): Promise<InboxesEnsureMailboxResult> {
    const mailbox = normalizeMailboxAddress(mailboxInput)
    const parts = mailbox ? splitMailbox(mailbox) : null
    if (!mailbox || !parts || mailDomainFromAddress(mailbox) !== parts.domain) {
      return { status: 'mailbox_not_found', message: 'Địa chỉ Inboxes không hợp lệ.' }
    }

    if (this.page.isClosed()) {
      return { status: 'provider_unavailable', message: 'Tab Inboxes đã đóng.' }
    }

    if (!isInboxesProviderPageUrl(this.page.url())) {
      try {
        await this.page.goto(INBOXES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      } catch {
        return { status: 'provider_unavailable', message: 'Không tải được Inboxes.com.' }
      }
    }

    for (let step = 0; step < 12; step += 1) {
      const surface = await this.readSurface(mailbox)

      if (surface === 'provider_closed') {
        return { status: 'provider_unavailable', message: 'Tab Inboxes đã đóng.' }
      }
      if (surface === 'provider_unavailable') {
        return { status: 'provider_unavailable', message: 'Inboxes.com đang không khả dụng.' }
      }
      if (surface === 'overlay_blocking') {
        if (!await this.dismissBlockingOverlay()) {
          return { status: 'provider_unavailable', message: 'Popup Inboxes đang chặn thao tác và không có Close control đã audit.' }
        }
        await this.waitForUiChange()
        continue
      }
      if (surface === 'mailbox_ready_expected') {
        this.lastKnownMailbox = mailbox
        return { status: 'ready', activeMailbox: mailbox }
      }

      if (surface === 'mailbox_ready_other' || surface === 'message_list') {
        const exactMailbox = this.page.getByText(mailbox, { exact: true }).first()
        if (await visible(exactMailbox)) {
          if (!await this.clickWithOverlayRecovery(exactMailbox)) {
            return { status: 'provider_unavailable', message: 'Không click được mailbox yêu cầu trên Inboxes sau khi xử lý popup.' }
          }
          this.lastKnownMailbox = mailbox
          await this.waitForUiChange()
          continue
        }
        if (!await this.openAddInboxDialog()) {
          return { status: 'mailbox_not_found', message: 'Không tìm thấy mailbox yêu cầu và không mở được Add Inbox.' }
        }
        await this.waitForUiChange()
        continue
      }

      if (surface === 'add_inbox_dialog') {
        if (!await this.submitAddInbox(parts.local, parts.domain)) {
          return { status: 'provider_unavailable', message: 'Form Add Inbox không ở trạng thái có thể thao tác.' }
        }
        this.lastKnownMailbox = mailbox
        await this.waitForUiChange()
        continue
      }

      if (surface === 'message_detail_expected' || surface === 'message_detail_other') {
        if (!await this.returnFromMessageDetail(mailbox)) {
          return {
            status: 'provider_unavailable',
            message: 'Không thể quay lại danh sách Inboxes bằng history an toàn; không reset mailbox về Home.'
          }
        }
        continue
      }

      if (!await this.openAddInboxDialog()) {
        return { status: 'mailbox_not_found', message: 'Không tìm thấy control Add Inbox trên surface hiện tại.' }
      }
      await this.waitForUiChange()
    }

    return { status: 'mailbox_not_found', message: 'Không xác minh được mailbox Inboxes sau nhiều lần đọc lại trạng thái.' }
  }

  async listMessages(now = Date.now()): Promise<InboxesMessageSummary[]> {
    if (this.page.isClosed()) throw new Error('Inboxes provider page closed.')
    await this.dismissBlockingOverlay()

    const rows = this.page.locator('tr')
    const count = await rows.count()
    const messages: InboxesMessageSummary[] = []

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index)
      if (!await row.isVisible().catch(() => false)) continue
      const cells = row.locator('td')
      const cellCount = await cells.count()
      if (cellCount < 3) continue

      const cellTexts: string[] = []
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        cellTexts.push(await cells.nth(cellIndex).innerText().catch(() => ''))
      }
      const parsed = parseInboxesMessageRowCells(cellTexts, now)
      if (!parsed) continue

      const { sender, subject, receivedLabel, receivedAt } = parsed
      const href = await row.locator('a[href]').first().getAttribute('href').catch(() => null)
      const dataId = await row.getAttribute('data-id').catch(() => null)
      const id = await row.getAttribute('id').catch(() => null)
      const key = href
        ? `href:${href}`
        : dataId
          ? `data:${dataId}`
          : id
            ? `id:${id}`
            : `row:${normalizeRowKey(`${sender}|${subject}|${receivedLabel}`)}`

      messages.push({
        key,
        sender,
        subject,
        preview: subject,
        receivedLabel,
        receivedAt
      })
    }

    return messages
  }

  async readMessage(message: InboxesMessageSummary): Promise<MailMessageSnapshot | null> {
    if (this.page.isClosed()) return null
    await this.dismissBlockingOverlay()
    const row = await this.findMessageRow(message)
    if (!row) return null

    if (!await this.clickWithOverlayRecovery(row)) return null
    await this.waitForUiChange()

    const bodyText = (await this.page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')).trim()
    if (!bodyText) return null

    const snapshot: MailMessageSnapshot = {
      id: message.key,
      receivedAt: message.receivedAt ?? 0,
      sender: message.sender,
      subject: message.subject,
      bodyPreview: message.preview,
      bodyText
    }

    // Best-effort state-preserving return. A failure deliberately leaves the
    // detail open instead of navigating to Inboxes Home and losing mailbox state.
    if (this.lastKnownMailbox) await this.returnFromMessageDetail(this.lastKnownMailbox)
    return snapshot
  }

  async refreshMailbox(): Promise<void> {
    if (this.page.isClosed()) throw new Error('Inboxes provider page closed.')

    if (this.lastKnownMailbox) {
      const surface = await this.readSurface(this.lastKnownMailbox)
      if (surface === 'message_detail_expected' || surface === 'message_detail_other') {
        if (!await this.returnFromMessageDetail(this.lastKnownMailbox)) {
          throw new Error('Inboxes message detail cannot safely return to mailbox list.')
        }
      }
    }

    await this.dismissBlockingOverlay()
    const refreshButton = this.page.getByRole('button', { name: /refresh|reload|làm mới/i }).first()
    if (await visible(refreshButton) && await this.clickWithOverlayRecovery(refreshButton)) {
      await this.waitForUiChange()
      return
    }
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
  }

  private async readSurface(expectedMailbox: string): Promise<MailboxCodeSurface> {
    if (this.page.isClosed()) {
      return classifyInboxesBackgroundSurface({
        pageClosed: true,
        bodyText: '',
        expectedMailbox,
        activeMailbox: null,
        lastKnownMailbox: this.lastKnownMailbox,
        overlayVisible: false,
        usernameInputVisible: false,
        domainControlVisible: false,
        addInboxButtonVisible: false
      })
    }

    const bodyText = await this.page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    const username = this.page.getByPlaceholder(/enter username/i)
    const domain = this.page.getByRole('combobox')
    const add = this.page.getByRole('button', { name: /^add inbox$/i })
    const overlay = this.page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').last()
    const headings = await this.page.locator('h1, h2, h3').allInnerTexts().catch(() => [] as string[])
    const activeHeading = headings.find((text) => /don't give them your private email/i.test(text) && EMAIL_IN_TEXT.test(text))
    const emptyInboxText = activeHeading
      ? null
      : await this.page.getByText(/waiting for incoming messages for/i).first().innerText().catch(() => '')
    const activeMailbox = mailboxFromText(activeHeading ?? emptyInboxText ?? '')

    return classifyInboxesBackgroundSurface({
      pageClosed: false,
      bodyText,
      expectedMailbox,
      activeMailbox,
      lastKnownMailbox: this.lastKnownMailbox,
      overlayVisible: await visible(overlay),
      usernameInputVisible: await visible(username),
      domainControlVisible: await visible(domain),
      addInboxButtonVisible: await visible(add)
    })
  }

  private async returnFromMessageDetail(expectedMailbox: string): Promise<boolean> {
    if (this.page.isClosed() || !isInboxesProviderPageUrl(this.page.url())) return false

    let navigated = false
    try {
      const response = await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 })
      navigated = response !== null || isInboxesProviderPageUrl(this.page.url())
    } catch {
      return false
    }
    if (!navigated || this.page.isClosed()) return false

    await this.waitForUiChange()
    if (!isInboxesProviderPageUrl(this.page.url())) {
      await this.page.goForward({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => undefined)
      return false
    }

    let surface = await this.readSurface(expectedMailbox)
    if (surface === 'overlay_blocking') {
      if (!await this.dismissBlockingOverlay()) return false
      await this.waitForUiChange()
      surface = await this.readSurface(expectedMailbox)
    }

    if (surface === 'mailbox_ready_expected') {
      this.lastKnownMailbox = normalizeMailboxAddress(expectedMailbox)
      return true
    }
    return surface === 'mailbox_ready_other'
      || surface === 'message_list'
      || surface === 'home'
      || surface === 'add_inbox_dialog'
  }

  private async openAddInboxDialog(): Promise<boolean> {
    const controls = [
      this.page.getByRole('button', { name: /add inbox/i }).first(),
      this.page.getByRole('button', { name: /get my first inbox/i }).first(),
      this.page.getByText(/add inbox/i).first(),
      this.page.getByText(/get my first inbox/i).first()
    ]
    for (const control of controls) {
      if (!await visible(control)) continue
      if (await this.clickWithOverlayRecovery(control)) return true
    }
    return false
  }

  private async submitAddInbox(local: string, domain: string): Promise<boolean> {
    const username = this.page.getByPlaceholder(/enter username/i).first()
    if (!await visible(username)) return false
    await username.fill(local)

    const nativeSelect = this.page.locator('select:visible').last()
    if (await visible(nativeSelect)) {
      try {
        await nativeSelect.selectOption({ label: domain })
      } catch {
        await nativeSelect.selectOption(domain).catch(() => undefined)
      }
    } else {
      const combobox = this.page.getByRole('combobox').last()
      if (!await visible(combobox) || !await this.clickWithOverlayRecovery(combobox)) return false
      const option = this.page.getByRole('option', { name: domain, exact: true }).first()
      if (await visible(option)) {
        if (!await this.clickWithOverlayRecovery(option)) return false
      } else {
        const domainText = this.page.getByText(domain, { exact: true }).last()
        if (!await visible(domainText) || !await this.clickWithOverlayRecovery(domainText)) return false
      }
    }

    const add = this.page.getByRole('button', { name: /^add inbox$/i }).last()
    if (!await visible(add)) return false
    return await this.clickWithOverlayRecovery(add)
  }

  private async clickWithOverlayRecovery(target: Locator): Promise<boolean> {
    return await retryInboxesClickAfterOverlay(
      async () => { await target.click({ timeout: INBOXES_CLICK_TIMEOUT_MS }) },
      async () => await this.dismissBlockingOverlay()
    )
  }

  private async dismissBlockingOverlay(): Promise<boolean> {
    const overlay = this.page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').last()
    const controls = [
      overlay.getByRole('button', { name: /^close$/i }).last(),
      overlay.getByRole('link', { name: /^close$/i }).last(),
      overlay.getByText(/^close$/i).last(),
      this.page.locator('button[aria-label*="close" i]:visible, [role="button"][aria-label*="close" i]:visible').last(),
      this.page.locator('button:visible, a:visible, [role="button"]:visible, [role="link"]:visible').filter({ hasText: /^\s*close\s*$/i }).last(),
      this.page.getByText(/^close$/i).last()
    ]

    for (const control of controls) {
      if (!await visible(control)) continue
      try {
        await control.click({ timeout: 1_500 })
        await this.page.waitForTimeout(150)
        return true
      } catch {
        // Try the next explicit Close control; never force-click content behind it.
      }
    }
    return false
  }

  private async findMessageRow(message: InboxesMessageSummary): Promise<Locator | null> {
    const rows = this.page.locator('tr')
    const count = await rows.count()
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index)
      if (!await row.isVisible().catch(() => false)) continue
      const href = await row.locator('a[href]').first().getAttribute('href').catch(() => null)
      const dataId = await row.getAttribute('data-id').catch(() => null)
      const id = await row.getAttribute('id').catch(() => null)
      const rowText = normalizeRowKey(await row.innerText().catch(() => ''))
      const keyMatches = message.key.startsWith('href:')
        ? message.key === `href:${href ?? ''}`
        : message.key.startsWith('data:')
          ? message.key === `data:${dataId ?? ''}`
          : message.key.startsWith('id:')
            ? message.key === `id:${id ?? ''}`
            : rowText.includes(normalizeRowKey(message.sender)) && rowText.includes(normalizeRowKey(message.subject))
      if (keyMatches) return row
    }
    return null
  }

  private async waitForUiChange(): Promise<void> {
    await Promise.race([
      this.page.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => undefined),
      this.page.waitForTimeout(500)
    ])
    await this.page.waitForTimeout(150)
  }
}
