import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core'
import type { HotmailNeedsAttentionReason, HotmailRecoveryOperation } from '../../shared/hotmail'
import { friendlyEmailBrowserError, isEmailProfileInUseError } from './emailBrowserLifecycle'
import {
  classifyMicrosoftLoginSurface,
  microsoftAccountPickerEntryMatchesCanonicalEmail,
  type MicrosoftLoginSnapshot
} from './emailLoginPolicy'
import {
  adoptNewestMicrosoftFlowPage,
  closeMicrosoftOwnedOpenerChain,
  microsoftRouteLogLabel,
  waitForMicrosoftOwnedPage
} from './emailMicrosoftPageOwnership'

interface ProxyConfig {
  server: string
  username?: string
  password?: string
}

interface BrowserCommandBase {
  accountId: number
  profileDirectory: string
  executablePath?: string
  proxy?: ProxyConfig
  loginEmail?: string
  loginPassword?: string
}

interface OpenCommand extends BrowserCommandBase {
  type: 'open-mail'
}

interface RecoveryCommand extends BrowserCommandBase {
  type: 'recovery-action'
  operation: HotmailRecoveryOperation
  confirmCompleted: boolean
}

interface PasswordCommand extends BrowserCommandBase {
  type: 'password-action'
  confirmCompleted: boolean
  currentPassword?: string
  newPassword?: string
}

type WorkerCommand = OpenCommand | RecoveryCommand | PasswordCommand

interface OpenResult {
  type: 'open-result'
  accountId: number
  status: 'started' | 'already_open' | 'needs_attention' | 'profile_in_use' | 'error'
  needsAttentionReason?: HotmailNeedsAttentionReason
  attached: boolean
  proxyManagedExternally: boolean
  message: string
}

interface RecoveryResult {
  type: 'recovery-result'
  accountId: number
  operation: HotmailRecoveryOperation
  status: 'success' | 'needs_attention' | 'profile_in_use' | 'error'
  needsAttentionReason?: HotmailNeedsAttentionReason
  proxyManagedExternally: boolean
  message: string
}

interface PasswordResult {
  type: 'password-result'
  accountId: number
  status: 'success' | 'needs_attention' | 'profile_in_use' | 'error'
  needsAttentionReason?: HotmailNeedsAttentionReason
  proxyManagedExternally: boolean
  message: string
}

interface PasswordSnapshot {
  url: string
  text: string
  passwordInputCount: number
}

interface MicrosoftLoginAttempt {
  status: 'authenticated' | 'needs_attention'
  attempted: boolean
  reason?: HotmailNeedsAttentionReason
  message?: string
}

type PreparedMicrosoftPage =
  | { status: 'ready'; page: Page; autoLoginAttempted: boolean }
  | { status: 'needs_attention'; reason: HotmailNeedsAttentionReason; message: string }

