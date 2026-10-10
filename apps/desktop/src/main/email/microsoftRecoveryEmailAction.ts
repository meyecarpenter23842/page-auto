import type { Locator, Page } from 'playwright-core'
import { createMailboxProviderRouter } from './mailboxProviderComposition'
import { normalizeMailboxAddress } from './mailProvider'
import { isMicrosoftFidoCreateUrl } from './microsoftAccountSecurityNavigation'
import { navigateToManageHowISignIn } from './microsoftSecurityNavigator'

export interface MicrosoftRecoveryEmailActionInput {
  accountId: number
  backupEmail?: string | null
  recoveryEmail?: string | null
}

export interface MicrosoftRecoveryEmailActionResult {
  status: 'success' | 'needs_attention'
  message: string
}

const ADD_RECOVERY_CODE_TIMEOUT_MS = 60_000

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    if (await locator.isVisible().catch(() => false)) return locator
  }
  return null
}

function escapePattern(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
}

function exactMailboxVisible(text: string, mailbox: string): boolean {
  return text.toLowerCase().includes(mailbox.toLowerCase())
}

function maskedIdentity(mailbox: string): { prefix: string; domain: string } | null {
  const normalized = normalizeMailboxAddress(mailbox)
  if (!normalized) return null
  const at = normalized.lastIndexOf('@')
  const local = normalized.slice(0, at)
  const domain = normalized.slice(at + 1)
  return { prefix: local.slice(0, Math.min(2, local.length)), domain }
}

function maskedMailboxVisible(text: string, mailbox: string): boolean {
  const identity = maskedIdentity(mailbox)
  if (!identity?.prefix) return false
  return new RegExp(
    escapePattern(identity.prefix) + '\\*+@' + escapePattern(identity.domain),
    'i'
  ).test(text)
}

export function microsoftRecoveryMailboxEvidence(
  text: string,
  targetMailbox: string,
  existingMailbox?: string | null
): boolean {
  if (exactMailboxVisible(text, targetMailbox)) return true
  if (!maskedMailboxVisible(text, targetMailbox)) return false

  const existing = existingMailbox ? normalizeMailboxAddress(existingMailbox) : null
  if (!existing) return true
  const targetIdentity = maskedIdentity(targetMailbox)
  const existingIdentity = maskedIdentity(existing)
  return !targetIdentity
    || !existingIdentity
    || targetIdentity.prefix !== existingIdentity.prefix
    || targetIdentity.domain !== existingIdentity.domain
}

