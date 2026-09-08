import type { BrowserContext, Locator, Page } from 'playwright-core'
import { createBrowserMailProvider, isBrowserMailProviderId } from './browserMailProviderFactory'
import type { MicrosoftLoginSurface } from './emailLoginPolicy'
import { normalizeMailboxAddress, type MailProvider, type MailProviderId } from './mailProvider'
import { resolveMailProviderId } from './mailProviderRegistry'

const MASKED_RECOVERY_EMAIL = /([a-z0-9.!#$%&'+/=?^_`{|}~-]{2,})\*+@([a-z0-9.-]+\.[a-z]{2,})/gi
const MICROSOFT_RECOVERY_SURFACES = new Set<MicrosoftLoginSurface>([
  'recovery_method_choice',
  'recovery_email_confirmation',
  'recovery_code'
])

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

function isAuditedRecoveryCodeCopy(text: string): boolean {
  return /enter\s+your\s+security\s+code/i.test(text) && /email/i.test(text)
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

export function isMicrosoftRecoverySurface(surface: MicrosoftLoginSurface): boolean {
  return MICROSOFT_RECOVERY_SURFACES.has(surface)
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
    provider: null
  }
  sessions.set(context, created)
  return created
}

export function microsoftRecoveryBrowserProviderId(mailbox: string): MailProviderId | null {
  const providerId = resolveMailProviderId(mailbox)
  return isBrowserMailProviderId(providerId) ? providerId : null
}

async function ensureBrowserProvider(
  context: BrowserContext,
  state: MicrosoftRecoverySession
): Promise<MailProvider | null> {
  const providerId = microsoftRecoveryBrowserProviderId(state.mailbox)
  if (!providerId) return null

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

async function endProviderRound(state: MicrosoftRecoverySession): Promise<void> {
  const page = state.providerPage
  state.providerPage = null
  state.providerId = null
  state.provider = null
  if (page && !page.isClosed()) await page.close({ runBeforeUnload: false }).catch(() => undefined)
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

  const provider = await ensureBrowserProvider(microsoftPage.context(), state)
  if (!provider || !state.providerPage) {
    return { status: 'needs_attention', message: `Không mở được provider ${providerId} trong Email browser hiện tại.` }
  }

  await state.providerPage.bringToFront().catch(() => undefined)

  // Consume existing verification messages before asking Microsoft for a fresh
  // code. Providers that lack trustworthy timestamps baseline first-seen keys
  // in this same retained provider instance.
  for (let index = 0; index < 10; index += 1) {
    const existing = await provider.getVerificationCode({
      mailbox: state.mailbox,
      role: 'recovery',
      purpose: 'microsoft_security',
      timeoutMs: 0
    })
    if (existing.status === 'success') continue
    if (existing.status === 'message_not_found') break
    await microsoftPage.bringToFront().catch(() => undefined)
    await endProviderRound(state)
    return { status: 'needs_attention', message: existing.message }
  }

  await microsoftPage.bringToFront().catch(() => undefined)
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
  await page.waitForTimeout(500)
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

  const warmed = await warmMailboxBeforeSend(page, state)
  if (warmed.status === 'needs_attention') return warmed

  await input.fill(confirmation.value)
  const filled = (await input.inputValue().catch(() => '')).trim().toLowerCase()
  if (filled !== confirmation.value.toLowerCase()) {
    await endProviderRound(state)
    return { status: 'needs_attention', message: 'Không xác nhận được Microsoft đã nhận đúng giá trị BackupEmail nên không bấm Send code.' }
  }

  const send = await firstVisible([
    page.getByRole('button', { name: /^send\s+code$/i }).first(),
    page.locator('input[type="submit"][value="Send code" i]:visible').first(),
    page.locator('button:visible').filter({ hasText: /^\s*send\s+code\s*$/i }).first()
  ])
  if (!send || !await send.isEnabled().catch(() => true)) {
    await endProviderRound(state)
    return { status: 'needs_attention', message: 'Nút Send code của Microsoft chưa ở trạng thái có thể thao tác.' }
  }

  const requestedAt = Date.now()
  try {
    await send.click({ timeout: 8_000 })
  } catch {
    await endProviderRound(state)
    return { status: 'needs_attention', message: 'Không click được đúng nút Send code của Microsoft.' }
  }
  state.requestedAt = requestedAt
  state.methodChoiceAttempts = 0
  await page.waitForTimeout(700)
  return { status: 'handled' }
}

async function securityCodeInput(page: Page): Promise<Locator | null> {
  const structured = await firstVisible([
    page.locator('input[autocomplete="one-time-code"]:visible').first(),
    page.locator('input[name*="otc" i]:visible').first(),
    page.locator('input[name*="code" i]:visible').first()
  ])
  if (structured) return structured

  const body = await readBody(page)
  if (!isAuditedRecoveryCodeCopy(body)) return null
  const fallback = page.locator(
    'input:visible:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="password"]):not([name="loginfmt"]):not([autocomplete="username"])'
  )
  return await fallback.count() === 1 ? fallback.first() : null
}

async function readAndSubmitRecoveryCode(
  page: Page,
  state: MicrosoftRecoverySession
): Promise<MicrosoftRecoveryChallengeResult> {
  if (!state.requestedAt) {
    await endProviderRound(state)
    return {
      status: 'needs_attention',
      message: 'Microsoft đang hỏi security code nhưng phiên này chưa xác nhận PAGE-AUTO đã bấm Send code cho Mail KP canonical.'
    }
  }

  const providerId = microsoftRecoveryBrowserProviderId(state.mailbox)
  if (!providerId) {
    await endProviderRound(state)
    return { status: 'needs_attention', message: 'Mail KP canonical chưa có browser provider đọc code tự động được hỗ trợ.' }
  }

  const provider = await ensureBrowserProvider(page.context(), state)
  if (!provider || !state.providerPage) {
    return { status: 'needs_attention', message: `Không mở được provider ${providerId} để lấy security code Microsoft.` }
  }

  await state.providerPage.bringToFront().catch(() => undefined)
  const codeResult = await provider.getVerificationCode({
    mailbox: state.mailbox,
    role: 'recovery',
    purpose: 'microsoft_security',
    // Browser providers may expose coarse relative times or first-seen keys.
    // The pre-Send warm-up in this retained provider round rejects stale mail.
    notBefore: Math.max(1, state.requestedAt - 5_000),
    timeoutMs: 25_000,
    pollIntervalMs: 1_500
  })

  await page.bringToFront().catch(() => undefined)
  if (codeResult.status !== 'success' || !codeResult.code) {
    await endProviderRound(state)
    return { status: 'needs_attention', message: codeResult.message }
  }

  // Fail closed if Microsoft changed from the audited email-code challenge while the provider was polling.
  const body = await readBody(page)
  if (!isAuditedRecoveryCodeCopy(body)) {
    await endProviderRound(state)
    return {
      status: 'needs_attention',
      message: 'Microsoft đã đổi challenge trong lúc chờ Mail KP; PAGE-AUTO không submit code cũ vào màn khác.'
    }
  }

  const input = await securityCodeInput(page)
  if (!input) {
    await endProviderRound(state)
    return { status: 'needs_attention', message: 'Không xác định duy nhất ô security code Microsoft trên màn hiện tại.' }
  }
  await input.fill(codeResult.code)
  const filled = (await input.inputValue().catch(() => '')).trim()
  if (filled !== codeResult.code) {
    await endProviderRound(state)
    return { status: 'needs_attention', message: 'Không xác nhận được security code đã được nhập đúng vào Microsoft.' }
  }

  const next = await firstVisible([
    page.getByRole('button', { name: /^next$/i }).first(),
    page.getByRole('button', { name: /^(continue|tiếp theo|tiếp tục)$/i }).first(),
    page.locator('input[type="submit"][value="Next" i]:visible, input[type="submit"][value="Continue" i]:visible').first()
  ])
  if (!next) {
    await endProviderRound(state)
    return { status: 'needs_attention', message: 'Không tìm thấy nút Next/Continue trên màn security code Microsoft.' }
  }

  try {
    await next.click({ timeout: 8_000 })
  } catch {
    await endProviderRound(state)
    return { status: 'needs_attention', message: 'Không click được đúng nút Next/Continue sau khi nhập security code Microsoft.' }
  }
  state.requestedAt = null
  await page.waitForTimeout(700)
  await endProviderRound(state)
  return { status: 'handled' }
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