function unwrapMessage(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function parseCommand(event: unknown): WorkerCommand | null {
  const payload = unwrapMessage(event)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<WorkerCommand>
  if (typeof candidate.accountId !== 'number' || typeof candidate.profileDirectory !== 'string') return null
  if (candidate.loginEmail !== undefined && typeof candidate.loginEmail !== 'string') return null
  if (candidate.loginPassword !== undefined && typeof candidate.loginPassword !== 'string') return null
  if (candidate.type === 'open-mail') return candidate as OpenCommand
  if (candidate.type === 'recovery-action' && (candidate.operation === 'add' || candidate.operation === 'remove' || candidate.operation === 'replace')) {
    return candidate as RecoveryCommand
  }
  if (candidate.type === 'password-action' && typeof candidate.confirmCompleted === 'boolean') {
    if (candidate.currentPassword !== undefined && typeof candidate.currentPassword !== 'string') return null
    if (candidate.newPassword !== undefined && typeof candidate.newPassword !== 'string') return null
    return candidate as PasswordCommand
  }
  return null
}

async function readCdpEndpoint(profileDirectory: string): Promise<string | null> {
  try {
    const [portText] = (await readFile(join(profileDirectory, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
    if (portText && /^\d+$/.test(portText)) return `http://127.0.0.1:${portText}`
  } catch {
    // Not a CDP-enabled running browser.
  }
  return null
}

async function probeCdpEndpoint(endpoint: string, timeoutMs = 650): Promise<boolean> {
  return await new Promise<boolean>((resolveProbe) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolveProbe(value)
    }
    try {
      const req = request(new URL('/json/version', endpoint), { method: 'GET', timeout: timeoutMs }, (response) => {
        response.resume()
        finish((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 500)
      })
      req.once('timeout', () => {
        req.destroy()
        finish(false)
      })
      req.once('error', () => finish(false))
      req.end()
    } catch {
      finish(false)
    }
  })
}

async function readLiveCdpEndpoint(profileDirectory: string): Promise<string | null> {
  const endpoint = await readCdpEndpoint(profileDirectory)
  return endpoint && await probeCdpEndpoint(endpoint) ? endpoint : null
}

function isMicrosoftOwnedNavigationUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'outlook.live.com'
      || hostname === 'login.live.com'
      || hostname === 'account.live.com'
      || hostname === 'login.microsoftonline.com'
      || hostname === 'microsoft.com'
      || hostname.endsWith('.microsoft.com')
  } catch {
    return false
  }
}

function isExpectedMicrosoftNavigationInterruption(error: unknown, currentUrl: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return isMicrosoftOwnedNavigationUrl(currentUrl)
    && /err_aborted|navigation.*interrupted|frame was detached|page\.goto:.*interrupted/i.test(message)
}

async function openOutlook(context: BrowserContext): Promise<Page> {
  const page = context.pages()[0] ?? await context.newPage()
  try {
    await page.goto('https://outlook.live.com/mail/0/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    })
  } catch (error) {
    if (!isExpectedMicrosoftNavigationInterruption(error, page.url())) throw error
    await waitForMicrosoftStep(page)
  }
  await page.bringToFront().catch(() => undefined)
  return page
}

async function launchProfile(command: BrowserCommandBase): Promise<BrowserContext> {
  if (!command.executablePath?.trim()) throw new Error('Browser executable not found')
  return await chromium.launchPersistentContext(command.profileDirectory, {
    headless: false,
    viewport: null,
    executablePath: command.executablePath,
    ...(command.proxy ? { proxy: command.proxy } : {})
  })
}

function manualReasonMessage(reason: HotmailNeedsAttentionReason): string {
  if (reason === 'needs_login') return 'Auto login Microsoft chưa hoàn tất trong đúng profile Email. PAGE-AUTO giữ phiên để anh xử lý thủ công.'
  if (reason === 'identity_review') return 'Microsoft đang yêu cầu xác minh danh tính. PAGE-AUTO dừng ở trạng thái cần xử lý thủ công.'
  if (reason === 'security_review') return 'Microsoft đang yêu cầu bước xác minh bảo mật/2FA. PAGE-AUTO không tự vượt bước này.'
  return 'Đã mở Microsoft Security bằng đúng profile Email. Hoàn tất thao tác trên browser rồi bấm Xác nhận hoàn tất.'
}

async function readMicrosoftLoginSnapshot(page: Page): Promise<MicrosoftLoginSnapshot | null> {
  try {
    const [
      text,
      emailInputCount,
      usernameInputCount,
      proofEmailInputCount,
      verificationCodeInputCount,
      passwordInputCount,
      useAnotherAccountControlCount,
      sendCodeControlCount,
      usePasswordControlCount
    ] = await Promise.all([
      page.locator('body').innerText({ timeout: 3_000 }),
      page.locator('input[name="loginfmt"]:visible, input[type="email"]:visible').count(),
      page.locator('input[name="loginfmt"]:visible, input[autocomplete="username"]:visible').count(),
      page.locator('input[type="email"]:visible:not([name="loginfmt"]):not([autocomplete="username"]), input[autocomplete="email"]:visible:not([name="loginfmt"]):not([autocomplete="username"]), input[name*="proof" i]:visible:not([name="loginfmt"]), input[id*="proof" i]:visible, input[name*="recovery" i]:visible, input[id*="recovery" i]:visible').count(),
      page.locator('input[autocomplete="one-time-code"]:visible, input[name*="otc" i]:visible, input[name*="code" i]:visible').count(),
      page.locator('input[type="password"]:visible').count(),
      page.getByText(/^(use another account|sign in with another account|sử dụng tài khoản khác|đăng nhập bằng tài khoản khác)$/i).count(),
      page.locator('button:visible, a:visible, [role="button"]:visible, [role="link"]:visible').filter({ hasText: /send\s+code|gửi\s+mã/i }).count(),
      page.locator('button:visible, a:visible, [role="button"]:visible, [role="link"]:visible').filter({ hasText: /use\s+your\s+password|sử dụng\s+mật khẩu|dùng\s+mật khẩu/i }).count()
    ])
    return {
      url: page.url(),
      text,
      emailInputCount,
      usernameInputCount,
      proofEmailInputCount,
      verificationCodeInputCount,
      passwordInputCount,
      useAnotherAccountControlCount,
      sendCodeControlCount,
      usePasswordControlCount
    }
  } catch {
    return null
  }
}

async function waitForMicrosoftStep(page: Page): Promise<void> {
  const previousUrl = page.url()
  await Promise.race([
    page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 4_000 }).catch(() => undefined),
    page.waitForTimeout(900)
  ])
  await Promise.race([
    page.waitForLoadState('domcontentloaded', { timeout: 2_500 }).catch(() => undefined),
    page.waitForTimeout(900)
  ])
  await page.waitForTimeout(150)
}

async function clickMicrosoftLoginSubmit(page: Page): Promise<boolean> {
  const submit = await firstVisible([
    page.locator('#idSIButton9:visible').first(),
    page.getByRole('button', { name: /next|sign in|continue|tiếp theo|đăng nhập|tiếp tục/i }).last(),
    page.locator('input[type="submit"]:visible').last(),
    page.locator('button[type="submit"]:visible').last()
  ])
  if (!submit) return false
  await submit.click()
  await waitForMicrosoftStep(page)
  return true
}

async function clickStaySignedIn(page: Page): Promise<boolean> {
  const submit = await firstVisible([
    page.locator('#idSIButton9:visible').first(),
    page.getByRole('button', { name: /yes|continue|có|tiếp tục/i }).last(),
    page.locator('input[type="submit"]:visible').last()
  ])
  if (!submit) return false
  await submit.click()
  await waitForMicrosoftStep(page)
  return true
}