function codeRejected(text: string): boolean {
  return /incorrect\s+code|invalid\s+code|code\s+is\s+incorrect|code\s+didn['’]?t\s+work|mã\s+không\s+đúng|mã\s+không\s+hợp\s+lệ/i.test(text)
}

function successCopy(text: string): boolean {
  return /successfully\s+(?:added|verified)|has\s+been\s+added|you\s+can\s+now\s+use|đã\s+(?:thêm|xác\s+minh)|thêm\s+thành\s+công/i.test(text)
}

async function readBody(page: Page): Promise<string> {
  return await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
}

async function findRecoveryEmailInput(page: Page): Promise<Locator | null> {
  return await firstVisible([
    page.getByLabel(/recovery\s+email|alternate\s+email|email\s+address|email\s+khôi\s+phục|địa\s+chỉ\s+email/i).first(),
    page.locator('input[type="email"]:visible:not([name="loginfmt"]):not([autocomplete="username"])').first(),
    page.locator('input[autocomplete="email"]:visible:not([name="loginfmt"]):not([autocomplete="username"])').first()
  ])
}

async function chooseEmailMethod(page: Page): Promise<boolean> {
  const method = await firstVisible([
    page.getByRole('radio', { name: /^(email|recovery email|email address|email a code|email khôi phục|địa chỉ email)$/i }).first(),
    page.getByRole('button', { name: /^(email|recovery email|email address|email a code|email khôi phục|địa chỉ email)$/i }).first(),
    page.getByRole('link', { name: /^(email|recovery email|email address|email a code|email khôi phục|địa chỉ email)$/i }).first(),
    page.locator('[role="option"]:visible').filter({ hasText: /^(email|recovery email|email address|email a code|email khôi phục|địa chỉ email)$/i }).first(),
    page.getByText(/^(email|recovery email|email address|email a code|email khôi phục|địa chỉ email)$/i).first()
  ])
  if (!method) return false
  await method.click({ timeout: 8_000 }).catch(() => undefined)
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(250)
  if (isMicrosoftFidoCreateUrl(page.url())) return false
  return true
}

async function openAddRecoveryForm(page: Page): Promise<Locator | null> {
  let input = await findRecoveryEmailInput(page)
  if (input) return input

  const add = await firstVisible([
    page.getByRole('button', { name: /add a new way to sign in or verify|add a new way to verify|add method|thêm (?:một )?cách mới để đăng nhập hoặc xác minh|thêm phương thức/i }).first(),
    page.getByRole('link', { name: /add a new way to sign in or verify|add a new way to verify|add method|thêm (?:một )?cách mới để đăng nhập hoặc xác minh|thêm phương thức/i }).first(),
    page.getByText(/add a new way to sign in or verify|add a new way to verify|add method|thêm (?:một )?cách mới để đăng nhập hoặc xác minh|thêm phương thức/i).first()
  ])
  if (!add) return null

  await add.click({ timeout: 8_000 }).catch(() => undefined)
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(250)
  if (isMicrosoftFidoCreateUrl(page.url())) return null

  input = await findRecoveryEmailInput(page)
  if (input) return input
  if (!await chooseEmailMethod(page)) return null
  return await findRecoveryEmailInput(page)
}

async function fillVerificationCode(page: Page, rawCode: string): Promise<boolean> {
  const code = rawCode.trim()
  if (!/^[a-z0-9]{4,8}$/i.test(code)) return false

  let inputs = page.locator(
    'input[autocomplete="one-time-code"]:visible, input[name*="otc" i]:visible, input[name*="code" i]:visible, input[id*="code" i]:visible'
  )
  let count = await inputs.count()

  if (count === 0) {
    inputs = page.locator(
      'input:visible:not([type="email"]):not([type="password"]):not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([name="loginfmt"]):not([autocomplete="username"])'
    )
    count = await inputs.count()
  }

  if (count === 1) {
    await inputs.first().fill(code)
    return (await inputs.first().inputValue().catch(() => '')).trim() === code
  }

  if (count !== code.length) return false
  for (let index = 0; index < code.length; index += 1) {
    await inputs.nth(index).fill(code[index] ?? '')
  }
  const values: string[] = []
  for (let index = 0; index < code.length; index += 1) {
    values.push((await inputs.nth(index).inputValue().catch(() => '')).trim())
  }
  return values.join('') === code
}

async function confirmMailboxPresent(
  page: Page,
  targetMailbox: string,
  existingMailbox?: string | null
): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const body = await readBody(page)
    if (microsoftRecoveryMailboxEvidence(body, targetMailbox, existingMailbox)) return true
    await page.waitForTimeout(250)
  }

  if (!await navigateToManageHowISignIn(page)) return false
  const body = await readBody(page)
  return microsoftRecoveryMailboxEvidence(body, targetMailbox, existingMailbox)
}

