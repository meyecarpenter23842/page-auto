import type { Locator, Page } from 'playwright-core'
import { inboxesBodyHasMessageDetail, isInboxesProviderPageUrl } from './inboxesBackgroundPlaywrightDriver'
import { emailDiagnostic } from './emailRuntimeDiagnostic'
import { normalizeMailboxAddress } from './mailProvider'
import { parseVerificationCode, type MailMessageSnapshot } from './verificationCodeParser'
import type {
  InboxesEnsureMailboxResult,
  InboxesMailboxDriver,
  InboxesMessageSummary
} from './inboxesProvider'
import {
  parseInboxesMessageRowCells,
  parseInboxesReceivedAtLabel,
  retryInboxesClickAfterOverlay
} from './inboxesPlaywrightDriver'
import {
  closeUnexpectedInboxesPopupPages,
  dismissInboxesGoogleVignette,
  snapshotInboxesContextPages,
  type InboxesVignetteDismissResult
} from './inboxesVignetteGuard'

const VISIBLE_RECEIVED_LABEL = /\b(?:just now|now|(?:a few|few|a) seconds? ago|\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|day|days)\s+ago)\b/i
const DETAIL_RECEIVED_LABEL = /\breceived\s*:\s*((?:just now|now|(?:a few|few|a) seconds? ago|\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|day|days)\s+ago))/i
const INBOXES_POLL_VIGNETTE_RELOAD_TIMEOUT_MS = 8_000
const INBOXES_DOM_PROBE_TIMEOUT_MS = 300
const INBOXES_DETAIL_WAIT_ATTEMPTS = 18
const INBOXES_DETAIL_WAIT_MS = 100
const INBOXES_DETAIL_RECEIVED_TOLERANCE_MS = 120_000
const INBOXES_CLICK_TIMEOUT_MS = 1_500
const INBOXES_HOME_URL = 'https://inboxes.com/'
const INBOXES_NAV_TIMEOUT_MS = 8_000

export interface InboxesVisibleCodeRowEvidence {
  text: string
  receivedLabel: string
  receivedAt: number
  code: string
}

interface InboxesPreopenedDetail {
  summary: InboxesMessageSummary
  snapshot: MailMessageSnapshot
}

