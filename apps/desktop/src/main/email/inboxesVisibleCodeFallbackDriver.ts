import type { Locator, Page } from 'playwright-core'
import { emailDiagnostic } from './emailRuntimeDiagnostic'
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

export class InboxesVisibleCodeFallbackDriver implements InboxesMailboxDriver {
  private readonly visibleSnapshots = new Map<string, MailMessageSnapshot>()

  constructor(
    private readonly page: Page,
    private readonly base: InboxesMailboxDriver
  ) {}

  async ensureMailbox(mailbox: string): Promise<InboxesEnsureMailboxResult> {
    this.visibleSnapshots.clear()
    emailDiagnostic('inboxes-dom', 'ensure-start', {
      pageState: this.page.isClosed()
        ? 'closed'
        : /^https:\/\/([^/]+\.)?inboxes\.com\//i.test(this.page.url())
          ? 'inboxes-existing'
          : this.page.url() === 'about:blank'
            ? 'new-blank'
            : 'other'
    })

    const result = await this.base.ensureMailbox(mailbox)
    emailDiagnostic('inboxes-dom', 'ensure-result', {
      status: result.status,
      activeMatches: result.status === 'ready'
    })
    return result
  }

  async listMessages(now = Date.now()): Promise<InboxesMessageSummary[]> {
    const baseMessages = await this.base.listMessages(now)
    this.visibleSnapshots.clear()
    if (this.page.isClosed()) {
      emailDiagnostic('inboxes-dom', 'list-page-closed', {
        baseMessages: baseMessages.length
      })
      return baseMessages
    }

    const fallbackMessages = await this.scanVisibleCodeRows(now)
    const merged = new Map(baseMessages.map((message) => [message.key, message] as const))
    for (const message of fallbackMessages) merged.set(message.key, message)

    const messages = [...merged.values()].sort((left, right) => {
      const leftAt = left.receivedAt ?? Number.NEGATIVE_INFINITY
      const rightAt = right.receivedAt ?? Number.NEGATIVE_INFINITY
      return rightAt - leftAt
    })

    emailDiagnostic('inboxes-dom', 'list-result', {
      baseMessages: baseMessages.length,
      fallbackMessages: fallbackMessages.length,
      mergedMessages: messages.length,
      newestReceivedLabel: messages[0]?.receivedLabel ?? ''
    })
    return messages
  }

  async readMessage(message: InboxesMessageSummary): Promise<MailMessageSnapshot | null> {
    const visibleSnapshot = this.visibleSnapshots.get(message.key)
    if (visibleSnapshot) {
      emailDiagnostic('inboxes-dom', 'read-visible-row', {
        receivedLabel: message.receivedLabel,
        preview: message.preview
      })
      return visibleSnapshot
    }

    emailDiagnostic('inboxes-dom', 'read-base-message', {
      receivedLabel: message.receivedLabel,
      preview: message.preview
    })
    const snapshot = await this.base.readMessage(message)
    emailDiagnostic('inboxes-dom', 'read-base-result', {
      snapshot: snapshot !== null,
      subject: snapshot?.subject ?? ''
    })
    return snapshot
  }

  async refreshMailbox(): Promise<void> {
    this.visibleSnapshots.clear()
    emailDiagnostic('inboxes-dom', 'refresh', {})
    await this.base.refreshMailbox()
  }

  private async scanVisibleCodeRows(now: number): Promise<InboxesMessageSummary[]> {
    const rows = this.page.locator('tr, [role="row"], [role="listitem"]')
    const count = await rows.count()
    const messages: InboxesMessageSummary[] = []

    emailDiagnostic('inboxes-dom', 'scan-start', { rows: count })

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index)
      if (!await visible(row)) continue

      const rowText = normalizeText(await row.innerText().catch(() => ''))
      if (!rowText) continue
      const evidence = parseInboxesVisibleCodeRow(rowText, now)

      const cells = row.locator('td, [role="cell"], [role="gridcell"]')
      const cellCount = await cells.count()
      emailDiagnostic('inboxes-dom', 'row', {
        index,
        cells: cellCount,
        codeEvidence: evidence !== null,
        preview: rowText
      })
      if (!evidence) continue

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
      const verified = parseVerificationCode([snapshot], now)
      if (!verified) continue

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

    if (messages.length === 0) {
      const body = await this.page.locator('body').innerText({ timeout: 800 }).catch(() => '')
      const relevantLines = body
        .split(/\r?\n/)
        .map(normalizeText)
        .filter((line) => /microsoft|security code|verification code|secs? ago|mins? ago|seconds? ago/i.test(line))
        .slice(0, 12)
        .join(' | ')
      emailDiagnostic('inboxes-dom', 'scan-no-code-row', {
        rows: count,
        relevantBodyText: relevantLines
      })
    }

    return messages.sort((left, right) => (right.receivedAt ?? 0) - (left.receivedAt ?? 0))
  }
}
