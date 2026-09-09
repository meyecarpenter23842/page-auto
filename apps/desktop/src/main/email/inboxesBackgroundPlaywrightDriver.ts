import type { Locator, Page } from 'playwright-core'
import { parseVerificationCode, type MailMessageSnapshot } from './verificationCodeParser'
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
const INBOXES_CLICK_TIMEOUT_MS = 1_500
const INBOXES_NAV_TIMEOUT_MS = 12_000
const INBOXES_VIGNETTE_RELOAD_TIMEOUT_MS = 8_000
const INBOXES_FORM_ACTION_TIMEOUT_MS = 1_000
const INBOXES_TEXT_PROBE_TIMEOUT_MS = 250
const EMAIL_IN_TEXT = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const INBOXES_HOST = /(^|\.)inboxes\.com$/i
const GOOGLE_VIGNETTE_HASH = /(?:^|[#&])google_vignette(?:=|&|$)/i

type AddInboxSubmitResult = 'submitted' | 'retry_after_reload' | 'failed'
type VignetteRecoveryResult = 'none' | 'reloaded' | 'blocked'

export interface InboxesBackgroundSurfaceSnapshot {
  pageClosed: boolean
  bodyText: string
  expectedMailbox: string
  activeMailbox: string | null
  lastKnownMailbox: string | null
  overlayVisible: boolean
  googleVignetteVisible: boolean
  usernameInputVisible: boolean
  domainControlVisible: boolean
  addInboxButtonVisible: boolean
}

export interface InboxesAddInboxFastPathSnapshot {
  url: string
  vignetteReloads: number
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

function isInboxesGoogleVignetteUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return isInboxesProviderPageUrl(value) && GOOGLE_VIGNETTE_HASH.test(url.hash.replace(/^#/, ''))
  } catch {
    return false
  }
}

/**
 * The Add Inbox form is already actionable business state. Do not run absent-text
 * mailbox probes before returning it to the state machine. A fresh vignette hash
 * still wins once; after the operator-proven F5 recovery the same hash may be stale.
 */
export function shouldUseInboxesAddInboxFastPath(snapshot: InboxesAddInboxFastPathSnapshot): boolean {
  const formVisible = snapshot.usernameInputVisible
    && snapshot.domainControlVisible
    && snapshot.addInboxButtonVisible
  if (!formVisible) return false
  return !isInboxesGoogleVignetteUrl(snapshot.url) || snapshot.vignetteReloads > 0
}

/** Strong enough for detail verification without treating a list-row subject as opened mail. */
export function inboxesBodyHasMessageDetail(value: string): boolean {
  const text = value.replace(/\s+/g, ' ').trim().toLowerCase()
  const mentionsCode = /security code|verification code|mã bảo mật|mã xác minh/.test(text)
  if (!mentionsCode) return false
  return /\b\d{4,8}\b/.test(text)
    || /use this code|your code is|code to continue|enter this code|here is your code/.test(text)
}

/**
 * Inboxes often renders the Microsoft code directly in the Subject/Preview row.
 * Reuse the canonical verification parser; only short-circuit the click when that
 * parser can already prove a verification code from the fresh row snapshot.
 */
export function inboxesPreviewSnapshot(
  message: InboxesMessageSummary,
  now = Date.now()
): MailMessageSnapshot | null {
  const receivedAt = message.receivedAt ?? 0
  const preview = message.preview.replace(/\s+/g, ' ').trim()
  if (!preview || !Number.isFinite(receivedAt) || receivedAt <= 0) return null

  const snapshot: MailMessageSnapshot = {
    id: message.key,
    receivedAt,
    sender: message.sender,
    subject: message.subject,
    bodyPreview: preview,
    bodyText: preview
  }
  return parseVerificationCode([snapshot], now) ? snapshot : null
}

export function classifyInboxesBackgroundSurface(snapshot: InboxesBackgroundSurfaceSnapshot): MailboxCodeSurface {
  if (snapshot.pageClosed) return 'provider_closed'

  const text = snapshot.bodyText.replace(/\s+/g, ' ').trim().toLowerCase()
  const expectedMailbox = normalizeMailboxAddress(snapshot.expectedMailbox)
  const activeMailbox = snapshot.activeMailbox ? normalizeMailboxAddress(snapshot.activeMailbox) : null
  const lastKnownMailbox = snapshot.lastKnownMailbox ? normalizeMailboxAddress(snapshot.lastKnownMailbox) : null
  const hasInboxTable = /\bfrom\b/.test(text) && /subject\s*-?\s*preview/.test(text) && /\breceived\b/.test(text)
  const hasEmptyInbox = /waiting for incoming messages for/i.test(text)
  const hasMessageDetail = inboxesBodyHasMessageDetail(snapshot.bodyText)

  if (/service unavailable|temporarily unavailable|bad gateway|gateway timeout|access denied/.test(text)) {
    return 'provider_unavailable'
  }
  if (snapshot.googleVignetteVisible) return 'overlay_blocking'
  if (snapshot.usernameInputVisible && snapshot.domainControlVisible && snapshot.addInboxButtonVisible) {
    return 'add_inbox_dialog'
  }
  if (snapshot.overlayVisible) return 'overlay_blocking'

  // An already-open empty mailbox is still a ready mailbox. The previous
  // implementation required a message table and therefore treated a saved,
  // logged-in empty inbox as Home, which sent the state machine back to Add Inbox.
  if ((hasInboxTable || hasEmptyInbox) && expectedMailbox && activeMailbox === expectedMailbox) {
    return 'mailbox_ready_expected'
  }
  if ((hasInboxTable || hasEmptyInbox) && activeMailbox) return 'mailbox_ready_other'
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

export class InboxesBackgroundPlaywrightDriver implements InboxesMailboxDriver {
  private lastKnownMailbox: string | null = null
  private vignetteReloads = 0

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

    this.vignetteReloads = 0

    if (!isInboxesProviderPageUrl(this.page.url())) {
      try {
        await this.page.goto(INBOXES_URL, { waitUntil: 'domcontentloaded', timeout: INBOXES_NAV_TIMEOUT_MS })
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
        const vignetteRecovery = await this.reloadGoogleVignetteIfNeeded()
        if (vignetteRecovery === 'reloaded') {
          await this.waitForUiChange()
          continue
        }
        if (vignetteRecovery === 'blocked') {
          return { status: 'provider_unavailable', message: 'Google vignette trên Inboxes vẫn chặn sau một lần F5 recovery.' }
        }
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
        await this.waitForAddInboxForm()
        continue
      }

      if (surface === 'add_inbox_dialog') {
        const submitted = await this.submitAddInbox(parts.local, parts.domain)
        if (submitted === 'retry_after_reload') {
          await this.waitForUiChange()
          continue
        }
        if (submitted === 'failed') {
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
      await this.waitForAddInboxForm()
    }

    return { status: 'mailbox_not_found', message: 'Không xác minh được mailbox Inboxes sau nhiều lần đọc lại trạng thái.' }
  }

  async listMessages(now = Date.now()): Promise<InboxesMessageSummary[]> {
    if (this.page.isClosed()) throw new Error('Inboxes provider page closed.')
    await this.dismissBlockingOverlay()

    const rows = await this.messageRows()
    const count = await rows.count()
    const messages: InboxesMessageSummary[] = []

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index)
      if (!await row.isVisible().catch(() => false)) continue
      let cells = row.locator('td')
      let cellCount = await cells.count()
      if (cellCount < 3) {
        cells = row.locator('[role="cell"]')
        cellCount = await cells.count()
      }
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
      const rowPreview = (await row.innerText().catch(() => cellTexts.join(' '))).replace(/\s+/g, ' ').trim()
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
        preview: rowPreview || subject,
        receivedLabel,
        receivedAt
      })
    }

    return messages
  }

  async readMessage(message: InboxesMessageSummary): Promise<MailMessageSnapshot | null> {
    if (this.page.isClosed()) return null

    // Live Inboxes can already expose the full Microsoft code in the list row.
    // Avoid a fragile extra click/detail round-trip when the canonical parser can
    // prove the code from that fresh row; otherwise fall through to detail safely.
    const previewSnapshot = inboxesPreviewSnapshot(message)
    if (previewSnapshot) return previewSnapshot

    await this.dismissBlockingOverlay()
    const row = await this.findMessageRow(message)
    if (!row) return null

    const target = await this.messageOpenTarget(row, message)
    const beforeUrl = this.page.url()
    const beforeBody = await this.readBodyText(800)
    if (!await this.clickWithOverlayRecovery(target)) return null

    const detailBody = await this.waitForMessageDetail(beforeUrl, beforeBody)
    if (!detailBody) return null

    const snapshot: MailMessageSnapshot = {
      id: message.key,
      receivedAt: message.receivedAt ?? 0,
      sender: message.sender,
      subject: message.subject,
      bodyPreview: message.preview,
      bodyText: detailBody
    }

    if (this.lastKnownMailbox) {
      if (this.page.url() === beforeUrl) {
        if (!await this.closeInlineMessageDetail(this.lastKnownMailbox)) {
          await this.returnFromMessageDetail(this.lastKnownMailbox)
        }
      } else {
        await this.returnFromMessageDetail(this.lastKnownMailbox)
      }
    }
    return snapshot
  }

  async refreshMailbox(): Promise<void> {
    if (this.page.isClosed()) throw new Error('Inboxes provider page closed.')

    if (this.lastKnownMailbox) {
      const body = await this.readBodyText(800)
      if (inboxesBodyHasMessageDetail(body)) {
        if (!await this.closeInlineMessageDetail(this.lastKnownMailbox)
          && !await this.returnFromMessageDetail(this.lastKnownMailbox)) {
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
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: INBOXES_NAV_TIMEOUT_MS })
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
        googleVignetteVisible: false,
        usernameInputVisible: false,
        domainControlVisible: false,
        addInboxButtonVisible: false
      })
    }

    const username = this.page.getByPlaceholder(/enter username/i)
    const domain = this.page.getByRole('combobox')
    const add = this.page.getByRole('button', { name: /^add inbox$/i })
    const overlay = this.page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').last()
    const usernameVisible = await visible(username)
    const domainVisible = await visible(domain)
    const addVisible = await visible(add)
    const overlayVisible = await visible(overlay)

    // This is the hot-path bug from the live recording: the Add Inbox controls
    // were visible immediately but readSurface() then waited on a locator for
    // "Waiting for incoming messages" that was absent. Return the form before
    // any optional text lookup so filling starts immediately.
    if (shouldUseInboxesAddInboxFastPath({
      url: this.page.url(),
      vignetteReloads: this.vignetteReloads,
      usernameInputVisible: usernameVisible,
      domainControlVisible: domainVisible,
      addInboxButtonVisible: addVisible
    })) {
      return classifyInboxesBackgroundSurface({
        pageClosed: false,
        bodyText: '',
        expectedMailbox,
        activeMailbox: null,
        lastKnownMailbox: this.lastKnownMailbox,
        overlayVisible,
        googleVignetteVisible: false,
        usernameInputVisible: usernameVisible,
        domainControlVisible: domainVisible,
        addInboxButtonVisible: addVisible
      })
    }

    const bodyText = await this.readBodyText(800)
    const headings = await this.page.locator('h1, h2, h3').allInnerTexts().catch(() => [] as string[])
    const activeHeading = headings.find((text) => /don't give them your private email/i.test(text) && EMAIL_IN_TEXT.test(text))
    let emptyInboxText = ''
    if (!activeHeading && /waiting for incoming messages for/i.test(bodyText)) {
      const emptyInbox = this.page.getByText(/waiting for incoming messages for/i).first()
      if (await visible(emptyInbox)) {
        emptyInboxText = await emptyInbox.innerText({ timeout: INBOXES_TEXT_PROBE_TIMEOUT_MS }).catch(() => '')
      }
    }
    const activeMailbox = mailboxFromText(activeHeading ?? emptyInboxText)

    const hasBusinessUi = usernameVisible && domainVisible && addVisible
      || /\bfrom\b/i.test(bodyText) && /subject\s*-?\s*preview/i.test(bodyText) && /\breceived\b/i.test(bodyText)
      || /waiting for incoming messages for/i.test(bodyText)
    const googleVignetteVisible = isInboxesGoogleVignetteUrl(this.page.url())
      && (this.vignetteReloads === 0 || !hasBusinessUi)

    return classifyInboxesBackgroundSurface({
      pageClosed: false,
      bodyText,
      expectedMailbox,
      activeMailbox,
      lastKnownMailbox: this.lastKnownMailbox,
      overlayVisible,
      googleVignetteVisible,
      usernameInputVisible: usernameVisible,
      domainControlVisible: domainVisible,
      addInboxButtonVisible: addVisible
    })
  }

  private async returnFromMessageDetail(expectedMailbox: string): Promise<boolean> {
    if (this.page.isClosed() || !isInboxesProviderPageUrl(this.page.url())) return false

    try {
      await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 5_000 })
    } catch {
      return false
    }
    if (this.page.isClosed() || !isInboxesProviderPageUrl(this.page.url())) return false

    await this.waitForUiChange()
    const body = await this.readBodyText(800)
    if (inboxesBodyHasMessageDetail(body)) return false

    const surface = await this.readSurface(expectedMailbox)
    if (surface === 'mailbox_ready_expected') {
      this.lastKnownMailbox = normalizeMailboxAddress(expectedMailbox)
      return true
    }
    return surface === 'mailbox_ready_other'
      || surface === 'message_list'
      || surface === 'home'
      || surface === 'add_inbox_dialog'
  }

  private async closeInlineMessageDetail(expectedMailbox: string): Promise<boolean> {
    const controls = [
      this.page.getByRole('button', { name: /^(back|close)$/i }).last(),
      this.page.getByRole('link', { name: /^(back|close)$/i }).last(),
      this.page.getByRole('button', { name: /back to inbox|inbox/i }).last(),
      this.page.getByRole('link', { name: /back to inbox|inbox/i }).last()
    ]
    for (const control of controls) {
      if (!await visible(control)) continue
      if (!await this.clickWithOverlayRecovery(control)) continue
      await this.waitForUiChange()
      const body = await this.readBodyText(800)
      if (inboxesBodyHasMessageDetail(body)) continue
      const surface = await this.readSurface(expectedMailbox)
      return surface !== 'message_detail_expected' && surface !== 'message_detail_other'
    }
    return false
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

  private async submitAddInbox(local: string, domain: string): Promise<AddInboxSubmitResult> {
    const username = this.page.getByPlaceholder(/enter username/i).first()
    if (!await visible(username)) return 'failed'
    try {
      await username.fill(local, { timeout: INBOXES_FORM_ACTION_TIMEOUT_MS })
    } catch {
      return 'failed'
    }
    const filledUsername = await username.inputValue({ timeout: INBOXES_TEXT_PROBE_TIMEOUT_MS }).catch(() => '')
    if (filledUsername.trim() !== local) return 'failed'

    let vignetteRecovery = await this.reloadGoogleVignetteIfNeeded()
    if (vignetteRecovery === 'reloaded') return 'retry_after_reload'
    if (vignetteRecovery === 'blocked') return 'failed'

    const nativeSelect = this.page.locator('select:visible').last()
    if (await visible(nativeSelect)) {
      let selected = false
      try {
        await nativeSelect.selectOption({ label: domain }, { timeout: INBOXES_FORM_ACTION_TIMEOUT_MS })
        selected = true
      } catch {
        try {
          await nativeSelect.selectOption(domain, { timeout: INBOXES_FORM_ACTION_TIMEOUT_MS })
          selected = true
        } catch {
          selected = false
        }
      }
      if (!selected) return 'failed'
      const selectedText = (await nativeSelect.locator('option:checked').first().innerText({
        timeout: INBOXES_TEXT_PROBE_TIMEOUT_MS
      }).catch(() => '')).trim().toLowerCase()
      if (selectedText && selectedText !== domain.toLowerCase()) return 'failed'
    } else {
      const combobox = this.page.getByRole('combobox').last()
      if (!await visible(combobox) || !await this.clickWithOverlayRecovery(combobox)) {
        vignetteRecovery = await this.reloadGoogleVignetteIfNeeded()
        if (vignetteRecovery === 'reloaded') return 'retry_after_reload'
        return 'failed'
      }
      const option = this.page.getByRole('option', { name: domain, exact: true }).first()
      if (await visible(option)) {
        if (!await this.clickWithOverlayRecovery(option)) {
          vignetteRecovery = await this.reloadGoogleVignetteIfNeeded()
          if (vignetteRecovery === 'reloaded') return 'retry_after_reload'
          return 'failed'
        }
      } else {
        const domainText = this.page.getByText(domain, { exact: true }).last()
        if (!await visible(domainText) || !await this.clickWithOverlayRecovery(domainText)) {
          vignetteRecovery = await this.reloadGoogleVignetteIfNeeded()
          if (vignetteRecovery === 'reloaded') return 'retry_after_reload'
          return 'failed'
        }
      }
    }

    vignetteRecovery = await this.reloadGoogleVignetteIfNeeded()
    if (vignetteRecovery === 'reloaded') return 'retry_after_reload'
    if (vignetteRecovery === 'blocked') return 'failed'

    const add = this.page.getByRole('button', { name: /^add inbox$/i }).last()
    if (!await visible(add)) return 'failed'
    if (!await this.clickWithOverlayRecovery(add)) {
      vignetteRecovery = await this.reloadGoogleVignetteIfNeeded()
      if (vignetteRecovery === 'reloaded') return 'retry_after_reload'
      return 'failed'
    }

    vignetteRecovery = await this.reloadGoogleVignetteIfNeeded()
    if (vignetteRecovery === 'reloaded') return 'retry_after_reload'
    if (vignetteRecovery === 'blocked') return 'failed'
    return 'submitted'
  }

  private async reloadGoogleVignetteIfNeeded(): Promise<VignetteRecoveryResult> {
    if (this.page.isClosed() || !isInboxesGoogleVignetteUrl(this.page.url())) return 'none'

    if (this.vignetteReloads >= 1) {
      // Chrome/site can leave #google_vignette in the URL after F5 even though
      // the provider UI is usable again. Do not treat a stale hash as a blocker.
      return await this.providerBusinessUiVisible() ? 'none' : 'blocked'
    }

    this.vignetteReloads += 1
    try {
      await this.page.reload({
        waitUntil: 'domcontentloaded',
        timeout: INBOXES_VIGNETTE_RELOAD_TIMEOUT_MS
      })
      return 'reloaded'
    } catch {
      return 'blocked'
    }
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
        await control.click({ timeout: 1_200 })
        await this.page.waitForTimeout(80)
        return true
      } catch {
        // Try the next explicit Close control; never force-click content behind it.
      }
    }
    return false
  }

  private async messageRows(): Promise<Locator> {
    const tableRows = this.page.locator('tr')
    if (await tableRows.count() > 0) return tableRows
    return this.page.locator('[role="row"]')
  }

  private async findMessageRow(message: InboxesMessageSummary): Promise<Locator | null> {
    const rows = await this.messageRows()
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

  private async messageOpenTarget(row: Locator, message: InboxesMessageSummary): Promise<Locator> {
    const anchors = row.locator('a[href]')
    const anchorCount = await anchors.count()
    for (let index = 0; index < anchorCount; index += 1) {
      const anchor = anchors.nth(index)
      if (await anchor.isVisible().catch(() => false)) return anchor
    }

    const subject = row.getByText(message.subject, { exact: true }).first()
    if (await visible(subject)) return subject

    const roleLink = row.getByRole('link').first()
    if (await visible(roleLink)) return roleLink
    const roleButton = row.getByRole('button').first()
    if (await visible(roleButton)) return roleButton
    return row
  }

  private async waitForMessageDetail(beforeUrl: string, beforeBody: string): Promise<string | null> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (this.page.isClosed() || !isInboxesProviderPageUrl(this.page.url())) return null
      const body = await this.readBodyText(600)
      const changed = this.page.url() !== beforeUrl || normalizeRowKey(body) !== normalizeRowKey(beforeBody)
      if (changed && inboxesBodyHasMessageDetail(body)) return body
      await this.page.waitForTimeout(100)
    }
    return null
  }

  private async providerBusinessUiVisible(): Promise<boolean> {
    const username = this.page.getByPlaceholder(/enter username/i)
    const domain = this.page.getByRole('combobox')
    const add = this.page.getByRole('button', { name: /^add inbox$/i })
    if (await visible(username) && await visible(domain) && await visible(add)) return true
    if (await visible(this.page.getByRole('button', { name: /add inbox|get my first inbox/i }).first())) return true
    const body = await this.readBodyText(800)
    return /waiting for incoming messages for/i.test(body)
      || /\bfrom\b/i.test(body) && /subject\s*-?\s*preview/i.test(body) && /\breceived\b/i.test(body)
  }

  private async waitForAddInboxForm(): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const username = this.page.getByPlaceholder(/enter username/i)
      const domain = this.page.getByRole('combobox')
      const add = this.page.getByRole('button', { name: /^add inbox$/i })
      if (await visible(username) && await visible(domain) && await visible(add)) return
      await this.page.waitForTimeout(80)
    }
  }

  private async readBodyText(timeout: number): Promise<string> {
    return (await this.page.locator('body').innerText({ timeout }).catch(() => '')).trim()
  }

  private async waitForUiChange(): Promise<void> {
    await Promise.race([
      this.page.waitForLoadState('domcontentloaded', { timeout: 800 }).catch(() => undefined),
      this.page.waitForTimeout(250)
    ])
    await this.page.waitForTimeout(60)
  }
}
