import type { Locator, Page } from 'playwright-core'
import type { MailMessageSnapshot } from './verificationCodeParser'
import { emailDiagnostic } from './emailRuntimeDiagnostic'
import { normalizeMailboxAddress } from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'
import type {
  FviaInboxesEnsureMailboxResult,
  FviaInboxesMailboxDriver,
  FviaInboxesMessageSummary
} from './fviaInboxesProvider'

const FVIA_INBOXES_URL = 'https://fviainboxes.com/'
const FVIA_SURFACE_READY_TIMEOUT_MS = 12_000
const FVIA_SURFACE_POLL_MS = 500
const RELATIVE_TIME = /\b(?:just now|now|(?:a|few|a few)\s+seconds?\s+ago|\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|day|days)\s+ago)\b/i

export type FviaInboxesSurface =
  | 'loading'
  | 'mailbox_form'
  | 'mailbox_ready'
  | 'provider_unavailable'

export interface FviaInboxesSurfaceSnapshot {
  bodyText: string
  expectedMailbox: string
  activatedMailbox: string | null
  usernameValue: string
  selectedDomain: string | null
  usernameInputVisible: boolean
  domainControlVisible: boolean
  getEmailButtonVisible: boolean
  inboxVisible: boolean
}

function splitMailbox(mailbox: string): { local: string; domain: string } | null {
  const normalized = normalizeMailboxAddress(mailbox)
  if (!normalized) return null
  const separator = normalized.lastIndexOf('@')
  return {
    local: normalized.slice(0, separator),
    domain: normalized.slice(separator + 1)
  }
}

export function classifyFviaInboxesSurface(snapshot: FviaInboxesSurfaceSnapshot): FviaInboxesSurface {
  const expected = splitMailbox(snapshot.expectedMailbox)
  const activated = normalizeMailboxAddress(snapshot.activatedMailbox ?? '')
  const username = snapshot.usernameValue.trim().toLowerCase()
  const domain = snapshot.selectedDomain?.trim().toLowerCase().replace(/^@/, '') ?? null
  const text = snapshot.bodyText.replace(/\s+/g, ' ').trim().toLowerCase()
  const hardUnavailable = /service unavailable|temporarily unavailable|bad gateway|gateway timeout|access denied/.test(text)

  if (hardUnavailable) return 'provider_unavailable'

  if (
    expected
    && activated === normalizeMailboxAddress(snapshot.expectedMailbox)
    && username === expected.local
    && domain === expected.domain
    && snapshot.inboxVisible
  ) {
    return 'mailbox_ready'
  }

  if (snapshot.usernameInputVisible && snapshot.domainControlVisible && snapshot.getEmailButtonVisible) {
    return 'mailbox_form'
  }

  // Live Fvia can remain blank/partially hydrated for several seconds after
  // domcontentloaded. Treat missing form controls as transient until the bounded
  // ensureMailbox readiness window expires; otherwise we return before username.fill().
  return 'loading'
}