async function clickUseYourPassword(page: Page): Promise<boolean> {
  const control = await firstVisible([
    page.locator('button:visible, a:visible, [role="button"]:visible, [role="link"]:visible').filter({ hasText: /use\s+your\s+password|sử dụng\s+mật khẩu|dùng\s+mật khẩu/i }).first(),
    page.getByRole('link', { name: /use\s+your\s+password|sử dụng\s+mật khẩu|dùng\s+mật khẩu/i }).first(),
    page.getByRole('button', { name: /use\s+your\s+password|sử dụng\s+mật khẩu|dùng\s+mật khẩu/i }).first(),
    page.getByText(/use\s+your\s+password|sử dụng\s+mật khẩu|dùng\s+mật khẩu/i).first()
  ])
  if (!control) return false
  try {
    await control.click({ timeout: 8_000 })
  } catch (error) {
    if (!isExpectedMicrosoftNavigationInterruption(error, page.url())) throw error
  }
  await waitForMicrosoftStep(page)
  return true
}

async function continueFromOutlookLanding(page: Page): Promise<Page | null> {
  const link = await firstVisible([
    page.locator('a[href*="go.microsoft.com"]:visible').filter({ hasText: /sign in|open outlook|continue to sign in/i }).first(),
    page.locator('a[href*="outlook.live.com"]:visible').filter({ hasText: /sign in|open outlook|continue to sign in/i }).first(),
    page.getByRole('link', { name: /sign in|open outlook|continue to sign in/i }).first(),
    page.getByRole('button', { name: /sign in|open outlook|continue to sign in/i }).first()
  ])
  if (!link) return null

  const beforeUrl = page.url()
  const href = await link.getAttribute('href').catch(() => null)
  const popupPromise = page.waitForEvent('popup', { timeout: 2_500 }).catch(() => null)

  try {
    await link.click({ timeout: 8_000 })
  } catch (error) {
    if (!isExpectedMicrosoftNavigationInterruption(error, page.url())) throw error
  }

  const popup = await popupPromise
  if (popup) {
    const popupIsMicrosoftOwned = await waitForMicrosoftOwnedPage(popup, 8_000)
    await waitForMicrosoftStep(page)

    const sourceContinuedMicrosoftFlow = !page.isClosed()
      && page.url() !== beforeUrl
      && isMicrosoftOwnedNavigationUrl(page.url())

    if (sourceContinuedMicrosoftFlow) {
      if (!popup.isClosed()) await popup.close({ runBeforeUnload: false }).catch(() => undefined)
      await page.bringToFront().catch(() => undefined)
      return page
    }

    if (popupIsMicrosoftOwned) {
      await closeMicrosoftOwnedOpenerChain(popup)
      await popup.bringToFront().catch(() => undefined)
      return popup
    }

    if (!popup.isClosed() && (popup.url() === 'about:blank' || popup.url().startsWith('chrome-error://'))) {
      await popup.close({ runBeforeUnload: false }).catch(() => undefined)
    }
    await page.bringToFront().catch(() => undefined)
    return page
  }

  await waitForMicrosoftStep(page)

  if (page.url() === beforeUrl && href && !href.toLowerCase().startsWith('javascript:')) {
    try {
      const target = new URL(href, beforeUrl).toString()
      if (isMicrosoftOwnedNavigationUrl(target)) {
        try {
          await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        } catch (error) {
          if (!isExpectedMicrosoftNavigationInterruption(error, page.url())) throw error
          await waitForMicrosoftStep(page)
        }
      }
    } catch {
      // The visible CTA is authoritative; malformed/non-Microsoft hrefs are ignored safely.
    }
  }

  await page.bringToFront().catch(() => undefined)
  return page
}

async function findCanonicalMicrosoftAccountPickerEntry(page: Page, canonicalEmail: string): Promise<Locator | null> {
  const email = canonicalEmail.trim()
  if (!email) return null

  const candidates = page.locator(
    'button:visible, a:visible, [role="button"]:visible, [role="link"]:visible, [tabindex="0"]:visible, [data-test-id]:visible, [data-testid]:visible'
  )
  const count = Math.min(await candidates.count(), 80)
  let bestMatch: Locator | null = null
  let bestTextLength = Number.POSITIVE_INFINITY

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index)
    const text = await candidate.innerText({ timeout: 800 }).catch(() => '')
    if (!microsoftAccountPickerEntryMatchesCanonicalEmail(text, email)) continue
    if (!await candidate.isVisible().catch(() => false)) continue

    const textLength = text.replace(/\s+/g, ' ').trim().length
    if (textLength < bestTextLength) {
      bestMatch = candidate
      bestTextLength = textLength
    }
  }

  if (bestMatch) return bestMatch

  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return await firstVisible([
    page.getByText(new RegExp(`^\\s*${escapedEmail}\\s*$`, 'i')).first()
  ])
}

