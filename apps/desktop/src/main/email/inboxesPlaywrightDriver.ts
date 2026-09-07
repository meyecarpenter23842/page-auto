import type { Locator, Page } from 'playwright-core'
import type { MailMessageSnapshot } from './verificationCodeParser'
import { mailDomainFromAddress } from './mailProviderRegistry'
import { normalizeMailboxAddress } from './mailProvider'
import type {
  InboxesEnsureMailboxResult,
  InboxesMailboxDriver,
  InboxesMessageSummary
} from './inboxesProvider'

const INBOXES_URL = 'https://inboxes.com/'
const EMAIL_IN_TEXT = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i

export type InboxesSurface =
  | 'mailbox_ready'
  | 'mailbox_other'
  | 'add_inbox_dialog'
  | 'message_detail'
  | 'home'
  | 'provider_unavailable'

export interface InboxesSurfaceSnapshot {
  bodyText: string
  expectedMailbox: string
  activeMailbox: string | null
  usernameInputVisible: boolean
  domainControlVisible: boolean
  addInboxButtonVisible: boolean
}

export function classifyInboxesSurface(snapshot: InboxesSurfaceSnapshot): InboxesSurface {
  const text = snapshot.bodyText.replace(/\s+/g, ' ').trim().toLowerCase()
  const mailbox = snapshot.expectedMailbox.trim().toLowerCase()
  const activeMailbox = snapshot.activeMailbox?.trim().toLowerCase() ?? null
  const hasInboxTable = /\bfrom\b/.test(text) && /subject\s*-?\s*preview/.test(text) && /\breceived\b/.test(text)

  if (/service unavailable|temporarily unavailable|bad gateway|gateway timeout|access denied/.test(text)) {
    return 'provider_unavailable'
  }
  if (snapshot.usernameInputVisible && snapshot.domainControlVisible && snapshot.addInboxButtonVisible) {
    return 'add_inbox_dialog'
  }
  if (hasInboxTable && mailbox && activeMailbox === mailbox) return 'mailbox_ready'
  if (hasInboxTable) return 'mailbox_other'
  if (/security code|verification code|mã bảo mật|mã xác minh/.test(text)) return 'message_detail'
  return 'home'
}

export function parseInboxesReceivedAtLabel(labelInput: string, now = Date.now()): number | null {
  const label = labelInput.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!label) return null
  if (/^(just now|now)$/.test(label)) return now
  if (/^(a|few|a few) seconds? ago$/.test(label)) return now - 5_000

  const relative = label.match(/^(\d+)\s*(sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|day|days)\s+ago$/)
  if (relative) {
    const amount = Number(relative[1])
    const unit = relative[2] ?? ''
    const multiplier = unit.startsWith('sec')
      ? 1_000
      : unit.startsWith('min')
        ? 60_000
        : unit.startsWith('hour')
          ? 60 * 60_000
          : 24 * 60 * 60_000
    return now - amount * multiplier
  }

  const absolute = Date.parse(labelInput)
  return Number.isFinite(absolute) ? absolute : null
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
 * Browser adapter for the UI observed on inboxes.com.
 *
 * It never assumes a linear flow. Every action is followed by another surface
 * classification, so opening an existing mailbox, seeing the add-inbox dialog,
 * returning from a message, or a provider error can all be handled independently.
 */
export class InboxesPlaywrightDriver implements InboxesMailboxDriver {
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