interface InboxesFastRowReference {
  sender: string
  subject: string
  receivedLabel: string
  receivedAt: number
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

async function shortText(locator: Locator): Promise<string> {
  return normalizeText(await locator.innerText({ timeout: INBOXES_DOM_PROBE_TIMEOUT_MS }).catch(() => ''))
}

async function shortAttribute(locator: Locator, name: string): Promise<string | null> {
  if (await locator.count() === 0) return null
  return await locator.first().getAttribute(name, { timeout: INBOXES_DOM_PROBE_TIMEOUT_MS }).catch(() => null)
}

export function shouldReverifyInboxesAfterPollRecovery(
  vignetteState: InboxesVignetteDismissResult,
  unexpectedPopupCount = 0
): boolean {
  return vignetteState === 'dismissed' || unexpectedPopupCount > 0
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

export function parseInboxesVisibleMessageDetail(
  bodyTextInput: string,
  mailboxInput: string,
  now = Date.now()
): InboxesPreopenedDetail | null {
  const mailbox = normalizeMailboxAddress(mailboxInput)
  const bodyText = normalizeText(bodyTextInput)
  if (!mailbox || !bodyText) return null
  if (!bodyText.toLowerCase().includes(mailbox)) return null
  if (!inboxesBodyHasMessageDetail(bodyText)) return null

  const receivedLabel = bodyText.match(DETAIL_RECEIVED_LABEL)?.[1] ?? ''
  const receivedAt = receivedLabel ? parseInboxesReceivedAtLabel(receivedLabel, now) : null
  if (receivedAt === null) return null

  const subject = /personal microsoft account security code/i.test(bodyText)
    ? 'Personal Microsoft account security code'
    : /microsoft account security code/i.test(bodyText)
      ? 'Microsoft account security code'
      : 'Microsoft security code'
  const sender = /microsoft account team/i.test(bodyText) ? 'Microsoft account team' : 'Microsoft'
  const key = `detail:${receivedAt}:${normalizeKey(subject)}`
  const snapshot: MailMessageSnapshot = {
    id: key,
    receivedAt,
    sender,
    subject,
    bodyPreview: bodyText,
    bodyText
  }
  const match = parseVerificationCode([snapshot], now)
  if (!match) return null

  return {
    summary: {
      key,
      sender,
      subject,
      preview: bodyText,
      receivedLabel,
      receivedAt
    },
    snapshot
  }
}

export function rebaseInboxesMessageReceivedAt(
  message: InboxesMessageSummary,
  observedAt: number
): InboxesMessageSummary {
  const receivedAt = parseInboxesReceivedAtLabel(message.receivedLabel, observedAt)
  return receivedAt === null ? message : { ...message, receivedAt }
}

export function inboxesDetailMatchesMessage(
  bodyTextInput: string,
  message: InboxesMessageSummary,
  now = Date.now()
): boolean {
  const bodyText = normalizeText(bodyTextInput)
  if (!inboxesBodyHasMessageDetail(bodyText)) return false

  const messageIsMicrosoft = /microsoft|accountprotection/i.test(`${message.sender} ${message.subject} ${message.preview}`)
  if (messageIsMicrosoft && !/microsoft/i.test(bodyText)) return false
  if (/security code/i.test(message.subject) && !/security code/i.test(bodyText)) return false

  const detailReceivedLabel = bodyText.match(DETAIL_RECEIVED_LABEL)?.[1] ?? ''
  const detailReceivedAt = detailReceivedLabel ? parseInboxesReceivedAtLabel(detailReceivedLabel, now) : null
  if (detailReceivedAt === null || message.receivedAt === null) return false

  return Math.abs(detailReceivedAt - message.receivedAt) <= INBOXES_DETAIL_RECEIVED_TOLERANCE_MS
}

export class InboxesVisibleCodeFallbackDriver implements InboxesMailboxDriver {
  private readonly visibleSnapshots = new Map<string, MailMessageSnapshot>()
  private readonly fastRows = new Map<string, InboxesFastRowReference>()
  private activeMailbox: string | null = null
  private blockedVignetteReloads = 0
  private preopenedDetail: InboxesPreopenedDetail | null = null

  constructor(
    private readonly page: Page,
    private readonly base: InboxesMailboxDriver
  ) {}

  async ensureMailbox(mailbox: string): Promise<InboxesEnsureMailboxResult> {
    this.visibleSnapshots.clear()
    this.fastRows.clear()
    this.preopenedDetail = null
    emailDiagnostic('inboxes-dom', 'ensure-start', {
      pageState: this.page.isClosed()
        ? 'closed'
        : /^https:\/\/([^/]+\.)?inboxes\.com\//i.test(this.page.url())
          ? 'inboxes-existing'
          : this.page.url() === 'about:blank'
            ? 'new-blank'
            : 'other'
    })

    const normalizedMailbox = normalizeMailboxAddress(mailbox)
    if (normalizedMailbox && !this.page.isClosed() && isInboxesProviderPageUrl(this.page.url())) {
      const bodyText = await this.page.locator('body').innerText({ timeout: INBOXES_DOM_PROBE_TIMEOUT_MS }).catch(() => '')
      const existingDetail = parseInboxesVisibleMessageDetail(bodyText, normalizedMailbox)
      if (existingDetail) {
        this.activeMailbox = normalizedMailbox
        this.preopenedDetail = existingDetail
        this.visibleSnapshots.set(existingDetail.summary.key, existingDetail.snapshot)
        emailDiagnostic('inboxes-dom', 'ensure-existing-detail', {
          activeMatches: true,
          receivedLabel: existingDetail.summary.receivedLabel
        })
        return { status: 'ready', activeMailbox: normalizedMailbox }
      }
    }

    const result = await this.base.ensureMailbox(mailbox)
    this.activeMailbox = result.status === 'ready'
      ? normalizeMailboxAddress(result.activeMailbox)
      : null
    emailDiagnostic('inboxes-dom', 'ensure-result', {
      status: result.status,
      activeMatches: result.status === 'ready'
    })
    return result
  }

  async listMessages(now = Date.now()): Promise<InboxesMessageSummary[]> {
    const recoveredBeforeList = await this.recoverPollingVignette('before-list')
    if (recoveredBeforeList) {
      this.preopenedDetail = null
      this.visibleSnapshots.clear()
    }

    if (this.preopenedDetail) {
      const detail = this.preopenedDetail
      this.visibleSnapshots.set(detail.summary.key, detail.snapshot)
      emailDiagnostic('inboxes-dom', 'list-existing-detail', {
        receivedLabel: detail.summary.receivedLabel
      })
      return [detail.summary]
    }

    if (this.page.isClosed()) {
      emailDiagnostic('inboxes-dom', 'list-page-closed', { fastMessages: 0 })
      return []
    }

    let wallStartedAt = Date.now()
    let fastMessages = await this.scanFastMessageRows(now, wallStartedAt)
    const recoveredAfterList = await this.recoverPollingVignette('after-list')
    if (recoveredAfterList) {
      this.preopenedDetail = null
      const resumedNow = now + Math.max(0, Date.now() - wallStartedAt)
      wallStartedAt = Date.now()
      fastMessages = await this.scanFastMessageRows(resumedNow, wallStartedAt)
    }

    emailDiagnostic('inboxes-dom', 'list-result', {
      baseMessages: 0,
      fallbackMessages: fastMessages.length,
      mergedMessages: fastMessages.length,
      newestReceivedLabel: fastMessages[0]?.receivedLabel ?? ''
    })
    return fastMessages
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

    const fastRow = this.fastRows.get(message.key)
    if (fastRow) {
      return await this.readFastRow(message, fastRow)
    }

    await this.recoverPollingVignette('before-read')
    const pagesBeforeRead = snapshotInboxesContextPages(this.page)
    emailDiagnostic('inboxes-dom', 'read-base-message', {
      receivedLabel: message.receivedLabel,
      preview: message.preview
    })
    let snapshot = await this.base.readMessage(message)
    const popupCount = await closeUnexpectedInboxesPopupPages(this.page, pagesBeforeRead)
    const recoveredAfterRead = await this.recoverPollingVignette('after-read', popupCount)
    if (!snapshot && recoveredAfterRead) {
      snapshot = await this.base.readMessage(message)
    }
    emailDiagnostic('inboxes-dom', 'read-base-result', {
      snapshot: snapshot !== null,
      subject: snapshot?.subject ?? ''
    })
    return snapshot
  }

  async refreshMailbox(): Promise<void> {
    this.visibleSnapshots.clear()
    this.fastRows.clear()

    if (this.preopenedDetail && this.activeMailbox) {
      this.preopenedDetail = null
      await this.prepareCanonicalMailboxFromDetail()
    }

    await this.recoverPollingVignette('before-refresh')
    const pagesBeforeRefresh = snapshotInboxesContextPages(this.page)
    emailDiagnostic('inboxes-dom', 'refresh', {})
    await this.base.refreshMailbox()
    const popupCount = await closeUnexpectedInboxesPopupPages(this.page, pagesBeforeRefresh)
    await this.recoverPollingVignette('after-refresh', popupCount)
  }

  private async prepareCanonicalMailboxFromDetail(): Promise<void> {
    const mailbox = this.activeMailbox
    if (!mailbox) return

    let prepared = await this.base.ensureMailbox(mailbox)
    let preparedMailbox = prepared.status === 'ready'
      ? normalizeMailboxAddress(prepared.activeMailbox)
      : null
    if (prepared.status === 'ready' && preparedMailbox === mailbox) return

    if (this.page.isClosed()) {
      throw new Error('Inboxes existing message detail closed before canonical mailbox recovery.')
    }

    try {
      await this.page.goto(INBOXES_HOME_URL, {
        waitUntil: 'domcontentloaded',
        timeout: INBOXES_NAV_TIMEOUT_MS
      })
    } catch {
      throw new Error('Inboxes existing message detail cannot return to provider Home.')
    }

    prepared = await this.base.ensureMailbox(mailbox)
    preparedMailbox = prepared.status === 'ready'
      ? normalizeMailboxAddress(prepared.activeMailbox)
      : null
    if (prepared.status !== 'ready' || preparedMailbox !== mailbox) {
      throw new Error('Inboxes existing message detail cannot recover the canonical mailbox.')
    }
  }

  private async readFastRow(
    message: InboxesMessageSummary,
    reference: InboxesFastRowReference
  ): Promise<MailMessageSnapshot | null> {
    await this.recoverPollingVignette('before-fast-read')
    const row = await this.findFastRow(reference)
    if (!row) {
      emailDiagnostic('inboxes-dom', 'fast-read-row-missing', {
        receivedLabel: message.receivedLabel
      })
      return null
    }

    const target = await this.fastMessageOpenTarget(row, message)
    const beforeUrl = this.page.url()
    const beforeBody = await this.page.locator('body').innerText({ timeout: INBOXES_DOM_PROBE_TIMEOUT_MS }).catch(() => '')
    const pagesBeforeRead = snapshotInboxesContextPages(this.page)

    const clicked = await retryInboxesClickAfterOverlay(
      async () => { await target.click({ timeout: INBOXES_CLICK_TIMEOUT_MS }) },
      async () => (await dismissInboxesGoogleVignette(this.page)) === 'dismissed'
    )
    if (!clicked) {
      emailDiagnostic('inboxes-dom', 'fast-read-click-failed', {
        receivedLabel: message.receivedLabel
      })
      return null
    }

    const popupCount = await closeUnexpectedInboxesPopupPages(this.page, pagesBeforeRead)
    if (popupCount > 0) {
      await this.recoverPollingVignette('after-fast-read-popup', popupCount)
      return null
    }

    const detailBody = await this.waitForFastMessageDetail(beforeUrl, beforeBody, message)
    if (!detailBody) {
      emailDiagnostic('inboxes-dom', 'fast-read-detail-mismatch', {
        receivedLabel: message.receivedLabel
      })
      if (this.activeMailbox) {
        await this.base.ensureMailbox(this.activeMailbox).catch(() => undefined)
      }
      return null
    }

    const snapshot: MailMessageSnapshot = {
      id: message.key,
      receivedAt: message.receivedAt ?? reference.receivedAt,
      sender: message.sender,
      subject: message.subject,
      bodyPreview: message.preview,
      bodyText: detailBody
    }

    emailDiagnostic('inboxes-dom', 'fast-read-detail-ok', {
      receivedLabel: message.receivedLabel,
      subject: message.subject
    })

    if (this.activeMailbox) {
      await this.base.ensureMailbox(this.activeMailbox).catch(() => undefined)
    }
    return snapshot
  }

  private async findFastRow(reference: InboxesFastRowReference): Promise<Locator | null> {
    const rows = this.page.locator('tr, [role="row"], [role="listitem"]')
    const count = await rows.count()
    const expectedSubject = normalizeKey(reference.subject)
    const expectedSender = normalizeKey(reference.sender)

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index)
      if (!await visible(row)) continue
      const rowText = normalizeKey(await row.innerText({ timeout: INBOXES_DOM_PROBE_TIMEOUT_MS }).catch(() => ''))
      if (!rowText) continue
      if (expectedSubject && !rowText.includes(expectedSubject)) continue
      if (expectedSender && !rowText.includes(expectedSender)) continue
      return row
    }
    return null
  }