async function continueFromMicrosoftOAuthAuthorize(page: Page, canonicalEmail: string): Promise<boolean> {
  const canonicalAccount = await findCanonicalMicrosoftAccountPickerEntry(page, canonicalEmail)
  if (canonicalAccount) {
    try {
      await canonicalAccount.click({ timeout: 8_000 })
    } catch (error) {
      if (!isExpectedMicrosoftNavigationInterruption(error, page.url())) throw error
    }
    await waitForMicrosoftStep(page)
    return true
  }

  const anotherAccount = await firstVisible([
    page.getByRole('button', { name: /^(use another account|sign in with another account|sử dụng tài khoản khác|đăng nhập bằng tài khoản khác)$/i }).first(),
    page.getByRole('link', { name: /^(use another account|sign in with another account|sử dụng tài khoản khác|đăng nhập bằng tài khoản khác)$/i }).first(),
    page.getByText(/^(use another account|sign in with another account|sử dụng tài khoản khác|đăng nhập bằng tài khoản khác)$/i).first()
  ])
  if (!anotherAccount) return false
  await anotherAccount.click()
  await waitForMicrosoftStep(page)
  return true
}

function loginNeedsAttention(reason: HotmailNeedsAttentionReason, attempted: boolean, message?: string): MicrosoftLoginAttempt {
  return {
    status: 'needs_attention',
    attempted,
    reason,
    message: message ?? manualReasonMessage(reason)
  }
}

async function autoLoginMicrosoft(
  page: Page,
  command: BrowserCommandBase,
  allowPasswordChangeSurface = false
): Promise<MicrosoftLoginAttempt> {
  const pagesAtFlowStart = new Set(page.context().pages())
  let attempted = false
  let unreadableSteps = 0
  let usernameSubmitAttempts = 0
  for (let step = 0; step < 16; step += 1) {
    const previousPage = page
    const previousRoute = microsoftRouteLogLabel(previousPage.url())
    page = await adoptNewestMicrosoftFlowPage(page, pagesAtFlowStart)
    if (page !== previousPage) {
      console.info(
        `[PAGE-AUTO email auth] adopt-page ${previousRoute} -> ${microsoftRouteLogLabel(page.url())}; pages=${page.context().pages().length}`
      )
    }

    const snapshot = await readMicrosoftLoginSnapshot(page)
    if (!snapshot) {
      unreadableSteps += 1
      if (unreadableSteps < 3) {
        await waitForMicrosoftStep(page)
        continue
      }
      await closeMicrosoftOwnedOpenerChain(page)
      return loginNeedsAttention(
        'security_review',
        attempted,
        'Không đọc được trạng thái đăng nhập Microsoft sau nhiều lần chờ; PAGE-AUTO dừng an toàn và giữ nguyên profile Email.'
      )
    }
    unreadableSteps = 0

    const surface = classifyMicrosoftLoginSurface(snapshot)
    console.info(
      `[PAGE-AUTO email auth] step=${step} route=${microsoftRouteLogLabel(snapshot.url)} state=${surface} pages=${page.context().pages().length}`
    )

    if (surface === 'authenticated') {
      await closeMicrosoftOwnedOpenerChain(page)
      return { status: 'authenticated', attempted }
    }
    if (surface === 'password_change') {
      if (allowPasswordChangeSurface) return { status: 'authenticated', attempted }
      await closeMicrosoftOwnedOpenerChain(page)
      return loginNeedsAttention(
        'needs_login',
        attempted,
        'Microsoft yêu cầu đổi Password trước khi tiếp tục. PAGE-AUTO không tự xử lý bước đổi Password ngoài action Password được chọn.'
      )
    }
    if (surface === 'identity_review') {
      await closeMicrosoftOwnedOpenerChain(page)
      return loginNeedsAttention('identity_review', attempted)
    }
    if (surface === 'security_review') {
      await closeMicrosoftOwnedOpenerChain(page)
      return loginNeedsAttention('security_review', attempted)
    }
    if (surface === 'credential_error') {
      await closeMicrosoftOwnedOpenerChain(page)
      return loginNeedsAttention(
        'needs_login',
        attempted,
        'Microsoft không chấp nhận Email/PassEmail canonical hiện tại. PAGE-AUTO không thử credential khác và giữ phiên để xử lý thủ công.'
      )
    }

    if (surface === 'outlook_landing') {
      const nextPage = await continueFromOutlookLanding(page)
      if (!nextPage) {
        await waitForMicrosoftStep(page)
        continue
      }
      page = nextPage
      attempted = true
      continue
    }

    if (surface === 'outlook_transition' || surface === 'login_transition') {
      await waitForMicrosoftStep(page)
      continue
    }

    if (surface === 'oauth_authorize' || surface === 'account_picker') {
      if (!await continueFromMicrosoftOAuthAuthorize(page, command.loginEmail?.trim() ?? '')) {
        await waitForMicrosoftStep(page)
        continue
      }
      attempted = true
      continue
    }

    if (surface === 'password_method_choice') {
      if (!await clickUseYourPassword(page)) {
        await waitForMicrosoftStep(page)
        continue
      }
      attempted = true
      continue
    }

    if (surface === 'stay_signed_in') {
      if (!await clickStaySignedIn(page)) {
        await waitForMicrosoftStep(page)
        continue
      }
      attempted = true
      continue
    }

    const loginEmail = command.loginEmail?.trim() ?? ''
    const loginPassword = command.loginPassword ?? ''
    if (!loginEmail || !loginPassword) {
      await closeMicrosoftOwnedOpenerChain(page)
      return loginNeedsAttention(
        'needs_login',
        attempted,
        'Account thiếu Email hoặc PassEmail canonical để auto login Microsoft. PAGE-AUTO giữ profile mở để đăng nhập thủ công.'
      )
    }

    if (surface === 'username') {
      if (usernameSubmitAttempts >= 2) {
        await closeMicrosoftOwnedOpenerChain(page)
        return loginNeedsAttention(
          'needs_login',
          attempted,
          'Microsoft vẫn từ chối Email canonical sau khi PAGE-AUTO đã xác nhận field chứa đúng giá trị và thử lại có giới hạn. PAGE-AUTO giữ phiên để kiểm tra dữ liệu Email.'
        )
      }
      const username = await firstVisible([
        page.locator('input[name="loginfmt"]:visible').first(),
        page.locator('input[autocomplete="username"]:visible').first()
      ])
      if (!username) {
        await waitForMicrosoftStep(page)
        continue
      }
      await username.fill(loginEmail)
      const filledEmail = (await username.inputValue().catch(() => '')).trim()
      if (filledEmail !== loginEmail) {
        await closeMicrosoftOwnedOpenerChain(page)
        return loginNeedsAttention(
          'needs_login',
          attempted,
          'PAGE-AUTO không xác nhận được field Microsoft đã nhận đúng Email canonical nên không bấm Next.'
        )
      }
      usernameSubmitAttempts += 1
      if (!await clickMicrosoftLoginSubmit(page)) {
        await waitForMicrosoftStep(page)
        continue
      }
      attempted = true
      continue
    }

    if (surface === 'password') {
      const password = await firstVisible([
        page.locator('input[name="passwd"][type="password"]:visible').first(),
        page.locator('input[type="password"]:visible').first(),
        page.getByLabel(/password|mật khẩu/i).first()
      ])
      if (!password) {
        await waitForMicrosoftStep(page)
        continue
      }
      await password.fill(loginPassword)
      if (!await clickMicrosoftLoginSubmit(page)) {
        await waitForMicrosoftStep(page)
        continue
      }
      attempted = true
      continue
    }

    await closeMicrosoftOwnedOpenerChain(page)
    return loginNeedsAttention(
      'needs_login',
      attempted,
      'Microsoft đang dùng một bước đăng nhập khác flow Email + PassEmail được hỗ trợ. PAGE-AUTO dừng để xử lý thủ công.'
    )
  }

  await closeMicrosoftOwnedOpenerChain(page)
  return loginNeedsAttention(
    'needs_login',
    attempted,
    'Auto login Microsoft chưa đi tới trạng thái xác nhận an toàn sau các bước được hỗ trợ. PAGE-AUTO không tiếp tục tự động.'
  )
}

