import type { Page } from 'playwright-core'
import type { MailMessageSnapshot } from './verificationCodeParser'
import { normalizeMailboxAddress } from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'
import type {
  BrowserEnsureMailboxResult,
  BrowserMailboxDriver,
  BrowserMailboxMessageSummary
} from './browserMailboxProvider'

const TEMPMAIL_PLUS_API_URL = 'https://tempmail.plus/api/mails'
const MAIL_LIST_LIMIT = 20

interface ApiPayloadResponse {
  status: number
  payload: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function readMessageId(record: Record<string, unknown>): string | null {
  const value = record.mail_id
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim()
  return null
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseMailtoPlusListPayload(payload: unknown): BrowserMailboxMessageSummary[] | null {
  const root = asRecord(payload)
  if (!root || root.result !== true || !Array.isArray(root.mail_list)) return null

  const messages: BrowserMailboxMessageSummary[] = []
  const seen = new Set<string>()
  for (const item of root.mail_list) {
    const record = asRecord(item)
    if (!record) continue
    const id = readMessageId(record)
    if (!id) continue
    const key = `mailto-plus:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    const sender = readString(record, 'from_mail', 'from', 'from_name')
    const subject = readString(record, 'subject')
    messages.push({
      key,
      sender,
      subject,
      preview: subject,
      receivedLabel: readString(record, 'time', 'date'),
      receivedAt: null
    })
  }
  return messages
}

export function parseMailtoPlusDetailPayload(
  payload: unknown,
  mailboxInput: string,
  expectedKey: string
): MailMessageSnapshot | null {
  const mailbox = normalizeMailboxAddress(mailboxInput)
  const root = asRecord(payload)
  if (!mailbox || !root || root.result !== true) return null

  const id = readMessageId(root)
  if (!id || expectedKey !== `mailto-plus:${id}`) return null
  const deliveredTo = normalizeMailboxAddress(readString(root, 'to'))
  if (deliveredTo !== mailbox) return null

  const sender = readString(root, 'from_mail', 'from', 'from_name')
  const subject = readString(root, 'subject')
  const plainText = readString(root, 'text')
  const htmlText = stripHtml(readString(root, 'html'))
  const bodyText = plainText || htmlText

  return {
    id: expectedKey,
    receivedAt: 0,
    sender,
    subject,
    bodyPreview: bodyText.slice(0, 300),
    bodyText
  }
}

function looksPinProtected(payload: unknown): boolean {
  const root = asRecord(payload)
  const message = root ? readString(root, 'message', 'error') : ''
  return /\bpin\b|epin|protected|password/i.test(message)
}

export class MailtoPlusApiDriver implements BrowserMailboxDriver {
  private activeMailbox: string | null = null

  constructor(private readonly page: Page) {}

  async ensureMailbox(mailboxInput: string): Promise<BrowserEnsureMailboxResult> {
    const mailbox = normalizeMailboxAddress(mailboxInput)
    if (!mailbox || resolveMailProviderId(mailbox) !== 'mailto_plus') {
      return { status: 'mailbox_not_found', message: 'Địa chỉ TempMail.Plus không hợp lệ hoặc chưa được registry hỗ trợ.' }
    }
    if (this.page.isClosed()) {
      return { status: 'provider_unavailable', message: 'Tab TempMail.Plus đã đóng.' }
    }

    let response: ApiPayloadResponse
    try {
      response = await this.readList(mailbox)
    } catch {
      return { status: 'provider_unavailable', message: 'Không gọi được API TempMail.Plus bằng Email browser hiện tại.' }
    }

    if (looksPinProtected(response.payload)) {
      return { status: 'mailbox_not_found', message: 'Mailbox TempMail.Plus đang yêu cầu PIN; PAGE-AUTO chưa có PIN canonical để đọc tự động.' }
    }
    if (response.status === 429 || response.status >= 500) {
      return { status: 'provider_unavailable', message: 'TempMail.Plus đang giới hạn hoặc tạm thời không khả dụng.' }
    }
    if (response.status < 200 || response.status >= 300 || parseMailtoPlusListPayload(response.payload) === null) {
      return { status: 'provider_unavailable', message: 'TempMail.Plus trả về dữ liệu inbox không hợp lệ.' }
    }

    this.activeMailbox = mailbox
    return { status: 'ready', activeMailbox: mailbox }
  }

  async listMessages(): Promise<BrowserMailboxMessageSummary[]> {
    const mailbox = this.activeMailbox
    if (!mailbox) throw new Error('TempMail.Plus mailbox is not prepared')
    const response = await this.readList(mailbox)
    if (response.status < 200 || response.status >= 300) throw new Error('TempMail.Plus list request failed')
    const messages = parseMailtoPlusListPayload(response.payload)
    if (!messages) throw new Error('TempMail.Plus list payload is invalid')
    return messages
  }

  async readMessage(message: BrowserMailboxMessageSummary): Promise<MailMessageSnapshot | null> {
    const mailbox = this.activeMailbox
    if (!mailbox) return null
    const id = message.key.match(/^mailto-plus:(\d+)$/)?.[1]
    if (!id) return null

    const response = await this.readJson(`${TEMPMAIL_PLUS_API_URL}/${id}`, mailbox)
    if (response.status < 200 || response.status >= 300) return null
    return parseMailtoPlusDetailPayload(response.payload, mailbox, message.key)
  }

  async refreshMailbox(): Promise<void> {
    // listMessages() performs a fresh API navigation on every poll.
  }

  private async readList(mailbox: string): Promise<ApiPayloadResponse> {
    return await this.readJson(TEMPMAIL_PLUS_API_URL, mailbox, { limit: String(MAIL_LIST_LIMIT) })
  }

  private async readJson(
    baseUrl: string,
    mailbox: string,
    extra: Record<string, string> = {}
  ): Promise<ApiPayloadResponse> {
    if (this.page.isClosed()) throw new Error('TempMail.Plus page is closed')
    const url = new URL(baseUrl)
    url.searchParams.set('email', mailbox)
    url.searchParams.set('epin', '')
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value)

    const response = await this.page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    })
    if (!response) throw new Error('TempMail.Plus response is missing')
    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) as unknown : null
    } catch {
      payload = null
    }
    return { status: response.status(), payload }
  }
}