    if (!/^https:\/\/([^/]+\.)?inboxes\.com\//i.test(this.page.url())) {
      try {
        await this.page.goto(INBOXES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      } catch {
        return { status: 'provider_unavailable', message: 'Không tải được Inboxes.com.' }
      }
    }

    for (let step = 0; step < 12; step += 1) {
      const surface = await this.readSurface(mailbox)
      if (surface === 'provider_unavailable') {
        return { status: 'provider_unavailable', message: 'Inboxes.com đang không khả dụng.' }
      }
      if (surface === 'mailbox_ready') return { status: 'ready', activeMailbox: mailbox }

      if (surface === 'mailbox_other') {
        const exactMailbox = this.page.getByText(mailbox, { exact: true }).first()
        if (await visible(exactMailbox)) {
          await exactMailbox.click()
          await this.waitForUiChange()
          continue
        }
        if (!await this.openAddInboxDialog()) {
          return { status: 'mailbox_not_found', message: 'Không tìm thấy mailbox yêu cầu và không mở được Add Inbox.' }
        }
        continue
      }

      if (surface === 'add_inbox_dialog') {
        if (!await this.submitAddInbox(parts.local, parts.domain)) {
          return { status: 'provider_unavailable', message: 'Form Add Inbox không ở trạng thái có thể thao tác.' }
        }
        await this.waitForUiChange()
        continue
      }

      if (surface === 'message_detail') {
        try {
          await this.page.goto(INBOXES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        } catch {
          return { status: 'provider_unavailable', message: 'Không quay lại được danh sách inbox.' }
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
    const rows = this.page.locator('tr')
    const count = await rows.count()
    const messages: InboxesMessageSummary[] = []

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index)
      if (!await row.isVisible().catch(() => false)) continue
      const cells = row.locator('td')
      if (await cells.count() < 2) continue

      const sender = (await cells.nth(0).innerText().catch(() => '')).trim()
      const subject = (await cells.nth(1).innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      const receivedLabel = (await cells.nth(2).innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      if (!sender || !subject) continue

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
        receivedAt: parseInboxesReceivedAtLabel(receivedLabel, now)
      })
    }

    return messages
  }

  async readMessage(message: InboxesMessageSummary): Promise<MailMessageSnapshot | null> {
    const row = await this.findMessageRow(message)
    if (!row) return null

    const beforeUrl = this.page.url()
    try {
      await row.click()
    } catch {
      return null
    }
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

    if (this.page.url() !== beforeUrl) {
      await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(async () => {
        await this.page.goto(INBOXES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined)
      })
    } else {
      await this.page.goto(INBOXES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined)
    }
    return snapshot
  }

  async refreshMailbox(): Promise<void> {
    const refreshButton = this.page.getByRole('button', { name: /refresh|reload|làm mới/i }).first()
    if (await visible(refreshButton)) {
      await refreshButton.click()
      await this.waitForUiChange()
      return
    }
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
  }

  private async readSurface(expectedMailbox: string): Promise<InboxesSurface> {
    const bodyText = await this.page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    const username = this.page.getByPlaceholder(/enter username/i)
    const domain = this.page.getByRole('combobox')
    const add = this.page.getByRole('button', { name: /^add inbox$/i })
    const headings = await this.page.locator('h1, h2, h3').allInnerTexts().catch(() => [] as string[])
    const activeHeading = headings.find((text) => /don't give them your private email/i.test(text) && EMAIL_IN_TEXT.test(text))
    const emptyInboxText = activeHeading
      ? null
      : await this.page.getByText(/waiting for incoming messages for/i).first().innerText().catch(() => '')
    const activeMailbox = mailboxFromText(activeHeading ?? emptyInboxText ?? '')

    return classifyInboxesSurface({
      bodyText,
      expectedMailbox,
      activeMailbox,
      usernameInputVisible: await visible(username),
      domainControlVisible: await visible(domain),
      addInboxButtonVisible: await visible(add)
    })
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
      await control.click()
      return true
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
      if (!await visible(combobox)) return false
      await combobox.click()
      const option = this.page.getByRole('option', { name: domain, exact: true }).first()
      if (await visible(option)) await option.click()
      else {
        const domainText = this.page.getByText(domain, { exact: true }).last()
        if (!await visible(domainText)) return false
        await domainText.click()
      }
    }

    const add = this.page.getByRole('button', { name: /^add inbox$/i }).last()
    if (!await visible(add)) return false
    await add.click()
    return true
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