async function prepareAuthenticatedPage(
  context: BrowserContext,
  command: BrowserCommandBase,
  openTarget: (context: BrowserContext) => Promise<Page>,
  allowPasswordChangeSurface = false,
  reopenTargetAfterLogin = true
): Promise<PreparedMicrosoftPage> {
  let page = await openTarget(context)
  let login = await autoLoginMicrosoft(page, command, allowPasswordChangeSurface)
  if (login.status === 'needs_attention') {
    return { status: 'needs_attention', reason: login.reason!, message: login.message! }
  }

  let autoLoginAttempted = login.attempted
  if (login.attempted && reopenTargetAfterLogin) {
    page = await openTarget(context)
    login = await autoLoginMicrosoft(page, command, allowPasswordChangeSurface)
    autoLoginAttempted = autoLoginAttempted || login.attempted
    if (login.status === 'needs_attention') {
      return { status: 'needs_attention', reason: login.reason!, message: login.message! }
    }
  }

  return { status: 'ready', page, autoLoginAttempted }
}

async function detectAttention(page: Page): Promise<HotmailNeedsAttentionReason | null> {
  const snapshot = await readMicrosoftLoginSnapshot(page)
  if (!snapshot) return 'security_review'
  const surface = classifyMicrosoftLoginSurface(snapshot)
  if (surface === 'identity_review') return 'identity_review'
  if (surface === 'security_review') return 'security_review'
  if (surface === 'username' || surface === 'password_method_choice' || surface === 'password' || surface === 'password_change' || surface === 'credential_error' || surface === 'manual_login' || surface === 'stay_signed_in' || surface === 'outlook_landing' || surface === 'outlook_transition' || surface === 'login_transition' || surface === 'oauth_authorize' || surface === 'account_picker') {
    return 'needs_login'
  }
  return null
}

function recoveryInstruction(operation: HotmailRecoveryOperation): string {
  if (operation === 'add') return 'thêm Email khôi phục'
  if (operation === 'remove') return 'xóa Email khôi phục'
  return 'thay Email khôi phục'
}

async function openRecoverySecurityPage(context: BrowserContext): Promise<Page> {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto('https://account.live.com/proofs/manage/additional', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  })
  await page.bringToFront().catch(() => undefined)
  return page
}

