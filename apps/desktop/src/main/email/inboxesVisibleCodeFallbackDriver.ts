import type { Locator, Page } from 'playwright-core'
import { parseVerificationCode, type MailMessageSnapshot } from './verificationCodeParser'
import type {
  InboxesEnsureMailboxResult,
  InboxesMailboxDriver,
  InboxesMessageSummary
} from './inboxesProvider'
import { parseInboxesReceivedAtLabel } from './inboxesPlaywrightDriver'

const VISIBLE_RECEIVED_LABEL = /\b(?:just now|now|(?:a few|few|a) seconds? ago|\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|day|days)\s+ago)\b/i

export interface InboxesVisibleCodeRowEvidence {
  text: string
  receivedLabel: string
  receivedAt: number
  code: string
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeKey(value: string): string {
  return normalizeText(value).toLowerCase()
}

async function visible(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0 && await locator.first().isVisible().catch(() => false)
}

/**
 * Live Inboxes can render a complete Microsoft security code in a row whose DOM
 * does not expose the legacy td/role=cell shape. Only accept a fallback row when
 * both a trustworthy relative Received label and the canonical verification
 * parser prove that the visible text contains a verification code.
 */
export function parseInboxesVisibleCodeRow(
  rowTextInput: string,
  now = Date.now()
): InboxesVisibleCodeRowEvidence | null {
  const text = normalizeText(rowTextInput)
  if (!text) return null

  const receivedLabel = text.match(VISIBLE_RECEIVED_LABEL)?.[0] ?? ''
  if (!receivedLabel) return null
  const receivedAt = parseInboxesReceivedAtLabel(receivedLabel, now)
  if (receivedAt === null) return null

  const probe: MailMessageSnapshot = {
    id: 'inboxes-visible-row-probe',
    receivedAt,
    sender: '',
    subject: text,
    bodyPreview: text,
    bodyText: text
  }
  const match = parseVerificationCode([probe], now)
  if (!match) return null

  return { text, receivedLabel, receivedAt, code: match.code }
}

/**
 * Decorates the production Inboxes driver with a narrow live-DOM fallback.
 * The base driver remains authoritative for mailbox selection, overlays,
 * refresh and message-detail navigation. This layer only contributes messages
 * when a verification code is already visibly rendered in a row.
 */
export class InboxesVisibleCodeFallbackDriver implements InboxesMailboxDriver {
  private readonly visibleSnapshots = new Map<string, MailMessageSnapshot>()

  constructor(
    private readonly page: Page,
    private readonly base: InboxesMailboxDriver
  ) {}

  async ensureMailbox(mailbox: string): Promise<InboxesEnsureMailboxResult> {
    this.visibleSnapshots.clear()
    return await this.base.ensureMailbox(mailbox)
  }

  async listMessages(now = Date.now()): Promise<InboxesMessageSummary[]> {
    const baseMessages = await this.base.listMessages(now)
    this.visibleSnapshots.clear()
    if (this.page.isClosed()) return baseMessages

    const fallbackMessages = await this.scanVisibleCodeRows(now)
    if (fallbackMessages.length === 0) return baseMessages

    const merged = new Map(baseMessages.map((message) => [message.key, message] as const))
    for (const message of fallbackMessages) merged.set(message.key, message)
    return [...merged.values()]
  }

  async readMessage(message: InboxesMessageSummary): Promise<MailMessageSnapshot | null> {
    const visibleSnapshot = this.visibleSnapshots.get(message.key)
    if (visibleSnapshot) return visibleSnapshot
    return await this.base.readMessage(message)
  }

  async refreshMailbox(): Promise<void> {
    this.visibleSnapshots.clear()
    await this.base.refreshMailbox()
  }

  private async scanVisibleCodeRows(now: number): Promise<InboxesMessageSummary[]> {
    const rows = this.page.locator('tr, [role="row"], [role="listitem"]')
    const count = await rows.count()
    const messages: InboxesMessageSummary[] = []

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index)
      if (!await visible(row)) continue

      const rowText = await row.innerText().catch(() => '')
      const evidence = parseInboxesVisibleCodeRow(rowText, now)
      if (!evidence) continue

      const cells = row.locator('td, [role="cell"], [role="gridcell"]')
      const cellCount = await cells.count()
      const cellTexts: string[] = []
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        const value = normalizeText(await cells.nth(cellIndex).innerText().catch(() => ''))
        if (value) cellTexts.push(value)
      }

      const contentText = normalizeText(evidence.text.replace(evidence.receivedLabel, ' '))
      const sender = cellTexts[0] ?? (/microsoft account team/i.test(contentText) ? 'Microsoft account team' : '')
      const subject = cellTexts[1] ?? contentText
      const href = await row.locator('a[href]').first().getAttribute('href').catch(() => null)
      const dataId = await row.getAttribute('data-id').catch(() => null)
      const id = await row.getAttribute('id').catch(() => null)
      const key = href
        ? `href:${href}`
        : dataId
          ? `data:${dataId}`
          : id
            ? `id:${id}`
            : `visible:${normalizeKey(`${sender}|${subject}|${evidence.code}`)}`

      const snapshot: MailMessageSnapshot = {
        id: key,
        receivedAt: evidence.receivedAt,
        sender,
        subject,
        bodyPreview: evidence.text,
        bodyText: evidence.text
      }
      if (!parseVerificationCode([snapshot], now)) continue

      this.visibleSnapshots.set(key, snapshot)
      messages.push({
        key,
        sender,
        subject,
        preview: evidence.text,
        receivedLabel: evidence.receivedLabel,
        receivedAt: evidence.receivedAt
      })
    }

    return messages
  }
}
