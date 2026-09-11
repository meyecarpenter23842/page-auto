import { createHash } from 'node:crypto'
import type { BrowserContext, Locator, Page } from 'playwright-core'
import { createBrowserMailProvider, isBrowserMailProviderId } from './browserMailProviderFactory'
import type { EmailRecoveryRoundContract } from './emailAuthV2Contracts'
import type { MicrosoftLoginSurface } from './emailLoginPolicy'
import {
  createMailboxCodeService,
  isMailboxCodeServiceProviderId,
  type MailboxCodeService,
  type MailboxCodeServiceProviderId
} from './mailboxCodeService'
import { normalizeMailboxAddress, type MailProvider, type MailProviderId } from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

const MASKED_RECOVERY_EMAIL = /([a-z0-9.!#$%&'+/=?^_`{|}~-]{2,})\*+@([a-z0-9.-]+\.[a-z]{2,})/gi
const UNMASKED_RECOVERY_EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const RESUME_CODE_LOOKBACK_MS = 10 * 60_000
const RESUME_FIRST_SEEN_BASELINE_PROVIDER_IDS = new Set<MailProviderId>(['fvia_inboxes', 'mailto_plus'])
const MICROSOFT_RECOVERY_SURFACES = new Set<MicrosoftLoginSurface>([
  'recovery_method_choice',
  'recovery_email_confirmation',
  'recovery_code'
])
const INBOXES_CODE_TIMEOUT_MS = 12_000
const INBOXES_REJECTED_CODE_TIMEOUT_MS = 4_000
const INBOXES_CODE_POLL_MS = 500
const FVIA_CODE_TIMEOUT_MS = 25_000
const FVIA_REJECTED_CODE_TIMEOUT_MS = 10_000
const FVIA_CODE_POLL_MS = 1_500

let recoveryChallengeSequence = 0

export interface MicrosoftRecoveryEmailHint {
  prefix: string
  domain: string
  raw: string
}

export type MicrosoftRecoveryChallengeResult =
  | { status: 'handled' }
  | { status: 'needs_attention'; message: string }

export type MicrosoftRecoveryConfirmationValue =
  | { mode: 'local_part'; value: string }
  | { mode: 'full_email'; value: string }

interface MicrosoftRecoverySession {
  mailbox: string
  requestedAt: number | null
  methodChoiceAttempts: number
  providerPage: Page | null
  providerId: MailProviderId | null
  provider: MailProvider | null
  mailboxCodeService: MailboxCodeService | null
  round: EmailRecoveryRoundContract | null
  /** Durable across multiple Send-code rounds in the same auth/recovery session. */
  sessionConsumedMessageKeys: string[]
  /** Captured immediately before Send code and transferred into the next round. */
  pendingBaselineMessageKeys: string[]
}

const sessions = new WeakMap<BrowserContext, MicrosoftRecoverySession>()

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitMailbox(value: string): { local: string; domain: string } | null {
  const mailbox = normalizeMailboxAddress(value)
  if (!mailbox) return null
  const separator = mailbox.lastIndexOf('@')
  return {
    local: mailbox.slice(0, separator),
    domain: mailbox.slice(separator + 1)
  }
}

function firstMatchingHint(text: string, backupEmail: string): MicrosoftRecoveryEmailHint | null {
  const mailbox = splitMailbox(backupEmail)
  if (!mailbox) return null
  return parseMicrosoftRecoveryEmailHints(text).find((hint) => {
    return hint.prefix.length >= 2
      && hint.domain === mailbox.domain
      && mailbox.local.startsWith(hint.prefix)
  }) ?? null
}

function textContainsExactMailbox(text: string, mailbox: string): boolean {
  const matches = text.match(UNMASKED_RECOVERY_EMAIL) ?? []
  return matches.some((candidate) => normalizeMailboxAddress(candidate) === mailbox)
}

function isAuditedRecoveryCodeCopy(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ')
  const heading = /enter\s+your\s+(?:security\s+)?code/i.test(normalized)
  const emailEvidence = /matches\s+the\s+email\s+address\s+on\s+your\s+account|we(?:'|’)ll\s+send\s+you\s+a\s+code|we\s+will\s+send\s+you\s+a\s+code|we\s+sent[^.]*code[^.]*email|sent[^.]*to\s+your\s+email|email\s+address/i.test(normalized)
  return heading && emailEvidence
}

export function microsoftRecoveryCodeWasRejected(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ')
  return /that\s+code\s+didn['’]?t\s+work|check\s+the\s+code\s+and\s+try\s+again|incorrect\s+code|invalid\s+code|code\s+is\s+incorrect/i.test(normalized)
}

export function parseMicrosoftRecoveryEmailHints(text: string): MicrosoftRecoveryEmailHint[] {
  const hints: MicrosoftRecoveryEmailHint[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(MASKED_RECOVERY_EMAIL)) {
    const prefix = (match[1] ?? '').toLowerCase()
    const domain = (match[2] ?? '').toLowerCase().replace(/\.+$/, '')
    if (prefix.length < 2 || !domain) continue
    const key = `${prefix}@${domain}`
    if (seen.has(key)) continue
    seen.add(key)
    hints.push({ prefix, domain, raw: match[0] ?? `${prefix}***@${domain}` })
  }
  return hints
}

/** Microsoft recovery hints are trusted only when >=2 visible local chars + exact domain match BackupEmail. */
export function microsoftRecoveryHintMatchesBackupEmail(text: string, backupEmail: string): boolean {
  return firstMatchingHint(text, backupEmail) !== null
}

export function microsoftRecoveryLocalPart(backupEmail: string): string | null {
  return splitMailbox(backupEmail)?.local ?? null
}

/**
 * Resolve only the two recovery-confirmation forms observed in live Microsoft flows.
 * The masked hint must still match canonical BackupEmail before any value is typed.
 */
export function microsoftRecoveryConfirmationValue(
  text: string,
  backupEmail: string
): MicrosoftRecoveryConfirmationValue | null {
  const mailbox = normalizeMailboxAddress(backupEmail)
  const parts = splitMailbox(backupEmail)
  if (!mailbox || !parts || !firstMatchingHint(text, backupEmail)) return null

  if (/complete\s+the\s+hidden\s+part/i.test(text) && text.toLowerCase().includes(`@${parts.domain}`)) {
    return { mode: 'local_part', value: parts.local }
  }

  const fullEmailConfirmation = /verify\s+your\s+email/i.test(text)
    && /to\s+verify\s+(?:that\s+)?this\s+is\s+your\s+email(?:\s+address)?\s*[,.:;-]?\s*enter\s+it\s+here/i.test(text)
  if (fullEmailConfirmation) return { mode: 'full_email', value: mailbox }

  return null
}

/**
 * A resumed code screen is safe to automate only when the live Microsoft copy
 * still points at the canonical BackupEmail (full address or the audited mask).
 */
export function microsoftRecoveryCodeChallengeMatchesBackupEmail(text: string, backupEmail: string): boolean {
  const mailbox = normalizeMailboxAddress(backupEmail)
  if (!mailbox || !isAuditedRecoveryCodeCopy(text)) return false
  if (textContainsExactMailbox(text, mailbox)) return true
  return firstMatchingHint(text, mailbox) !== null
}

/** Timestamp-less providers must baseline existing message keys when resuming mid-code. */
export function microsoftRecoveryRequiresResumeMailboxBaseline(providerId: MailProviderId): boolean {
  return RESUME_FIRST_SEEN_BASELINE_PROVIDER_IDS.has(providerId)
}

/** Auth V2 provider boundary: Inboxes and FviaInboxes use MailboxCodeService; MailtoPlus remains legacy. */
export function microsoftRecoveryUsesMailboxCodeService(
  providerId: MailProviderId
): providerId is MailboxCodeServiceProviderId {
  return isMailboxCodeServiceProviderId(providerId)
}

/** Resolve the value written to one OTP input or to each box in a split-code UI. */
export function microsoftRecoveryCodeInputParts(codeInput: string, inputCount: number): string[] | null {
  const code = codeInput.trim()
  if (!/^[a-z0-9]{4,8}$/i.test(code) || !Number.isInteger(inputCount) || inputCount < 1) return null
  if (inputCount === 1) return [code]
  if (inputCount === code.length) return [...code]
  return null
}

export function isMicrosoftRecoverySurface(surface: MicrosoftLoginSurface): boolean {
  return MICROSOFT_RECOVERY_SURFACES.has(surface)
}

function codeFingerprint(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 16)
}

function uniqueMessageKeys(...values: readonly (readonly string[])[]): string[] {
  const keys = new Set<string>()
  for (const list of values) {
    for (const value of list) {
      const key = value.trim()
      if (key) keys.add(key)
    }
  }
  return [...keys]
}

export function createMicrosoftRecoveryRound(
  mailbox: string,
  providerId: MailProviderId,
  requestedAt: number | null,
  baselineMessageKeys: readonly string[] = [],
  sessionConsumedMessageKeys: readonly string[] = []
): EmailRecoveryRoundContract {
  recoveryChallengeSequence += 1
  return {
    challengeId: `microsoft-recovery-${Date.now()}-${recoveryChallengeSequence}`,
    mailbox,
    providerId,
    requestedAt,
    baselineMessageKeys: uniqueMessageKeys(baselineMessageKeys),
    consumedMessageKeys: uniqueMessageKeys(sessionConsumedMessageKeys),
    lastSubmittedMessageKey: null,
    lastSubmittedCodeFingerprint: null,
    submitAttempts: 0
  }
}

export function microsoftRecoveryRecordSubmittedCode(
  round: EmailRecoveryRoundContract,
  messageKey: string,
  code: string
): EmailRecoveryRoundContract {
  const keys = new Set(round.consumedMessageKeys)
  if (messageKey.trim()) keys.add(messageKey.trim())
  return {
    ...round,
    consumedMessageKeys: [...keys],
    lastSubmittedMessageKey: messageKey.trim() || null,
    lastSubmittedCodeFingerprint: codeFingerprint(code),
    submitAttempts: round.submitAttempts + 1
  }
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function readBody(page: Page): Promise<string> {
  return await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
}

function sessionFor(context: BrowserContext, mailbox: string): MicrosoftRecoverySession {
  const existing = sessions.get(context)
  if (existing?.mailbox === mailbox) return existing
  if (existing?.providerPage && !existing.providerPage.isClosed()) {
    void existing.providerPage.close({ runBeforeUnload: false }).catch(() => undefined)
  }
  const created: MicrosoftRecoverySession = {
    mailbox,
    requestedAt: null,
    methodChoiceAttempts: 0,
    providerPage: null,
    providerId: null,
    provider: null,
    mailboxCodeService: null,
    round: null,
    sessionConsumedMessageKeys: [],
    pendingBaselineMessageKeys: []
  }
  sessions.set(context, created)
  return created
}

/**
 * Clear only durable recovery metadata after the Microsoft detector has proven
 * the auth flow is authenticated. Provider pages themselves stay owned by the
 * isolated mailbox runtime; only cached adapters/round state are dropped.
 */
export function completeMicrosoftRecoveryAfterAuthenticated(context: BrowserContext): boolean {
  const state = sessions.get(context)
  if (!state) return false

  const hadRecoveryState = state.requestedAt !== null || state.round !== null || state.mailboxCodeService !== null
  state.requestedAt = null
  state.methodChoiceAttempts = 0
  state.round = null
  state.sessionConsumedMessageKeys = []
  state.pendingBaselineMessageKeys = []
  if (state.mailboxCodeService) {
    state.mailboxCodeService.invalidateProvider('inboxes')
    state.mailboxCodeService.invalidateProvider('fvia_inboxes')
    state.mailboxCodeService = null
  }
  return hadRecoveryState
}

export function microsoftRecoveryBrowserProviderId(mailbox: string): MailProviderId | null {
  const providerId = resolveMailProviderId(mailbox)
  return isBrowserMailProviderId(providerId) ? providerId : null
}

async function ensureLegacyBrowserProvider(
  context: BrowserContext,
  state: MicrosoftRecoverySession
): Promise<MailProvider | null> {
  const providerId = microsoftRecoveryBrowserProviderId(state.mailbox)
  if (!providerId || microsoftRecoveryUsesMailboxCodeService(providerId)) return null

  if (
    state.provider
    && state.providerId === providerId
    && state.providerPage
    && !state.providerPage.isClosed()
  ) {
    return state.provider
  }

  if (state.providerPage && !state.providerPage.isClosed()) {
    await state.providerPage.close({ runBeforeUnload: false }).catch(() => undefined)
  }

  try {
    const page = await context.newPage()
    const provider = createBrowserMailProvider(providerId, page)
    if (!provider) {
      await page.close({ runBeforeUnload: false }).catch(() => undefined)
      return null
    }
    state.providerPage = page
    state.providerId = providerId
    state.provider = provider
    return provider
  } catch {
    state.providerPage = null
    state.providerId = null
    state.provider = null
    return null
  }
}

async function endLegacyProviderRound(state: MicrosoftRecoverySession): Promise<void> {
  const page = state.providerPage
  state.providerPage = null
  state.providerId = null
  state.provider = null
  if (page && !page.isClosed()) await page.close({ runBeforeUnload: false }).catch(() => undefined)
}

async function consumeExistingVerificationMessages(
  microsoftPage: Page,
  state: MicrosoftRecoverySession,
  provider: MailProvider
): Promise<MicrosoftRecoveryChallengeResult> {
  await state.providerPage?.bringToFront().catch(() => undefined)

  for (let index = 0; index < 50; index += 1) {
    const existing = await provider.getVerificationCode({
      mailbox: state.mailbox,
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })
    if (existing.status === 'success') continue
    await microsoftPage.bringToFront().catch(() => undefined)
    if (existing.status === 'message_not_found') return { status: 'handled' }
    await endLegacyProviderRound(state)
    return { status: 'needs_attention', message: existing.message }
  }

  await microsoftPage.bringToFront().catch(() => undefined)
  await endLegacyProviderRound(state)
  return {
    status: 'needs_attention',
    message: 'Mailbox có quá nhiều mail verification cũ để baseline an toàn; PAGE-AUTO không đoán security code.'
  }
}

async function warmMailboxBeforeSend(
  microsoftPage: Page,
  state: MicrosoftRecoverySession
): Promise<MicrosoftRecoveryChallengeResult> {
  const providerId = microsoftRecoveryBrowserProviderId(state.mailbox)
  if (!providerId) {
    return {
      status: 'needs_attention',
      message: 'Mail KP canonical chưa có browser provider tự động được hỗ trợ; PAGE-AUTO không bấm Send code.'
    }
  }

  if (microsoftRecoveryUsesMailboxCodeService(providerId)) {
    state.mailboxCodeService ??= createMailboxCodeService(microsoftPage.context())
    const baseline = await state.mailboxCodeService.prepareChallengeBaseline({
      mailbox: state.mailbox,
      providerId
    })
    if (baseline.status !== 'success') {
      return {
        status: 'needs_attention',
        message: baseline.message
      }
    }
    state.pendingBaselineMessageKeys = uniqueMessageKeys(baseline.messageKeys)
    return { status: 'handled' }
  }

  const provider = await ensureLegacyBrowserProvider(microsoftPage.context(), state)
  if (!provider || !state.providerPage) {
    return { status: 'needs_attention', message: `Không mở được provider ${providerId} trong Email browser hiện tại.` }
  }
  return await consumeExistingVerificationMessages(microsoftPage, state, provider)
}

async function chooseRecoveryMethod(
  page: Page,
  backupEmail: string,
  state: MicrosoftRecoverySession
): Promise<MicrosoftRecoveryChallengeResult> {
  const body = await readBody(page)
  const hint = firstMatchingHint(body, backupEmail)
  if (!hint) {
    return {
      status: 'needs_attention',
      message: 'Mail KP Microsoft đang hiển thị không khớp ít nhất 2 ký tự đầu + domain của BackupEmail canonical.'
    }
  }

  state.methodChoiceAttempts += 1
  if (state.methodChoiceAttempts > 3) {
    return {
      status: 'needs_attention',
      message: 'Đã xác minh đúng Mail KP nhưng Microsoft không chuyển khỏi màn chọn phương thức sau nhiều lần thử có giới hạn.'
    }
  }

  const masked = new RegExp(`(?:email\\s+)?${escapeRegExp(hint.prefix)}\\*+@${escapeRegExp(hint.domain)}`, 'i')
  const control = await firstVisible([
    page.getByRole('radio', { name: masked }).first(),
    page.locator('label:visible').filter({ hasText: masked }).first(),
    page.locator('[role="button"]:visible').filter({ hasText: masked }).first(),
    page.getByText(masked).first()
  ])
  if (!control) {
    return {
      status: 'needs_attention',
      message: 'Đã match Mail KP canonical nhưng không tìm thấy control Microsoft tương ứng để chọn an toàn.'
    }
  }

  try {
    await control.click({ timeout: 8_000 })
  } catch {
    return { status: 'needs_attention', message: 'Không click được đúng lựa chọn Mail KP đã xác minh trên Microsoft.' }
  }
  await page.waitForTimeout(350)
  return { status: 'handled' }
}

async function recoveryConfirmationInput(page: Page): Promise<Locator | null> {
  const candidates = page.locator(
    'input:visible:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="password"]):not([name="loginfmt"]):not([autocomplete="username"]):not([autocomplete="one-time-code"]):not([name*="code" i])'
  )
  const count = await candidates.count()
  if (count !== 1) return null
  return candidates.first()
}

async function confirmRecoveryEmailAndSend(
  page: Page,
  backupEmail: string,
  state: MicrosoftRecoverySession
): Promise<MicrosoftRecoveryChallengeResult> {
  const body = await readBody(page)
  const confirmation = microsoftRecoveryConfirmationValue(body, backupEmail)
  if (!confirmation) {
    return {
      status: 'needs_attention',
      message: 'Microsoft đang dùng form xác nhận Mail KP khác surface đã audit hoặc Mail KP masked không khớp BackupEmail canonical.'
    }
  }

  const input = await recoveryConfirmationInput(page)
  if (!input) {
    return { status: 'needs_attention', message: 'Không xác định duy nhất ô nhập Mail KP trên màn Microsoft hiện tại.' }
  }

  await input.fill(confirmation.value)
  const filled = (await input.inputValue().catch(() => '')).trim().toLowerCase()
  const providerIdAtForm = microsoftRecoveryBrowserProviderId(state.mailbox)
  if (filled !== confirmation.value.toLowerCase()) {
    if (providerIdAtForm && !microsoftRecoveryUsesMailboxCodeService(providerIdAtForm)) await endLegacyProviderRound(state)
    return { status: 'needs_attention', message: 'Không xác nhận được Microsoft đã nhận đúng giá trị BackupEmail nên không bấm Send code.' }
  }

  const send = await firstVisible([
    page.getByRole('button', { name: /^send\s+code$/i }).first(),
    page.locator('input[type="submit"][value="Send code" i]:visible').first(),
    page.locator('button:visible').filter({ hasText: /^\s*send\s+code\s*$/i }).first()
  ])
  if (!send || !await send.isEnabled().catch(() => true)) {
    if (providerIdAtForm && !microsoftRecoveryUsesMailboxCodeService(providerIdAtForm)) await endLegacyProviderRound(state)
    return { status: 'needs_attention', message: 'Nút Send code của Microsoft chưa ở trạng thái có thể thao tác.' }
  }

  // Take the mailbox identity baseline at the actual Send-code boundary, after
  // the form is filled and the control is known to be actionable. This closes
  // the gap where a delayed code from the preceding challenge could arrive
  // between an early baseline and this click.
  const warmed = await warmMailboxBeforeSend(page, state)
  if (warmed.status === 'needs_attention') return warmed

  const boundaryFilled = (await input.inputValue().catch(() => '')).trim().toLowerCase()
  const sendReadyAtBoundary = await send.isVisible().catch(() => false)
    && await send.isEnabled().catch(() => false)
  if (boundaryFilled !== confirmation.value.toLowerCase() || !sendReadyAtBoundary) {
    if (providerIdAtForm && !microsoftRecoveryUsesMailboxCodeService(providerIdAtForm)) await endLegacyProviderRound(state)
    return { status: 'needs_attention', message: 'Microsoft đổi trạng thái form trong lúc baseline Mail KP; PAGE-AUTO không bấm Send code trên surface cũ.' }
  }

  const requestedAt = Date.now()
  try {
    await send.click({ timeout: 8_000 })
  } catch {
    if (providerIdAtForm && !microsoftRecoveryUsesMailboxCodeService(providerIdAtForm)) await endLegacyProviderRound(state)
    return { status: 'needs_attention', message: 'Không click được đúng nút Send code của Microsoft.' }
  }

  const providerId = microsoftRecoveryBrowserProviderId(state.mailbox)
  state.requestedAt = requestedAt
  state.methodChoiceAttempts = 0
  if (providerId && microsoftRecoveryUsesMailboxCodeService(providerId)) {
    state.round = createMicrosoftRecoveryRound(
      state.mailbox,
      providerId,
      requestedAt,
      state.pendingBaselineMessageKeys,
      state.sessionConsumedMessageKeys
    )
    state.pendingBaselineMessageKeys = []
  }
  await page.waitForTimeout(350)
  return { status: 'handled' }
}

async function fillSecurityCode(page: Page, code: string): Promise<boolean> {
  const body = await readBody(page)
  if (!isAuditedRecoveryCodeCopy(body)) return false

  let inputs = page.locator(
    'input:visible:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="password"]):not([type="email"]):not([name="loginfmt"]):not([autocomplete="username"])'
  )
  let parts = microsoftRecoveryCodeInputParts(code, await inputs.count())

  if (!parts) {
    inputs = page.locator(
      'input[autocomplete="one-time-code"]:visible, input[name*="otc" i]:visible, input[name*="code" i]:visible'
    )
    parts = microsoftRecoveryCodeInputParts(code, await inputs.count())
  }
  if (!parts) return false

  for (let index = 0; index < parts.length; index += 1) {
    const input = inputs.nth(index)
    await input.fill(parts[index] ?? '')
  }

  const values: string[] = []
  for (let index = 0; index < parts.length; index += 1) {
    values.push((await inputs.nth(index).inputValue().catch(() => '')).trim())
  }
  return values.join('') === code
}

async function submitSecurityCode(page: Page, code: string): Promise<MicrosoftRecoveryChallengeResult> {
  if (!await fillSecurityCode(page, code)) {
    return { status: 'needs_attention', message: 'Không xác nhận được security code đã được nhập đúng vào các ô Microsoft hiện tại.' }
  }

  const next = await firstVisible([
    page.getByRole('button', { name: /^next$/i }).first(),
    page.getByRole('button', { name: /^(continue|tiếp theo|tiếp tục)$/i }).first(),
    page.locator('input[type="submit"][value="Next" i]:visible, input[type="submit"][value="Continue" i]:visible').first()
  ])
  if (!next) {
    return { status: 'needs_attention', message: 'Không tìm thấy nút Next/Continue trên màn security code Microsoft.' }
  }

  try {
    await next.click({ timeout: 8_000 })
  } catch {
    return { status: 'needs_attention', message: 'Không click được đúng nút Next/Continue sau khi nhập security code Microsoft.' }
  }

  // Do not infer success from this click. The worker's Microsoft detector must
  // classify the next surface. Keep the provider round alive until re-detection
  // proves the flow left or rejected this code.
  await page.waitForTimeout(250)
  return { status: 'handled' }
}

function mailboxServiceTimeoutMs(providerId: MailboxCodeServiceProviderId, rejectedPreviousCode: boolean): number {
  if (providerId === 'fvia_inboxes') {
    return rejectedPreviousCode ? FVIA_REJECTED_CODE_TIMEOUT_MS : FVIA_CODE_TIMEOUT_MS
  }
  return rejectedPreviousCode ? INBOXES_REJECTED_CODE_TIMEOUT_MS : INBOXES_CODE_TIMEOUT_MS
}

function mailboxServicePollMs(providerId: MailboxCodeServiceProviderId): number {
  return providerId === 'fvia_inboxes' ? FVIA_CODE_POLL_MS : INBOXES_CODE_POLL_MS
}

async function readAndSubmitMailboxServiceRecoveryCode(
  page: Page,
  state: MicrosoftRecoverySession,
  providerId: MailboxCodeServiceProviderId,
  initialBody: string,
  resumedWithoutRoundState: boolean
): Promise<MicrosoftRecoveryChallengeResult> {
  state.mailboxCodeService ??= createMailboxCodeService(page.context())

  if (!state.round) {
    let baselineMessageKeys: readonly string[] = []
    if (resumedWithoutRoundState && microsoftRecoveryRequiresResumeMailboxBaseline(providerId)) {
      const baseline = await state.mailboxCodeService.prepareChallengeBaseline({
        mailbox: state.mailbox,
        providerId
      })
      if (baseline.status !== 'success') {
        return { status: 'needs_attention', message: baseline.message }
      }
      baselineMessageKeys = baseline.messageKeys
    }

    state.round = createMicrosoftRecoveryRound(
      state.mailbox,
      providerId,
      state.requestedAt,
      baselineMessageKeys,
      state.sessionConsumedMessageKeys
    )
  }

  const notBefore = state.requestedAt !== null
    ? Math.max(1, state.requestedAt - 5_000)
    : resumedWithoutRoundState && microsoftRecoveryRequiresResumeMailboxBaseline(providerId)
      ? Math.max(1, Date.now())
      : Math.max(1, Date.now() - RESUME_CODE_LOOKBACK_MS)
  const rejectedPreviousCode = microsoftRecoveryCodeWasRejected(initialBody)
  const codeResult = await state.mailboxCodeService.getFreshCode({
    mailbox: state.mailbox,
    providerId,
    challengeId: state.round.challengeId,
    notBefore,
    baselineMessageKeys: state.round.baselineMessageKeys,
    consumedMessageKeys: uniqueMessageKeys(state.sessionConsumedMessageKeys, state.round.consumedMessageKeys),
    timeoutMs: mailboxServiceTimeoutMs(providerId, rejectedPreviousCode),
    pollIntervalMs: mailboxServicePollMs(providerId)
  })

  state.sessionConsumedMessageKeys = uniqueMessageKeys(state.sessionConsumedMessageKeys, codeResult.consumedMessageKeys)
  state.round = {
    ...state.round,
    consumedMessageKeys: [...state.sessionConsumedMessageKeys]
  }

  if (codeResult.status !== 'success' || !codeResult.code || !codeResult.messageKey) {
    return { status: 'needs_attention', message: codeResult.message }
  }

  // Microsoft can change surface while the background provider is polling. Re-read
  // before typing, and never push an old code into another challenge.
  const body = await readBody(page)
  if (!isAuditedRecoveryCodeCopy(body)
    || (resumedWithoutRoundState && !microsoftRecoveryCodeChallengeMatchesBackupEmail(body, state.mailbox))) {
    return {
      status: 'handled'
    }
  }

  state.round = microsoftRecoveryRecordSubmittedCode(state.round, codeResult.messageKey, codeResult.code)
  state.sessionConsumedMessageKeys = uniqueMessageKeys(state.sessionConsumedMessageKeys, state.round.consumedMessageKeys)
  return await submitSecurityCode(page, codeResult.code)
}

async function readAndSubmitLegacyRecoveryCode(
  page: Page,
  state: MicrosoftRecoverySession,
  providerId: MailProviderId,
  resumedWithoutRoundState: boolean
): Promise<MicrosoftRecoveryChallengeResult> {
  const provider = await ensureLegacyBrowserProvider(page.context(), state)
  if (!provider || !state.providerPage) {
    return { status: 'needs_attention', message: `Không mở được provider ${providerId} để lấy security code Microsoft.` }
  }

  let notBefore: number
  if (state.requestedAt !== null) {
    notBefore = Math.max(1, state.requestedAt - 5_000)
  } else if (microsoftRecoveryRequiresResumeMailboxBaseline(providerId)) {
    const baselined = await consumeExistingVerificationMessages(page, state, provider)
    if (baselined.status === 'needs_attention') return baselined
    notBefore = Math.max(1, Date.now())
  } else {
    notBefore = Math.max(1, Date.now() - RESUME_CODE_LOOKBACK_MS)
  }

  if (!state.providerPage) {
    return { status: 'needs_attention', message: `Provider ${providerId} đã đóng trước khi PAGE-AUTO bắt đầu chờ security code Microsoft.` }
  }

  await state.providerPage.bringToFront().catch(() => undefined)
  const codeResult = await provider.getVerificationCode({
    mailbox: state.mailbox,
    role: 'recovery',
    purpose: 'microsoft_security',
    notBefore,
    timeoutMs: 25_000,
    pollIntervalMs: 1_500
  })
  await page.bringToFront().catch(() => undefined)

  if (codeResult.status !== 'success' || !codeResult.code) {
    await endLegacyProviderRound(state)
    return { status: 'needs_attention', message: codeResult.message }
  }

  const body = await readBody(page)
  if (!isAuditedRecoveryCodeCopy(body)
    || (resumedWithoutRoundState && !microsoftRecoveryCodeChallengeMatchesBackupEmail(body, state.mailbox))) {
    await endLegacyProviderRound(state)
    return {
      status: 'needs_attention',
      message: 'Microsoft đã đổi challenge trong lúc chờ Mail KP; PAGE-AUTO không submit code cũ vào màn khác.'
    }
  }

  const submitted = await submitSecurityCode(page, codeResult.code)
  if (submitted.status === 'needs_attention') {
    await endLegacyProviderRound(state)
    return submitted
  }
  state.requestedAt = null
  await endLegacyProviderRound(state)
  return submitted
}

async function readAndSubmitRecoveryCode(
  page: Page,
  state: MicrosoftRecoverySession
): Promise<MicrosoftRecoveryChallengeResult> {
  const initialBody = await readBody(page)
  const providerId = microsoftRecoveryBrowserProviderId(state.mailbox)
  if (!isAuditedRecoveryCodeCopy(initialBody)) {
    if (providerId && !microsoftRecoveryUsesMailboxCodeService(providerId)) await endLegacyProviderRound(state)
    return {
      status: 'needs_attention',
      message: 'Microsoft không còn ở màn code Email đã audit; PAGE-AUTO không đọc hoặc submit mã vào challenge khác.'
    }
  }

  const resumedWithoutRoundState = state.requestedAt === null && state.round === null
  if (resumedWithoutRoundState && !microsoftRecoveryCodeChallengeMatchesBackupEmail(initialBody, state.mailbox)) {
    if (providerId && !microsoftRecoveryUsesMailboxCodeService(providerId)) await endLegacyProviderRound(state)
    return {
      status: 'needs_attention',
      message: 'Màn code Microsoft hiện tại không xác nhận đang nhắm đúng BackupEmail canonical; PAGE-AUTO không đoán code khi resume giữa chừng.'
    }
  }

  if (!providerId) {
    return { status: 'needs_attention', message: 'Mail KP canonical chưa có browser provider đọc code tự động được hỗ trợ.' }
  }

  if (microsoftRecoveryUsesMailboxCodeService(providerId)) {
    return await readAndSubmitMailboxServiceRecoveryCode(
      page,
      state,
      providerId,
      initialBody,
      resumedWithoutRoundState
    )
  }
  return await readAndSubmitLegacyRecoveryCode(page, state, providerId, resumedWithoutRoundState)
}

/** Handle only the audited Microsoft recovery-email challenge. Unknown security surfaces remain manual. */
export async function handleMicrosoftRecoveryChallenge(
  page: Page,
  surface: MicrosoftLoginSurface,
  backupEmailInput: string | null | undefined
): Promise<MicrosoftRecoveryChallengeResult> {
  if (!isMicrosoftRecoverySurface(surface)) {
    return { status: 'needs_attention', message: 'Surface Microsoft hiện tại không thuộc module Mail KP được hỗ trợ.' }
  }

  const backupEmail = normalizeMailboxAddress(backupEmailInput ?? '')
  if (!backupEmail) {
    return { status: 'needs_attention', message: 'Account thiếu BackupEmail canonical nên PAGE-AUTO không chọn hoặc lấy code Mail KP.' }
  }

  const state = sessionFor(page.context(), backupEmail)
  if (surface === 'recovery_method_choice') return await chooseRecoveryMethod(page, backupEmail, state)
  if (surface === 'recovery_email_confirmation') return await confirmRecoveryEmailAndSend(page, backupEmail, state)
  return await readAndSubmitRecoveryCode(page, state)
}