export async function runAddMicrosoftRecoveryEmail(
  page: Page,
  input: MicrosoftRecoveryEmailActionInput
): Promise<MicrosoftRecoveryEmailActionResult> {
  const targetMailbox = normalizeMailboxAddress(input.recoveryEmail ?? '')
  if (!targetMailbox) {
    return { status: 'needs_attention', message: 'Thiếu Mail KP mới hợp lệ cho thao tác Thêm.' }
  }

  if (microsoftRecoveryMailboxEvidence(await readBody(page), targetMailbox, input.backupEmail)) {
    return { status: 'success', message: 'Mail KP mới đã có trong Microsoft Security.' }
  }

  const emailInput = await openAddRecoveryForm(page)
  if (!emailInput) {
    return {
      status: 'needs_attention',
      message: isMicrosoftFidoCreateUrl(page.url())
        ? 'Microsoft chuyển sang Passkey/FIDO thay vì Email; PAGE-AUTO dừng action Add Mail KP.'
        : 'Không tìm thấy Add a new way → Email a code trên Microsoft Security.'
    }
  }

  await emailInput.fill(targetMailbox)
  if (normalizeMailboxAddress(await emailInput.inputValue().catch(() => '')) !== targetMailbox) {
    return { status: 'needs_attention', message: 'Microsoft chưa nhận đúng Mail KP mới nên chưa gửi code.' }
  }

  const send = await firstVisible([
    page.getByRole('button', { name: /^(next|send code|continue|tiếp theo|gửi mã|tiếp tục)$/i }).last(),
    page.locator('input[type="submit"]:visible').last(),
    page.locator('button[type="submit"]:visible').last()
  ])
  if (!send || !await send.isEnabled().catch(() => true)) {
    return { status: 'needs_attention', message: 'Không tìm thấy nút Next/Send code cho Mail KP mới.' }
  }

  const challengeId = 'hotmail-add-recovery-' + input.accountId + '-' + Date.now()
  const router = createMailboxProviderRouter(page.context())
  const baseline = await router.prepareChallenge({
    accountId: input.accountId,
    mailbox: targetMailbox,
    role: 'recovery',
    purpose: 'microsoft_security',
    challengeId
  })
  if (baseline.status !== 'success' || baseline.providerId === null) {
    return { status: 'needs_attention', message: baseline.message }
  }

  const requestedAt = Date.now()
  try {
    await send.click({ timeout: 8_000 })
  } catch {
    return { status: 'needs_attention', message: 'Không click được nút gửi code Mail KP mới.' }
  }
  await page.waitForTimeout(250)

  const codeResult = await router.getFreshCode({
    accountId: input.accountId,
    mailbox: targetMailbox,
    role: 'recovery',
    purpose: 'microsoft_security',
    challengeId,
    notBefore: Math.max(1, requestedAt - 5_000),
    baselineMessageKeys: baseline.messageKeys,
    timeoutMs: ADD_RECOVERY_CODE_TIMEOUT_MS
  })
  if (codeResult.providerId !== null && codeResult.providerId !== baseline.providerId) {
    return { status: 'needs_attention', message: 'Mailbox Router đổi provider giữa cùng challenge Add Mail KP.' }
  }
  if (codeResult.status !== 'success' || !codeResult.code || !codeResult.messageKey) {
    return { status: 'needs_attention', message: codeResult.message }
  }

  const beforeCode = await readBody(page)
  if (codeRejected(beforeCode)) {
    return { status: 'needs_attention', message: 'Microsoft đang báo code Mail KP không hợp lệ.' }
  }
  if (!await fillVerificationCode(page, codeResult.code)) {
    return { status: 'needs_attention', message: 'Không nhập được code Mail KP mới vào đúng ô Microsoft.' }
  }

  const verify = await firstVisible([
    page.getByRole('button', { name: /^(next|verify|continue|tiếp theo|xác minh|tiếp tục)$/i }).last(),
    page.locator('input[type="submit"]:visible').last(),
    page.locator('button[type="submit"]:visible').last()
  ])
  if (!verify) {
    return { status: 'needs_attention', message: 'Không tìm thấy nút Next/Verify sau khi nhập code Mail KP mới.' }
  }

  try {
    await verify.click({ timeout: 8_000 })
  } catch {
    return { status: 'needs_attention', message: 'Không click được nút Verify Mail KP mới.' }
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.waitForTimeout(250)
    const body = await readBody(page)
    if (codeRejected(body)) {
      return { status: 'needs_attention', message: 'Microsoft từ chối code Mail KP mới; BackupEmail chưa cập nhật.' }
    }
    if (microsoftRecoveryMailboxEvidence(body, targetMailbox, input.backupEmail)) {
      return { status: 'success', message: 'Đã thêm và xác minh Mail KP mới trên Microsoft.' }
    }
    if (successCopy(body)) break
  }

  if (await confirmMailboxPresent(page, targetMailbox, input.backupEmail)) {
    return { status: 'success', message: 'Đã xác nhận Mail KP mới xuất hiện trong Microsoft Security profile.' }
  }

  return {
    status: 'needs_attention',
    message: 'Đã submit code nhưng chưa thấy Mail KP mới trong Microsoft Security profile; PAGE-AUTO chưa cập nhật BackupEmail.'
  }
}