async function runRecoveryAction(context: BrowserContext, command: RecoveryCommand, proxyManagedExternally: boolean): Promise<RecoveryResult> {
  let page: Page
  if (command.confirmCompleted) {
    page = context.pages()[0] ?? await context.newPage()
  } else {
    const prepared = await prepareAuthenticatedPage(context, command, openRecoverySecurityPage)
    if (prepared.status === 'needs_attention') {
      return {
        type: 'recovery-result',
        accountId: command.accountId,
        operation: command.operation,
        status: 'needs_attention',
        needsAttentionReason: prepared.reason,
        proxyManagedExternally,
        message: prepared.message
      }
    }
    page = prepared.page
  }
  await page.bringToFront().catch(() => undefined)

  const attention = await detectAttention(page)
  if (attention) {
    return {
      type: 'recovery-result',
      accountId: command.accountId,
      operation: command.operation,
      status: 'needs_attention',
      needsAttentionReason: attention,
      proxyManagedExternally,
      message: manualReasonMessage(attention)
    }
  }

  if (!command.confirmCompleted) {
    return {
      type: 'recovery-result',
      accountId: command.accountId,
      operation: command.operation,
      status: 'needs_attention',
      needsAttentionReason: 'manual_completion_required',
      proxyManagedExternally,
      message: `${manualReasonMessage('manual_completion_required')} Nghiệp vụ: ${recoveryInstruction(command.operation)}.`
    }
  }

  const url = page.url().toLowerCase()
  if (!url.includes('account.live.com')) {
    return {
      type: 'recovery-result',
      accountId: command.accountId,
      operation: command.operation,
      status: 'needs_attention',
      needsAttentionReason: 'manual_completion_required',
      proxyManagedExternally,
      message: 'Phiên Email chưa quay lại trang Microsoft Security; chưa cập nhật dữ liệu account.'
    }
  }

  return {
    type: 'recovery-result',
    accountId: command.accountId,
    operation: command.operation,
    status: 'success',
    proxyManagedExternally,
    message: 'Đã xác nhận thao tác Microsoft Security hoàn tất trong cùng phiên Email.'
  }
}

async function readPasswordSnapshot(page: Page): Promise<PasswordSnapshot | null> {
  try {
    const [text, passwordInputCount] = await Promise.all([
      page.locator('body').innerText({ timeout: 3_000 }),
      page.locator('input[type="password"]:visible').count()
    ])
    return {
      url: page.url().toLowerCase(),
      text: text.toLowerCase(),
      passwordInputCount
    }
  } catch {
    return null
  }
}

function isPasswordChangeSurface(snapshot: PasswordSnapshot): boolean {
  return /account\.live\.com\/(client\/)?password\/change/.test(snapshot.url)
    || /change your password|change password|new password|reenter password|password expired|update your password|đổi mật khẩu|mật khẩu mới|nhập lại mật khẩu|mật khẩu.*hết hạn/.test(snapshot.text)
}

function passwordAttention(snapshot: PasswordSnapshot): HotmailNeedsAttentionReason | null {
  if (/verify your identity|confirm your identity|identity verification|xác minh danh tính/.test(snapshot.text)) return 'identity_review'
  if (/enter.*code|security code|verification code|two[- ]step|two[- ]factor|approve.*sign.?in|authenticator|help us protect|verify your email|send code|already received a code|use your password|xác minh bảo mật|xác minh email|mã bảo mật|trình xác thực|phê duyệt.*đăng nhập/.test(snapshot.text)) return 'security_review'
  if ((/login\.live\.com|login\.microsoftonline\.com|signin|oauth20_authorize/.test(snapshot.url) || /sign in|đăng nhập/.test(snapshot.text)) && !isPasswordChangeSurface(snapshot)) {
    return 'needs_login'
  }
  return null
}

function passwordSucceeded(snapshot: PasswordSnapshot): boolean {
  if (/successfully changed your password|password (?:has been|was) changed|đã (?:đổi|thay đổi) mật khẩu/.test(snapshot.text)) return true
  return snapshot.url.includes('account.live.com')
    && !isPasswordChangeSurface(snapshot)
    && snapshot.passwordInputCount === 0
}

function passwordFailed(snapshot: PasswordSnapshot): boolean {
  return /couldn.?t change your password|could not change your password|current password.*incorrect|incorrect current password|password.*doesn.?t meet|password.*cannot|password.*can.?t|không thể đổi mật khẩu|mật khẩu hiện tại.*không đúng|mật khẩu.*không đáp ứng/.test(snapshot.text)
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function fillPasswordForm(page: Page, command: PasswordCommand): Promise<'submitted' | 'manual'> {
  const newPassword = command.newPassword
  if (!newPassword) return 'manual'

  const passwordInputs = page.locator('input[type="password"]:visible')
  const count = await passwordInputs.count()
  if (count < 2) return 'manual'

  const current = await firstVisible([
    page.getByLabel(/current password|mật khẩu hiện tại/i).first(),
    page.locator('input[name*="old" i][type="password"]:visible').first(),
    page.locator('input[name*="current" i][type="password"]:visible').first()
  ])
  const next = await firstVisible([
    page.getByLabel(/^new password$|mật khẩu mới/i).first(),
    page.locator('input[name*="new" i][type="password"]:visible').first()
  ])
  const confirm = await firstVisible([
    page.getByLabel(/reenter password|re-enter password|confirm password|nhập lại mật khẩu|xác nhận mật khẩu/i).first(),
    page.locator('input[name*="confirm" i][type="password"]:visible').first(),
    page.locator('input[name*="reenter" i][type="password"]:visible').first()
  ])

  const currentInput = current ?? (count >= 3 ? passwordInputs.nth(0) : null)
  const newInput = next ?? (count >= 3 ? passwordInputs.nth(1) : passwordInputs.nth(0))
  const confirmInput = confirm ?? (count >= 3 ? passwordInputs.nth(2) : passwordInputs.nth(1))

  if (currentInput) {
    if (!command.currentPassword) return 'manual'
    await currentInput.fill(command.currentPassword)
  }
  await newInput.fill(newPassword)
  if (confirmInput && await confirmInput.isVisible().catch(() => false)) await confirmInput.fill(newPassword)

  let submit = await firstVisible([
    page.getByRole('button', { name: /save|next|change password|đổi mật khẩu|lưu|tiếp theo/i }).last(),
    page.locator('input[type="submit"]:visible').last()
  ])
  if (!submit) submit = await firstVisible([page.locator('button[type="submit"]:visible').last()])
  if (!submit) return 'manual'

  await submit.click()
  await page.waitForTimeout(1_500)
  return 'submitted'
}

async function openPasswordPage(context: BrowserContext): Promise<Page> {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto('https://account.live.com/password/Change', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  })
  await page.bringToFront().catch(() => undefined)
  return page
}