export function parseFviaReceivedAtLabel(labelInput: string, now = Date.now()): number | null {
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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function looksLikeUiChrome(textInput: string): boolean {
  const text = normalizeText(textInput).toLowerCase()
  if (!text || text.length > 260) return true
  return /^(inbox|info|sponsored|get email|no emails yet|refresh|reload)$/.test(text)
    || /free temporary email|free, fast, private|emails will appear here automatically|enter your username/.test(text)
}

function messageKey(
  href: string | null,
  dataId: string | null,
  id: string | null,
  text: string
): string {
  if (href) return `href:${href}`
  if (dataId) return `data:${dataId}`
  if (id) return `id:${id}`
  return `text:${normalizeText(text).toLowerCase()}`
}

/**
 * Browser adapter for the UI audited on fviainboxes.com:
 * username -> domain -> Get Email -> Inbox -> message detail.
 *
 * It uses only visible form/inbox semantics. When the site does not expose a
 * trustworthy message timestamp, summaries intentionally return receivedAt=null;
 * FviaInboxesProvider then uses first-seen baselining within the live provider round.
 */
export class FviaInboxesPlaywrightDriver implements FviaInboxesMailboxDriver {
  private activeMailbox: string | null = null
  private readonly messageLocators = new Map<string, Locator>()

  constructor(private readonly page: Page) {}

  async ensureMailbox(mailboxInput: string): Promise<FviaInboxesEnsureMailboxResult> {
    const mailbox = normalizeMailboxAddress(mailboxInput)
    const parts = mailbox ? splitMailbox(mailbox) : null
    if (!mailbox || !parts || resolveMailProviderId(mailbox) !== 'fvia_inboxes') {
      return { status: 'mailbox_not_found', message: 'Địa chỉ FviaInboxes không hợp lệ.' }
    }

    if (this.page.isClosed()) {
      return { status: 'provider_unavailable', message: 'Tab FviaInboxes đã đóng.' }
    }

    emailDiagnostic('fvia-dom', 'ensure-start', {
      domain: parts.domain,
      pageState: /^https:\/\/([^/]+\.)?fviainboxes\.com\//i.test(this.page.url()) ? 'provider' : 'other'
    })

    if (!/^https:\/\/([^/]+\.)?fviainboxes\.com\//i.test(this.page.url())) {
      try {
        await this.page.goto(FVIA_INBOXES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        this.activeMailbox = null
      } catch {
        emailDiagnostic('fvia-dom', 'navigate-error', { domain: parts.domain })
        return { status: 'provider_unavailable', message: 'Không tải được FviaInboxes.' }
      }
    }

    const readinessDeadline = Date.now() + FVIA_SURFACE_READY_TIMEOUT_MS
    for (let step = 0; step < 32; step += 1) {
      const surface = await this.readSurface(mailbox)
      if (surface === 'mailbox_ready') {
        emailDiagnostic('fvia-dom', 'ensure-result', { status: 'ready', domain: parts.domain })
        return { status: 'ready', activeMailbox: mailbox }
      }
      if (surface === 'provider_unavailable') {
        emailDiagnostic('fvia-dom', 'ensure-result', { status: 'provider_unavailable', domain: parts.domain })
        return { status: 'provider_unavailable', message: 'FviaInboxes đang không ở surface có thể thao tác an toàn.' }
      }
      if (surface === 'loading') {
        if (Date.now() >= readinessDeadline) {
          emailDiagnostic('fvia-dom', 'hydrate-timeout', { domain: parts.domain })
          return { status: 'provider_unavailable', message: 'FviaInboxes chưa render form mailbox trong thời gian chờ an toàn.' }
        }
        await this.page.waitForTimeout(FVIA_SURFACE_POLL_MS)
        continue
      }

      const submitted = await this.submitMailbox(parts.local, parts.domain)
      if (!submitted) {
        return { status: 'mailbox_not_found', message: 'Không nhập/chọn đúng mailbox trên form FviaInboxes.' }
      }
      this.activeMailbox = mailbox
      await this.waitForUiChange()
    }

    return { status: 'mailbox_not_found', message: 'Không xác minh được mailbox FviaInboxes sau nhiều lần đọc lại trạng thái.' }
  }

  async listMessages(now = Date.now()): Promise<FviaInboxesMessageSummary[]> {
    this.messageLocators.clear()
    const messages: FviaInboxesMessageSummary[] = []
    const seen = new Set<string>()

    const candidates = this.page.locator(
      'tr:visible, [role="row"]:visible, [role="listitem"]:visible, li:visible, a:visible, button:visible, [role="button"]:visible, p:visible, span:visible'
    )
    const count = Math.min(await candidates.count(), 300)

    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index)
      if (!await candidate.isVisible().catch(() => false)) continue
      const text = normalizeText(await candidate.innerText().catch(() => ''))
      if (looksLikeUiChrome(text)) continue

      const href = await candidate.getAttribute('href').catch(() => null)
      const dataId = await candidate.getAttribute('data-message-id').catch(() => null)
        ?? await candidate.getAttribute('data-id').catch(() => null)
      const id = await candidate.getAttribute('id').catch(() => null)
      const key = messageKey(href, dataId, id, text)
      if (seen.has(key)) continue
      seen.add(key)

      const receivedLabel = text.match(RELATIVE_TIME)?.[0] ?? ''
      const receivedAt = parseFviaReceivedAtLabel(receivedLabel, now)
      messages.push({
        key,
        sender: '',
        subject: text,
        preview: text,
        receivedLabel,
        receivedAt
      })
      this.messageLocators.set(key, candidate)
    }

    return messages
  }

  async readMessage(message: FviaInboxesMessageSummary): Promise<MailMessageSnapshot | null> {
    const locator = this.messageLocators.get(message.key)
    if (!locator || !await locator.isVisible().catch(() => false)) return null

    const beforeText = normalizeText(await this.page.locator('body').innerText({ timeout: 5_000 }).catch(() => ''))
    try {
      await locator.click({ timeout: 8_000 })
    } catch {
      return null
    }
    await this.waitForUiChange()

    const bodyText = normalizeText(await this.page.locator('body').innerText({ timeout: 5_000 }).catch(() => ''))
    if (!bodyText || bodyText === beforeText || !bodyText.toLowerCase().includes(message.subject.toLowerCase())) {
      return null
    }

    const snapshot: MailMessageSnapshot = {
      id: message.key,
      receivedAt: message.receivedAt ?? 0,
      sender: message.sender,
      subject: message.subject,
      bodyPreview: message.preview,
      bodyText
    }

    await this.page.goto(FVIA_INBOXES_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined)
    this.activeMailbox = null
    return snapshot
  }

  async refreshMailbox(): Promise<void> {
    const refresh = this.page.getByRole('button', { name: /refresh|reload|làm mới/i }).first()
    if (await visible(refresh)) {
      await refresh.click().catch(() => undefined)
      await this.waitForUiChange()
      return
    }

    // The audited Fvia page states that incoming messages appear automatically.
    // Do not reload here because reload clears the selected mailbox; polling the
    // live DOM is safer and keeps the current inbox active.
    await this.page.waitForTimeout(500)
  }

  private async readSurface(expectedMailbox: string): Promise<FviaInboxesSurface> {
    const bodyText = await this.page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    const username = this.page.getByPlaceholder(/enter your username/i).first()
    const domain = await this.domainControl()
    const getEmail = this.page.getByRole('button', { name: /^get email$/i }).first()
    const inbox = this.page.getByText(/^inbox$/i).first()
    const snapshot: FviaInboxesSurfaceSnapshot = {
      bodyText,
      expectedMailbox,
      activatedMailbox: this.activeMailbox,
      usernameValue: await username.inputValue().catch(() => ''),
      selectedDomain: domain ? await this.selectedDomain(domain) : null,
      usernameInputVisible: await visible(username),
      domainControlVisible: domain !== null && await visible(domain),
      getEmailButtonVisible: await visible(getEmail),
      inboxVisible: await visible(inbox)
    }
    const surface = classifyFviaInboxesSurface(snapshot)
    emailDiagnostic('fvia-dom', 'surface', {
      surface,
      usernameInputVisible: snapshot.usernameInputVisible,
      domainControlVisible: snapshot.domainControlVisible,
      getEmailButtonVisible: snapshot.getEmailButtonVisible,
      inboxVisible: snapshot.inboxVisible,
      selectedDomain: snapshot.selectedDomain
    })
    return surface
  }

  private async domainControl(): Promise<Locator | null> {
    const nativeSelects = this.page.locator('select:visible')
    const selectCount = Math.min(await nativeSelects.count(), 20)
    for (let index = 0; index < selectCount; index += 1) {
      const candidate = nativeSelects.nth(index)
      const optionTexts = await candidate.locator('option').allTextContents().catch(() => [] as string[])
      if (optionTexts.some((text) => resolveMailProviderId(`owner@${normalizeText(text).toLowerCase().replace(/^@/, '')}`) === 'fvia_inboxes')) {
        return candidate
      }
    }

    const comboboxes = this.page.getByRole('combobox')
    const comboCount = Math.min(await comboboxes.count(), 20)
    for (let index = 0; index < comboCount; index += 1) {
      const candidate = comboboxes.nth(index)
      if (!await candidate.isVisible().catch(() => false)) continue
      const selected = await this.selectedDomain(candidate)
      if (selected && resolveMailProviderId(`owner@${selected}`) === 'fvia_inboxes') return candidate
    }

    return null
  }

  private async selectedDomain(control: Locator): Promise<string | null> {
    const value = (await control.inputValue().catch(() => '')).trim()
    if (value) return value.toLowerCase().replace(/^@/, '')

    const selectedOption = control.locator('option:checked').first()
    const selectedText = normalizeText(await selectedOption.innerText().catch(() => ''))
    if (selectedText) return selectedText.toLowerCase().replace(/^@/, '')

    const text = normalizeText(await control.innerText().catch(() => ''))
    return text ? text.toLowerCase().replace(/^@/, '') : null
  }

  private async submitMailbox(local: string, domainValue: string): Promise<boolean> {
    const username = this.page.getByPlaceholder(/enter your username/i).first()
    if (!await visible(username)) {
      emailDiagnostic('fvia-dom', 'submit-missing-username', { domain: domainValue })
      return false
    }

    try {
      await username.fill(local)
    } catch {
      emailDiagnostic('fvia-dom', 'submit-username-fill-error', { domain: domainValue })
      return false
    }
    const usernameValue = (await username.inputValue().catch(() => '')).trim().toLowerCase()
    if (usernameValue !== local) {
      emailDiagnostic('fvia-dom', 'submit-username-mismatch', {
        domain: domainValue,
        expectedLength: local.length,
        actualLength: usernameValue.length
      })
      return false
    }
    emailDiagnostic('fvia-dom', 'username-filled', { domain: domainValue, localLength: local.length })

    const domain = await this.domainControl()
    if (!domain) {
      emailDiagnostic('fvia-dom', 'submit-missing-domain-control', { domain: domainValue })
      return false
    }

    if ((await domain.evaluate((element) => element.tagName.toLowerCase()).catch(() => '')) === 'select') {
      try {
        await domain.selectOption({ label: domainValue })
      } catch {
        await domain.selectOption(domainValue).catch(() => undefined)
      }
    } else {
      await domain.click().catch(() => undefined)
      const option = this.page.getByRole('option', { name: domainValue, exact: true }).first()
      if (await visible(option)) {
        await option.click()
      } else {
        const domainText = this.page.getByText(domainValue, { exact: true }).last()
        if (!await visible(domainText)) {
          emailDiagnostic('fvia-dom', 'submit-domain-option-missing', { domain: domainValue })
          return false
        }
        await domainText.click()
      }
    }

    const selectedDomain = await this.selectedDomain(domain)
    if (selectedDomain !== domainValue) {
      emailDiagnostic('fvia-dom', 'submit-domain-mismatch', {
        expectedDomain: domainValue,
        selectedDomain
      })
      return false
    }
    emailDiagnostic('fvia-dom', 'domain-selected', { domain: domainValue })

    const getEmail = this.page.getByRole('button', { name: /^get email$/i }).first()
    if (!await visible(getEmail) || !await getEmail.isEnabled().catch(() => true)) {
      emailDiagnostic('fvia-dom', 'submit-get-email-unavailable', { domain: domainValue })
      return false
    }
    try {
      await getEmail.click({ timeout: 8_000 })
    } catch {
      emailDiagnostic('fvia-dom', 'submit-get-email-click-error', { domain: domainValue })
      return false
    }
    emailDiagnostic('fvia-dom', 'submit-clicked', { domain: domainValue })
    return true
  }

  private async waitForUiChange(): Promise<void> {
    await Promise.race([
      this.page.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => undefined),
      this.page.waitForTimeout(500)
    ])
    await this.page.waitForTimeout(150)
  }
}