export async function runRemoveMicrosoftRecoveryEmail(
  page: Page,
  input: MicrosoftRecoveryEmailActionInput
): Promise<MicrosoftRecoveryEmailActionResult> {
  const targetMailbox = normalizeMailboxAddress(input.recoveryEmail ?? input.backupEmail ?? '')
  if (!targetMailbox) {
    return { status: 'success', message: 'Account không có Mail KP cũ; bỏ qua thao tác xóa.' }
  }

  const body = await readBody(page)
  if (!microsoftRecoveryMailboxEvidence(body, targetMailbox)) {
    return { status: 'success', message: 'Mail KP cũ không còn trong Microsoft Security.' }
  }

  const identity = maskedIdentity(targetMailbox)
  const maskedPattern = identity?.prefix
    ? new RegExp(escapePattern(identity.prefix) + '\\*+@' + escapePattern(identity.domain), 'i')
    : null

  const targetNode = exactMailboxVisible(body, targetMailbox)
    ? page.getByText(targetMailbox, { exact: false }).first()
    : maskedPattern
      ? page.getByText(maskedPattern).first()
      : null

  if (!targetNode || !await targetNode.isVisible().catch(() => false)) {
    return { status: 'needs_attention', message: 'Nhận diện được Mail KP cũ nhưng không khóa được đúng dòng để xóa.' }
  }

  let container = targetNode.locator(
    'xpath=ancestor::*[self::li or self::tr or @role="row" or contains(translate(@class,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"proof") or contains(translate(@class,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"method")][1]'
  )
  if (await container.count() === 0) container = targetNode.locator('xpath=..')

  const remove = await firstVisible([
    container.getByRole('button', { name: /remove|delete|xóa|xoá/i }).first(),
    container.getByRole('link', { name: /remove|delete|xóa|xoá/i }).first(),
    container.getByText(/^(remove|delete|xóa|xoá)$/i).first()
  ])
  if (!remove) {
    return { status: 'needs_attention', message: 'Không tìm thấy Remove/Delete trong đúng dòng Mail KP cũ.' }
  }

  await remove.click({ timeout: 8_000 }).catch(() => undefined)
  await page.waitForTimeout(250)

  const confirm = await firstVisible([
    page.getByRole('button', { name: /^(remove|delete|yes|confirm|xóa|xoá|đồng ý|xác nhận)$/i }).last(),
    page.locator('button[type="submit"]:visible').last(),
    page.locator('input[type="submit"]:visible').last()
  ])
  if (confirm && await confirm.isVisible().catch(() => false)) {
    await confirm.click({ timeout: 8_000 }).catch(() => undefined)
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.waitForTimeout(250)
    if (!microsoftRecoveryMailboxEvidence(await readBody(page), targetMailbox)) {
      return { status: 'success', message: 'Đã xóa đúng Mail KP cũ khỏi Microsoft Security.' }
    }
  }

  if (await navigateToManageHowISignIn(page)) {
    if (!microsoftRecoveryMailboxEvidence(await readBody(page), targetMailbox)) {
      return { status: 'success', message: 'Đã xác nhận Mail KP cũ không còn trong Microsoft Security profile.' }
    }
  }

  return {
    status: 'needs_attention',
    message: 'Đã gửi lệnh xóa nhưng Mail KP cũ vẫn còn trong Microsoft Security; canonical chưa thay đổi.'
  }
}
