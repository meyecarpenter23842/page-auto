import type { Frame, Locator, Page } from 'playwright-core'
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
const FVIA_DETAIL_READY_TIMEOUT_MS = 2_500
const FVIA_DETAIL_POLL_MS = 100
const RELATIVE_TIME = /\b(?:just now|now|(?:a|few|a few)\s+seconds?\s+ago|\d+\s*(?:sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|day|days)\s+ago)\b/i
const VERIFICATION_DETAIL_CODE = /(?:(?:verification|security|one[- ]?time|single[- ]?use)\s+code|mã\s+(?:xác minh|bảo mật|đăng nhập))(?:\s+is|\s+là)?\s*[:#-]?\s*\d{4,8}\b/i

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

export function isFviaDomainControlValue(value: string): boolean {
  const domain = normalizeText(value).toLowerCase().replace(/^@/, '')
  return Boolean(domain) && resolveMailProviderId(`owner@${domain}`) === 'fvia_inboxes'
}

export type FviaDomainControlReadMode = 'select' | 'value' | 'text'

export function fviaDomainControlReadMode(tagNameInput: string): FviaDomainControlReadMode {
  const tagName = tagNameInput.trim().toLowerCase()
  if (tagName === 'select') return 'select'
  if (tagName === 'input' || tagName === 'textarea') return 'value'
  return 'text'
}

export function fviaVerificationDetailReady(beforeTextInput: string, bodyTextInput: string): boolean {
  const beforeText = normalizeText(beforeTextInput)
  const bodyText = normalizeText(bodyTextInput)
  if (!bodyText || bodyText === beforeText) return false
  return VERIFICATION_DETAIL_CODE.test(bodyText)
}

export type FviaVerificationDetailSource = 'root' | 'frame'

export interface FviaVerificationDetailSurface {
  source: FviaVerificationDetailSource
  text: string
}

export function pickFviaVerificationDetail(
  beforeTextInput: string,
  surfaces: readonly FviaVerificationDetailSurface[]
): FviaVerificationDetailSurface | null {
  for (const surface of surfaces) {
    const text = normalizeText(surface.text)
    if (!fviaVerificationDetailReady(beforeTextInput, text)) continue
    return { source: surface.source, text }
  }
  return null
}

function looksLikeUiChrome(textInput: string): boolean {
  const text = normalizeText(textInput).toLowerCase()
  if (!text || text.length > 260) return true
  return /^(inbox|info|sponsored|get email|no emails yet|refresh|reload)$/.test(text)
    || /free temporary email|free, fast, private|emails will appear here automatically|enter your username/.test(text)
}

export interface FviaMessageIdentityInput {
  href: string | null
  dataId: string | null
  id: string | null
  text: string
}

function stableMessageKey(row: FviaMessageIdentityInput): string | null {
  if (row.href) return `href:${row.href}`
  if (row.dataId) return `data:${row.dataId}`
  if (row.id) return `id:${row.id}`
  return null
}

function fallbackMessageIdentityBase(textInput: string): string {
  const withoutRelativeTime = textInput.replace(new RegExp(RELATIVE_TIME.source, 'gi'), ' ')
  const normalized = normalizeText(withoutRelativeTime).toLowerCase()
  return normalized || normalizeText(textInput).toLowerCase()
}

/**
 * Fvia often exposes no stable DOM id/href for a message row. In that fallback
 * case the visible relative-time label cannot be part of message identity because
 * the same row mutates from "just now" to "1 minute ago" between recovery rounds.
 *
 * Live Fvia prepends newer rows. Number identical fallback rows from the oldest
 * end so existing rows keep their slot when a new same-subject Microsoft code
 * mail is prepended: [new, old] => [slot:1, slot:0]. This keeps baseline/consumed
 * identity stable while still distinguishing consecutive identical code mails.
 */
export function fviaMessageKeys(rows: readonly FviaMessageIdentityInput[]): string[] {
  const remainingByBase = new Map<string, number>()
  for (const row of rows) {
    if (stableMessageKey(row)) continue
    const base = fallbackMessageIdentityBase(row.text)
    remainingByBase.set(base, (remainingByBase.get(base) ?? 0) + 1)
  }

  return rows.map((row) => {
    const stable = stableMessageKey(row)
    if (stable) return stable

    const base = fallbackMessageIdentityBase(row.text)
    const slot = Math.max(0, (remainingByBase.get(base) ?? 1) - 1)
    remainingByBase.set(base, slot)
    return `text:${base}|slot:${slot}`
  })
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

    // Only keep actionable message-row shapes. The live Fvia DOM also renders
    // nested p/span copies of the same row text; treating those as separate
    // messages creates duplicate keys and click targets that cannot open detail.
    const candidates = this.page.locator(
      'tr:visible, [role="row"]:visible, [role="listitem"]:visible, li:visible, a:visible, button:visible, [role="button"]:visible'
    )
    const count = Math.min(await candidates.count(), 300)
    const rows: Array<{
      locator: Locator
      text: string
      href: string | null
      dataId: string | null
      id: string | null
      receivedLabel: string
      receivedAt: number | null
    }> = []

    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index)
      if (!await candidate.isVisible().catch(() => false)) continue
      const text = normalizeText(await candidate.innerText().catch(() => ''))
      if (looksLikeUiChrome(text)) continue

      const directHref = await candidate.getAttribute('href').catch(() => null)
      const href = directHref
        ?? await candidate.locator('a[href]').first().getAttribute('href').catch(() => null)
      const dataId = await candidate.getAttribute('data-message-id').catch(() => null)
        ?? await candidate.getAttribute('data-id').catch(() => null)
      const id = await candidate.getAttribute('id').catch(() => null)
      const receivedLabel = text.match(RELATIVE_TIME)?.[0] ?? ''
      rows.push({
        locator: candidate,
        text,
        href,
        dataId,
        id,
        receivedLabel,
        receivedAt: parseFviaReceivedAtLabel(receivedLabel, now)
      })
    }

    const keys = fviaMessageKeys(rows)
    const fallbackBases = rows
      .filter((row) => stableMessageKey(row) === null)
      .map((row) => fallbackMessageIdentityBase(row.text))
    const fallbackCounts = new Map<string, number>()
    for (const base of fallbackBases) fallbackCounts.set(base, (fallbackCounts.get(base) ?? 0) + 1)
    const duplicateFallbackGroups = [...fallbackCounts.values()].filter((value) => value > 1).length
    if (fallbackBases.length > 0) {
      emailDiagnostic('fvia-dom', 'message-identity', {
        rows: rows.length,
        fallbackRows: fallbackBases.length,
        duplicateFallbackGroups
      })
    }

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const key = keys[index]
      if (!row || !key || seen.has(key)) continue
      seen.add(key)

      messages.push({
        key,
        sender: '',
        subject: row.text,
        preview: row.text,
        receivedLabel: row.receivedLabel,
        receivedAt: row.receivedAt
      })
      this.messageLocators.set(key, row.locator)
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
      emailDiagnostic('fvia-dom', 'read-click-error', {})
      return null
    }

    const detail = await this.waitForVerificationDetail(beforeText)
    const detailReady = detail.source !== null
    emailDiagnostic('fvia-dom', 'read-detail', {
      detailReady,
      detailSource: detail.source ?? 'none',
      surfaceCount: detail.surfaceCount,
      bodyChanged: Boolean(detail.bodyText) && detail.bodyText !== beforeText,
      bodyLength: detail.bodyText.length
    })
    if (!detailReady) return null

    const snapshot: MailMessageSnapshot = {
      id: message.key,
      receivedAt: message.receivedAt ?? 0,
      sender: message.sender,
      subject: message.subject,
      bodyPreview: message.preview,
      bodyText: detail.bodyText
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
      if (optionTexts.some((text) => isFviaDomainControlValue(text))) {
        return candidate
      }
    }

    const comboboxes = this.page.getByRole('combobox')
    const comboCount = Math.min(await comboboxes.count(), 20)
    for (let index = 0; index < comboCount; index += 1) {
      const candidate = comboboxes.nth(index)
      if (!await candidate.isVisible().catch(() => false)) continue
      const selected = await this.selectedDomain(candidate)
      if (selected && isFviaDomainControlValue(selected)) return candidate
    }

    // Live Fvia currently renders the domain picker as a listbox trigger rather
    // than a native select/ARIA combobox. Keep this provider-local and only accept
    // a visible trigger whose current text is itself a registered Fvia domain.
    const listboxTriggers = this.page.locator('[aria-haspopup="listbox"]:visible')
    const listboxCount = Math.min(await listboxTriggers.count(), 20)
    for (let index = 0; index < listboxCount; index += 1) {
      const candidate = listboxTriggers.nth(index)
      if (!await candidate.isVisible().catch(() => false)) continue
      const selected = await this.selectedDomain(candidate)
      if (selected && isFviaDomainControlValue(selected)) return candidate
    }

    return null
  }

  private async selectedDomain(control: Locator): Promise<string | null> {
    const tagName = await control.evaluate((element) => element.tagName.toLowerCase()).catch(() => '')
    const readMode = fviaDomainControlReadMode(tagName)

    if (readMode === 'value') {
      const value = normalizeText(await control.inputValue().catch(() => ''))
      return value ? value.toLowerCase().replace(/^@/, '') : null
    }

    if (readMode === 'select') {
      const value = normalizeText(await control.inputValue().catch(() => ''))
      if (value) return value.toLowerCase().replace(/^@/, '')

      const selectedText = normalizeText(await control.locator('option:checked').first().innerText({ timeout: 1_000 }).catch(() => ''))
      if (selectedText) return selectedText.toLowerCase().replace(/^@/, '')
    }

    // Custom Fvia listbox/combobox triggers are buttons/divs. Read their visible
    // label directly; never query option:checked on these controls because that
    // locator waits for a native option that can never exist and stalls the flow.
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

  private async verificationDetailSurfaces(): Promise<FviaVerificationDetailSurface[]> {
    const rootText = normalizeText(await this.page.locator('body').innerText({ timeout: 1_000 }).catch(() => ''))
    const surfaces: FviaVerificationDetailSurface[] = [{ source: 'root', text: rootText }]
    const frameReader = (this.page as unknown as { frames?: () => readonly Frame[] }).frames
    if (typeof frameReader !== 'function') return surfaces

    let frames: readonly Frame[]
    try {
      frames = frameReader.call(this.page)
    } catch {
      return surfaces
    }

    for (const frame of frames) {
      const frameText = normalizeText(await frame.locator('body').innerText({ timeout: 1_000 }).catch(() => ''))
      if (!frameText || frameText === rootText) continue
      surfaces.push({ source: 'frame', text: frameText })
    }
    return surfaces
  }

  private async waitForVerificationDetail(beforeText: string): Promise<{
    bodyText: string
    source: FviaVerificationDetailSource | null
    surfaceCount: number
  }> {
    const deadline = Date.now() + FVIA_DETAIL_READY_TIMEOUT_MS
    let latestSurfaces: FviaVerificationDetailSurface[] = []

    while (Date.now() < deadline) {
      latestSurfaces = await this.verificationDetailSurfaces()
      const detail = pickFviaVerificationDetail(beforeText, latestSurfaces)
      if (detail) {
        return {
          bodyText: detail.text,
          source: detail.source,
          surfaceCount: latestSurfaces.length
        }
      }
      await this.page.waitForTimeout(FVIA_DETAIL_POLL_MS)
    }

    return {
      bodyText: latestSurfaces[0]?.text ?? '',
      source: null,
      surfaceCount: latestSurfaces.length
    }
  }

  private async waitForUiChange(): Promise<void> {
    await Promise.race([
      this.page.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => undefined),
      this.page.waitForTimeout(500)
    ])
    await this.page.waitForTimeout(150)
  }
}