  private async fastMessageOpenTarget(row: Locator, message: InboxesMessageSummary): Promise<Locator> {
    const cells = row.locator('td, [role="cell"], [role="gridcell"]')
    const cellCount = await cells.count()
    const expectedSubject = normalizeKey(message.subject)

    for (let index = 0; index < cellCount; index += 1) {
      const cell = cells.nth(index)
      const text = normalizeKey(await cell.innerText({ timeout: INBOXES_DOM_PROBE_TIMEOUT_MS }).catch(() => ''))
      if (text && expectedSubject && (text.includes(expectedSubject) || expectedSubject.includes(text))) {
        const anchors = cell.locator('a[href]')
        if (await anchors.count() > 0 && await anchors.first().isVisible().catch(() => false)) {
          return anchors.first()
        }
        return cell
      }
    }

    const anchors = row.locator('a[href]')
    for (let index = 0; index < await anchors.count(); index += 1) {
      const anchor = anchors.nth(index)
      const text = normalizeKey(await anchor.innerText({ timeout: INBOXES_DOM_PROBE_TIMEOUT_MS }).catch(() => ''))
      if (text && expectedSubject && (text.includes(expectedSubject) || expectedSubject.includes(text))) return anchor
    }

    return row
  }

  private async waitForFastMessageDetail(
    beforeUrl: string,
    beforeBody: string,
    message: InboxesMessageSummary
  ): Promise<string | null> {
    const beforeKey = normalizeKey(beforeBody)
    for (let attempt = 0; attempt < INBOXES_DETAIL_WAIT_ATTEMPTS; attempt += 1) {
      if (this.page.isClosed() || !isInboxesProviderPageUrl(this.page.url())) return null
      const body = await this.page.locator('body').innerText({ timeout: INBOXES_DOM_PROBE_TIMEOUT_MS }).catch(() => '')
      const changed = this.page.url() !== beforeUrl || normalizeKey(body) !== beforeKey
      if (changed && inboxesDetailMatchesMessage(body, message, Date.now())) return body
      await this.page.waitForTimeout(INBOXES_DETAIL_WAIT_MS)
    }
    return null
  }