function passwordNeedsAttention(command: PasswordCommand, reason: HotmailNeedsAttentionReason, proxyManagedExternally: boolean, message?: string): PasswordResult {
  return {
    type: 'password-result',
    accountId: command.accountId,
    status: 'needs_attention',
    needsAttentionReason: reason,
    proxyManagedExternally,
    message: message ?? manualReasonMessage(reason)
  }
}

async function runPasswordAction(context: BrowserContext, command: PasswordCommand, proxyManagedExternally: boolean): Promise<PasswordResult> {
  let page: Page
  if (command.confirmCompleted) {
    page = context.pages()[0] ?? await context.newPage()
  } else {
    const prepared = await prepareAuthenticatedPage(context, command, openPasswordPage, true)
    if (prepared.status === 'needs_attention') {
      return passwordNeedsAttention(command, prepared.reason, proxyManagedExternally, prepared.message)
    }
    page = prepared.page
  }
  await page.bringToFront().catch(() => undefined)

  let snapshot = await readPasswordSnapshot(page)
  if (!snapshot) return passwordNeedsAttention(command, 'security_review', proxyManagedExternally, 'Không đọc được trạng thái trang Microsoft Password; PAGE-AUTO dừng an toàn và chưa cập nhật PassEmail.')

  const attention = passwordAttention(snapshot)
  if (attention) return passwordNeedsAttention(command, attention, proxyManagedExternally)

  if (command.confirmCompleted) {
    if (passwordSucceeded(snapshot)) {
      return {
        type: 'password-result',
        accountId: command.accountId,
        status: 'success',
        proxyManagedExternally,
        message: 'Đã xác nhận flow đổi Password Microsoft hoàn tất trong cùng phiên Email.'
      }
    }
    return passwordNeedsAttention(
      command,
      'manual_completion_required',
      proxyManagedExternally,
      'Trang Microsoft vẫn chưa ở trạng thái xác nhận đổi Password hoàn tất; PassEmail chưa được cập nhật.'
    )
  }

  if (!isPasswordChangeSurface(snapshot)) {
    return passwordNeedsAttention(
      command,
      'manual_completion_required',
      proxyManagedExternally,
      'Đã mở Microsoft Password nhưng surface hiện tại không khớp form đổi mật khẩu được hỗ trợ. PAGE-AUTO giữ phiên để anh xử lý thủ công.'
    )
  }

  const submitted = await fillPasswordForm(page, command)
  if (submitted === 'manual') {
    return passwordNeedsAttention(
      command,
      'manual_completion_required',
      proxyManagedExternally,
      'Microsoft đang dùng form đổi Password khác hoặc thiếu Password Email hiện tại. PAGE-AUTO giữ phiên, không tự đoán field.'
    )
  }

  snapshot = await readPasswordSnapshot(page)
  if (!snapshot) return passwordNeedsAttention(command, 'security_review', proxyManagedExternally, 'Không đọc được kết quả sau khi gửi form Password; PAGE-AUTO dừng an toàn và chưa cập nhật PassEmail.')

  const afterAttention = passwordAttention(snapshot)
  if (afterAttention) return passwordNeedsAttention(command, afterAttention, proxyManagedExternally)
  if (passwordSucceeded(snapshot)) {
    return {
      type: 'password-result',
      accountId: command.accountId,
      status: 'success',
      proxyManagedExternally,
      message: 'Microsoft xác nhận đổi Password thành công.'
    }
  }
  if (passwordFailed(snapshot)) {
    return {
      type: 'password-result',
      accountId: command.accountId,
      status: 'error',
      proxyManagedExternally,
      message: 'Microsoft từ chối đổi Password. PassEmail chưa được cập nhật.'
    }
  }
  return passwordNeedsAttention(
    command,
    'manual_completion_required',
    proxyManagedExternally,
    'Đã gửi form Password nhưng kết quả Microsoft chưa đủ rõ để coi là thành công. PAGE-AUTO giữ phiên để anh kiểm tra.'
  )
}

