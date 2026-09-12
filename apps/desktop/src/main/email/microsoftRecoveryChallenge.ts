import { createHash } from 'node:crypto'
import type { BrowserContext, Locator, Page } from 'playwright-core'
import type { EmailRecoveryRoundContract } from './emailAuthV2Contracts'
import type { MicrosoftLoginSurface } from './emailLoginPolicy'
import { normalizeMailboxAddress, type MailboxCodeRequest, type MailProviderId } from './mailProvider'
import { createMailboxProviderRouter } from './mailboxProviderComposition'
import type { MailboxProviderRouter } from './mailboxProviderRouter'

const MASKED_RECOVERY_EMAIL = /([a-z0-9.!#$%&'+/=?^_`{|}~-]{2,})\*+@([a-z0-9.-]+\.[a-z]{2,})/gi
const UNMASKED_RECOVERY_EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const RESUME_CODE_LOOKBACK_MS = 10 * 60_000
const RECOVERY_CODE_TIMEOUT_MS = 25_000
const REJECTED_RECOVERY_CODE_TIMEOUT_MS = 10_000
const MICROSOFT_RECOVERY_SURFACES = new Set<MicrosoftLoginSurface>([
  'recovery_method_choice',
  'recovery_email_confirmation',
  'recovery_code'
])

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
  accountId: number
  mailbox: string
  requestedAt: number | null
  methodChoiceAttempts: number
  mailboxRouter: MailboxProviderRouter | null
  round: EmailRecoveryRoundContract | null
  pendingRound: EmailRecoveryRoundContract | null
  /** Durable across multiple Send-code rounds in the same auth/recovery session. */
  sessionConsumedMessageKeys: string[]
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
  providerId: MailProviderId | null,
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

function sessionFor(context: BrowserContext, mailbox: string, accountId: number): MicrosoftRecoverySession {
  const existing = sessions.get(context)
  if (existing?.mailbox === mailbox && existing.accountId === accountId) return existing

  const created: MicrosoftRecoverySession = {
    accountId,
    mailbox,
    requestedAt: null,
    methodChoiceAttempts: 0,
    mailboxRouter: null,
    round: null,
    pendingRound: null,
    sessionConsumedMessageKeys: []
  }
  sessions.set(context, created)
  return created
}

/**
 * Clear only durable recovery metadata after the Microsoft detector has proven
 * the auth flow is authenticated. Provider pages remain owned by their mailbox
 * modules/browser runtime; Microsoft Auth only drops typed router/challenge state.
 */
export function completeMicrosoftRecoveryAfterAuthenticated(context: BrowserContext): boolean {
  const state = sessions.get(context)
  if (!state) return false

  const hadRecoveryState = state.requestedAt !== null
    || state.round !== null
    || state.pendingRound !== null
    || state.mailboxRouter !== null
  state.requestedAt = null
  state.methodChoiceAttempts = 0
  state.round = null
  state.pendingRound = null
  state.sessionConsumedMessageKeys = []
  state.mailboxRouter = null
  return hadRecoveryState
}

function mailboxRouterFor(page: Page, state: MicrosoftRecoverySession): MailboxProviderRouter {
  state.mailboxRouter ??= createMailboxProviderRouter(page.context())
  return state.mailboxRouter
}

function mailboxRequest(
  state: MicrosoftRecoverySession,
  challengeId: string,
  detail: Partial<Pick<
    MailboxCodeRequest,
    'notBefore' | 'baselineMessageKeys' | 'consumedMessageKeys' | 'timeoutMs' | 'pollIntervalMs'
  >> = {}
): MailboxCodeRequest {
  return {
    accountId: state.accountId,
    mailbox: state.mailbox,
    role: 'recovery',
    purpose: 'microsoft_security',
    challengeId,
    ...detail
  }
}

async function warmMailboxBeforeSend(
  microsoftPage: Page,
  state: MicrosoftRecoverySession
): Promise<MicrosoftRecoveryChallengeResult> {
  const provisionalRound = createMicrosoftRecoveryRound(
    state.mailbox,
    null,
    null,
    [],
    state.sessionConsumedMessageKeys
  )
  const baseline = await mailboxRouterFor(microsoftPage, state).prepareChallenge(
    mailboxRequest(state, provisionalRound.challengeId)
  )
  if (baseline.status !== 'success' || baseline.providerId === null) {
    state.pendingRound = null
    return {
      status: 'needs_attention',
      message: baseline.message
    }
  }

  state.pendingRound = {
    ...provisionalRound,
    providerId: baseline.providerId,
    baselineMessageKeys: uniqueMessageKeys(baseline.messageKeys)
  }
  return { status: 'handled' }
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
  if (filled !== confirmation.value.toLowerCase()) {
    return { status: 'needs_attention', message: 'Không xác nhận được Microsoft đã nhận đúng giá trị BackupEmail nên không bấm Send code.' }
  }

  const send = await firstVisible([
    page.getByRole('button', { name: /^send\s+code$/i }).first(),
    page.locator('input[type="submit"][value="Send code" i]:visible').first(),
    page.locator('button:visible').filter({ hasText: /^\s*send\s+code\s*$/i }).first()
  ])
  if (!send || !await send.isEnabled().catch(() => true)) {
    return { status: 'needs_attention', message: 'Nút Send code của Microsoft chưa ở trạng thái có thể thao tác.' }
  }

  // Baseline exactly at the actionable Send-code boundary. The router owns
  // provider resolution and provider modules own freshness/page lifecycle.
  const warmed = await warmMailboxBeforeSend(page, state)
  if (warmed.status === 'needs_attention') return warmed

  const boundaryFilled = (await input.inputValue().catch(() => '')).trim().toLowerCase()
  const sendReadyAtBoundary = await send.isVisible().catch(() => false)
    && await send.isEnabled().catch(() => false)
  if (boundaryFilled !== confirmation.value.toLowerCase() || !sendReadyAtBoundary) {
    state.pendingRound = null
    return { status: 'needs_attention', message: 'Microsoft đổi trạng thái form trong lúc baseline Mail KP; PAGE-AUTO không bấm Send code trên surface cũ.' }
  }

  const requestedAt = Date.now()
  try {
    await send.click({ timeout: 8_000 })
  } catch {
    state.pendingRound = null
    return { status: 'needs_attention', message: 'Không click được đúng nút Send code của Microsoft.' }
  }

  state.requestedAt = requestedAt
  state.methodChoiceAttempts = 0
  if (state.pendingRound) {
    state.round = {
      ...state.pendingRound,
      requestedAt
    }
    state.pendingRound = null
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

function recoveryCodeTimeoutMs(rejectedPreviousCode: boolean): number {
  return rejectedPreviousCode ? REJECTED_RECOVERY_CODE_TIMEOUT_MS : RECOVERY_CODE_TIMEOUT_MS
}

async function readAndSubmitRecoveryCode(
  page: Page,
  state: MicrosoftRecoverySession
): Promise<MicrosoftRecoveryChallengeResult> {
  const initialBody = await readBody(page)
  if (!isAuditedRecoveryCodeCopy(initialBody)) {
    return {
      status: 'needs_attention',
      message: 'Microsoft không còn ở màn code Email đã audit; PAGE-AUTO không đọc hoặc submit mã vào challenge khác.'
    }
  }

  const resumedWithoutRoundState = state.requestedAt === null && state.round === null
  if (resumedWithoutRoundState && !microsoftRecoveryCodeChallengeMatchesBackupEmail(initialBody, state.mailbox)) {
    return {
      status: 'needs_attention',
      message: 'Màn code Microsoft hiện tại không xác nhận đang nhắm đúng BackupEmail canonical; PAGE-AUTO không đoán code khi resume giữa chừng.'
    }
  }

  const router = mailboxRouterFor(page, state)
  let notBefore: number | undefined

  if (!state.round) {
    if (!resumedWithoutRoundState) {
      return {
        status: 'needs_attention',
        message: 'Challenge Mail KP đang thiếu round identity sau Send code; PAGE-AUTO dừng an toàn thay vì đoán provider/code.'
      }
    }

    const provisionalRound = createMicrosoftRecoveryRound(
      state.mailbox,
      null,
      null,
      [],
      state.sessionConsumedMessageKeys
    )
    const prepared = await router.prepareResumeChallenge(
      mailboxRequest(state, provisionalRound.challengeId),
      { lookbackMs: RESUME_CODE_LOOKBACK_MS }
    )
    if (prepared.status !== 'success' || prepared.providerId === null) {
      return { status: 'needs_attention', message: prepared.message }
    }

    state.round = {
      ...provisionalRound,
      providerId: prepared.providerId,
      baselineMessageKeys: uniqueMessageKeys(prepared.messageKeys)
    }
    notBefore = prepared.notBefore
  }

  const round = state.round
  if (!round || round.providerId === null) {
    return {
      status: 'needs_attention',
      message: 'Mailbox Router chưa resolve được provider canonical cho challenge Microsoft hiện tại.'
    }
  }

  notBefore ??= state.requestedAt !== null
    ? Math.max(1, state.requestedAt - 5_000)
    : Math.max(1, Date.now() - RESUME_CODE_LOOKBACK_MS)

  const rejectedPreviousCode = microsoftRecoveryCodeWasRejected(initialBody)
  const codeResult = await router.getFreshCode(mailboxRequest(state, round.challengeId, {
    notBefore,
    baselineMessageKeys: round.baselineMessageKeys,
    consumedMessageKeys: uniqueMessageKeys(state.sessionConsumedMessageKeys, round.consumedMessageKeys),
    timeoutMs: recoveryCodeTimeoutMs(rejectedPreviousCode)
  }))

  if (codeResult.providerId !== null && codeResult.providerId !== round.providerId) {
    return {
      status: 'needs_attention',
      message: 'Mailbox Router đổi provider identity giữa cùng một Microsoft recovery challenge.'
    }
  }

  if (codeResult.status !== 'success' || !codeResult.code || !codeResult.messageKey) {
    return { status: 'needs_attention', message: codeResult.message }
  }

  // Microsoft can change surface while a provider is polling. Re-read before
  // typing; state-driven detection owns whatever surface is now authoritative.
  const body = await readBody(page)
  if (!isAuditedRecoveryCodeCopy(body)
    || (resumedWithoutRoundState && !microsoftRecoveryCodeChallengeMatchesBackupEmail(body, state.mailbox))) {
    return { status: 'handled' }
  }

  state.round = microsoftRecoveryRecordSubmittedCode(round, codeResult.messageKey, codeResult.code)
  state.sessionConsumedMessageKeys = uniqueMessageKeys(
    state.sessionConsumedMessageKeys,
    state.round.consumedMessageKeys
  )
  return await submitSecurityCode(page, codeResult.code)
}

/** Handle only the audited Microsoft recovery-email challenge. Unknown security surfaces remain manual. */
export async function handleMicrosoftRecoveryChallenge(
  page: Page,
  surface: MicrosoftLoginSurface,
  backupEmailInput: string | null | undefined,
  accountId: number
): Promise<MicrosoftRecoveryChallengeResult> {
  if (!isMicrosoftRecoverySurface(surface)) {
    return { status: 'needs_attention', message: 'Surface Microsoft hiện tại không thuộc module Mail KP được hỗ trợ.' }
  }

  const backupEmail = normalizeMailboxAddress(backupEmailInput ?? '')
  if (!backupEmail) {
    return { status: 'needs_attention', message: 'Account thiếu BackupEmail canonical nên PAGE-AUTO không chọn hoặc lấy code Mail KP.' }
  }

  const state = sessionFor(page.context(), backupEmail, accountId)
  if (surface === 'recovery_method_choice') return await chooseRecoveryMethod(page, backupEmail, state)
  if (surface === 'recovery_email_confirmation') return await confirmRecoveryEmailAndSend(page, backupEmail, state)
  return await readAndSubmitRecoveryCode(page, state)
}