  private async recoverPollingVignette(stage: string, unexpectedPopupCount = 0): Promise<boolean> {
    if (this.page.isClosed()) return false

    let vignetteState = await dismissInboxesGoogleVignette(this.page)
    emailDiagnostic('inboxes-dom', 'poll-guard', {
      stage,
      vignetteState,
      unexpectedPopupCount,
      blockedReloads: this.blockedVignetteReloads
    })

    if (vignetteState === 'blocked') {
      if (this.blockedVignetteReloads >= 1) {
        throw new Error('Google vignette is still blocking Inboxes polling after bounded reload recovery.')
      }

      this.blockedVignetteReloads += 1
      emailDiagnostic('inboxes-dom', 'poll-vignette-reload', {
        stage,
        attempt: this.blockedVignetteReloads
      })
      try {
        await this.page.reload({
          waitUntil: 'domcontentloaded',
          timeout: INBOXES_POLL_VIGNETTE_RELOAD_TIMEOUT_MS
        })
      } catch {
        throw new Error('Inboxes vignette reload recovery failed during code polling.')
      }

      vignetteState = await dismissInboxesGoogleVignette(this.page)
      if (vignetteState === 'blocked') {
        throw new Error('Google vignette is still blocking Inboxes after reload recovery.')
      }
      await this.reverifyActiveMailbox(`${stage}:reload`)
      return true
    }

    if (!shouldReverifyInboxesAfterPollRecovery(vignetteState, unexpectedPopupCount)) {
      return false
    }

    await this.reverifyActiveMailbox(stage)
    return true
  }