async function run(): Promise<void> {
  let launchedContext: BrowserContext | null = null
  let attachedBrowser: Browser | null = null
  let attachedExternally = false
  let closing = false

  const resolveContext = async (command: BrowserCommandBase): Promise<{ context: BrowserContext; proxyManagedExternally: boolean } | OpenResult> => {
    if (launchedContext) return { context: launchedContext, proxyManagedExternally: false }
    if (attachedBrowser) {
      const context = attachedBrowser.contexts()[0]
      if (!context) throw new Error('Browser CDP đang chạy nhưng không có context khả dụng.')
      return { context, proxyManagedExternally: true }
    }

    const endpoint = await readLiveCdpEndpoint(command.profileDirectory)
    if (endpoint) {
      try {
        attachedBrowser = await chromium.connectOverCDP(endpoint)
        const context = attachedBrowser.contexts()[0]
        if (!context) throw new Error('Không tìm thấy browser context qua CDP.')
        attachedExternally = true
        return { context, proxyManagedExternally: true }
      } catch {
        attachedBrowser = null
        attachedExternally = false
      }
    }

    try {
      launchedContext = await launchProfile(command)
      launchedContext.once('close', () => {
        launchedContext = null
        if (!closing) {
          closing = true
          setTimeout(() => process.exit(0), 25)
        }
      })
      return { context: launchedContext, proxyManagedExternally: false }
    } catch (error) {
      if (isEmailProfileInUseError(error)) {
        return {
          type: 'open-result',
          accountId: command.accountId,
          status: 'profile_in_use',
          attached: false,
          proxyManagedExternally: true,
          message: friendlyEmailBrowserError(error)
        }
      }
      throw error
    }
  }

  process.parentPort?.on('message', (event) => {
    const command = parseCommand(event)
    if (!command || closing) return

    void (async () => {
      try {
        const resolved = await resolveContext(command)
        if ('type' in resolved) {
          if (command.type === 'open-mail') {
            process.parentPort?.postMessage(resolved)
          } else if (command.type === 'password-action') {
            const result: PasswordResult = {
              type: 'password-result',
              accountId: command.accountId,
              status: 'profile_in_use',
              proxyManagedExternally: true,
              message: resolved.message
            }
            process.parentPort?.postMessage(result)
          } else {
            const result: RecoveryResult = {
              type: 'recovery-result',
              accountId: command.accountId,
              operation: command.operation,
              status: 'profile_in_use',
              proxyManagedExternally: true,
              message: resolved.message
            }
            process.parentPort?.postMessage(result)
          }
          return
        }

        if (command.type === 'open-mail') {
          const prepared = await prepareAuthenticatedPage(
            resolved.context,
            command,
            openOutlook,
            false,
            false
          )
          if (prepared.status === 'needs_attention') {
            const result: OpenResult = {
              type: 'open-result',
              accountId: command.accountId,
              status: 'needs_attention',
              needsAttentionReason: prepared.reason,
              attached: resolved.proxyManagedExternally,
              proxyManagedExternally: resolved.proxyManagedExternally,
              message: prepared.message
            }
            process.parentPort?.postMessage(result)
            return
          }

          const result: OpenResult = {
            type: 'open-result',
            accountId: command.accountId,
            status: launchedContext ? 'started' : 'already_open',
            attached: resolved.proxyManagedExternally,
            proxyManagedExternally: resolved.proxyManagedExternally,
            message: prepared.autoLoginAttempted
              ? 'Đã auto login Microsoft bằng Email + PassEmail canonical và giữ session trong đúng profile Email theo UID.'
              : resolved.proxyManagedExternally
                ? 'Đã attach browser Email đang chạy; session Microsoft hiện tại đã sẵn sàng.'
                : 'Đã mở trực tiếp profile Email theo UID; session Microsoft hiện tại đã sẵn sàng.'
          }
          process.parentPort?.postMessage(result)
          return
        }

        if (command.type === 'password-action') {
          const result = await runPasswordAction(resolved.context, command, resolved.proxyManagedExternally || attachedExternally)
          process.parentPort?.postMessage(result)
          return
        }

        const result = await runRecoveryAction(resolved.context, command, resolved.proxyManagedExternally || attachedExternally)
        process.parentPort?.postMessage(result)
      } catch (error) {
        if (command.type === 'open-mail') {
          const attachedLive = attachedBrowser?.isConnected() ?? false
          const browserStillOpen = launchedContext !== null || attachedLive
          const result: OpenResult = {
            type: 'open-result',
            accountId: command.accountId,
            status: browserStillOpen ? 'needs_attention' : 'error',
            ...(browserStillOpen ? { needsAttentionReason: 'needs_login' as const } : {}),
            attached: attachedLive,
            proxyManagedExternally: attachedExternally,
            message: browserStillOpen
              ? 'Browser Email đã mở nhưng Microsoft navigation/login chưa hoàn tất ổn định. PAGE-AUTO giữ nguyên profile mở thay vì đóng Chrome.'
              : friendlyEmailBrowserError(error)
          }
          process.parentPort?.postMessage(result)
        } else if (command.type === 'password-action') {
          const result: PasswordResult = {
            type: 'password-result',
            accountId: command.accountId,
            status: 'error',
            proxyManagedExternally: false,
            message: 'Thao tác đổi Password Email chưa hoàn tất trong browser Email.'
          }
          process.parentPort?.postMessage(result)
        } else {
          const result: RecoveryResult = {
            type: 'recovery-result',
            accountId: command.accountId,
            operation: command.operation,
            status: 'error',
            proxyManagedExternally: false,
            message: 'Thao tác Mail khôi phục chưa hoàn tất trong browser Email.'
          }
          process.parentPort?.postMessage(result)
        }
      }
    })()
  })
}

void run().catch((error) => {
  console.error('[PAGE-AUTO email browser worker]', friendlyEmailBrowserError(error))
  process.exitCode = 1
})