  private async reverifyActiveMailbox(stage: string): Promise<void> {
    const mailbox = this.activeMailbox
    if (!mailbox) return

    const verified = await this.base.ensureMailbox(mailbox)
    const verifiedMailbox = verified.status === 'ready'
      ? normalizeMailboxAddress(verified.activeMailbox)
      : null
    const matches = verified.status === 'ready' && verifiedMailbox === mailbox

    emailDiagnostic('inboxes-dom', 'poll-reverify', {
      stage,
      status: verified.status,
      activeMatches: matches
    })

    if (!matches) {
      throw new Error('Inboxes mailbox changed while recovering polling interruption.')
    }
  }

  private async scanFastMessageRows(startNow: number, wallStartedAt: number): Promise<InboxesMessageSummary[]> {
    this.visibleSnapshots.clear()
    this.fastRows.clear()

    const rows = this.page.locator('tr, [role="row"], [role="listitem"]')
    const count = await rows.count()
    const messages = new Map<string, InboxesMessageSummary>()

    emailDiagnostic('inboxes-dom', 'scan-start', { rows: count })

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index)
      if (!await visible(row)) continue

      const rowText = await shortText(row)
      if (!rowText) continue

      const cells = row.locator('td, [role="cell"], [role="gridcell"]')
      const cellCount = await cells.count()
      const cellTexts: string[] = []
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        const value = await shortText(cells.nth(cellIndex))
        if (value) cellTexts.push(value)
      }

      const observedAt = startNow + Math.max(0, Date.now() - wallStartedAt)
      const parsed = parseInboxesMessageRowCells(cellTexts, observedAt)
      const visibleCode = parseInboxesVisibleCodeRow(rowText, observedAt)

      emailDiagnostic('inboxes-dom', 'row', {
        index,
        cells: cellCount,
        codeEvidence: visibleCode !== null,
        parsedMessage: parsed !== null,
        preview: rowText
      })

      if (!parsed && !visibleCode) continue

      const sender = parsed?.sender
        ?? cellTexts[0]
        ?? (/microsoft account team/i.test(rowText) ? 'Microsoft account team' : 'Microsoft')
      const subject = parsed?.subject ?? normalizeText(visibleCode?.text.replace(visibleCode.receivedLabel, ' ') ?? rowText)
      const receivedLabel = parsed?.receivedLabel ?? visibleCode?.receivedLabel ?? ''
      const receivedAt = parsed?.receivedAt ?? visibleCode?.receivedAt ?? null
      if (!receivedLabel || receivedAt === null) continue

      const href = await shortAttribute(row.locator('a[href]'), 'href')
      const dataId = await shortAttribute(row, 'data-id')
      const id = await shortAttribute(row, 'id')
      const key = href
        ? `href:${href}`
        : dataId
          ? `data:${dataId}`
          : id
            ? `id:${id}`
            : `fast:${normalizeKey(`${sender}|${subject}|${receivedLabel}`)}`

      const summary: InboxesMessageSummary = {
        key,
        sender,
        subject,
        preview: rowText || subject,
        receivedLabel,
        receivedAt
      }
      messages.set(key, summary)
      this.fastRows.set(key, { sender, subject, receivedLabel, receivedAt })

      if (visibleCode) {
        const snapshot: MailMessageSnapshot = {
          id: key,
          receivedAt,
          sender,
          subject,
          bodyPreview: rowText,
          bodyText: rowText
        }
        if (parseVerificationCode([snapshot], observedAt)) {
          this.visibleSnapshots.set(key, snapshot)
        }
      }
    }

    const result = [...messages.values()].sort((left, right) => (right.receivedAt ?? 0) - (left.receivedAt ?? 0))
    if (result.length === 0) {
      const body = await this.page.locator('body').innerText({ timeout: INBOXES_DOM_PROBE_TIMEOUT_MS }).catch(() => '')
      const relevantLines = body
        .split(/\r?\n/)
        .map(normalizeText)
        .filter((line) => /microsoft|security code|verification code|secs? ago|mins? ago|seconds? ago/i.test(line))
        .slice(0, 12)
        .join(' | ')
      emailDiagnostic('inboxes-dom', 'scan-no-message-row', {
        rows: count,
        relevantBodyText: relevantLines
      })
    }

    return result
  }
}
