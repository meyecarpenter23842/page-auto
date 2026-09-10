import type { Locator, Page } from 'playwright-core'
import type { HotmailNeedsAttentionReason } from '../../shared/hotmail'
import type { EmailAuthV2HandlerResult, EmailAuthV2Surface } from './emailAuthV2Contracts'
import {
  adoptNewestMicrosoftFlowPage,
  closeMicrosoftOwnedOpenerChain,
  isMicrosoftOwnedNavigationUrl,
  microsoftRouteLogLabel,
  waitForMicrosoftOwnedPage
} from './emailMicrosoftPageOwnership'
import { configureMailboxProviderBrowser } from './mailboxProviderBrowserRuntime'
import {
  createPlaywrightMicrosoftCommonAuthUi,
  MicrosoftCommonAuthHandlers
} from './microsoftCommonAuthHandlers'
import {
  runMicrosoftAuthDispatchLoop,
  type MicrosoftAuthHandlerMap
} from './microsoftAuthDispatcher'
import { handleMicrosoftRecoveryChallenge } from './microsoftRecoveryChallenge'
import {
  detectMicrosoftSurface,
  type MicrosoftSurfaceDetection
} from './microsoftSurfaceDetector'

export type MicrosoftRecoveryV2Surface =
  | 'recovery_method_choice'
  | 'recovery_email_confirmation'
  | 'recovery_code'

const RECOVERY_CODE_SETTLE_PROBES = 4
const RECOVERY_CODE_SETTLE_INTERVAL_MS = 500

export interface MicrosoftAuthV2WorkerCredentials {
  accountId: number
  profileDirectory: string
  executablePath?: string
  proxy?: {
    server: string
    username?: string
    password?: string
  }
  loginEmail?: string
  loginPassword?: string
  backupEmail?: string
}

export interface MicrosoftAuthV2WorkerResult {
  status: 'authenticated' | 'target_ready' | 'needs_attention'
  attempted: boolean
  reason?: HotmailNeedsAttentionReason
  message?: string
}

export interface MicrosoftAuthV2WorkerOptions {
  allowPasswordChangeSurface?: boolean
  maxSteps?: number
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

function expectedMicrosoftNavigationInterruption(error: unknown, currentUrl: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return isMicrosoftOwnedNavigationUrl(currentUrl)
    && /err_aborted|navigation.*interrupted|frame was detached|page\.goto:.*interrupted/i.test(message)
}

export async function waitForMicrosoftAuthStep(page: Page): Promise<void> {
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

/**
 * Inboxes/ad pages can be created while a recovery handler is reading code.
 * Creating a new Chromium tab steals foreground even when Playwright then works
 * with that provider tab in the background. Keep the Microsoft operator page in
 * front without closing/navigating the provider page or changing its ownership.
 */
export async function keepMicrosoftForegroundDuring<T>(
  page: Page,
  task: () => Promise<T>
): Promise<T> {
  const context = page.context()
  const restoreForeground = (_openedPage: Page): void => {
    if (page.isClosed()) return
    void page.bringToFront().catch(() => undefined)
  }

  context.on('page', restoreForeground)
  try {
    if (!page.isClosed()) await page.bringToFront().catch(() => undefined)
    return await task()
  } finally {
    context.removeListener('page', restoreForeground)
    if (!page.isClosed()) await page.bringToFront().catch(() => undefined)
  }
}

/**
 * A handler result belongs to the surface that was detected before the handler
 * started. If Microsoft has already moved to another audited surface meanwhile,
 * that live state is authoritative and the dispatcher must detect/dispatch it
 * instead of terminating on a stale recovery result.
 */
export function shouldYieldRecoveryNeedsAttentionToFreshSurface(
  handledSurface: MicrosoftRecoveryV2Surface,
  currentSurface: EmailAuthV2Surface | null
): boolean {
  return currentSurface !== null && currentSurface !== handledSurface
}

/**
 * An unreadable probe during Microsoft DOM hydration is inconclusive. Keep the
 * bounded settle window alive for null or the still-visible recovery_code state;
 * only a detector-proven different surface ends the settle early.
 */
export function shouldContinueRecoveryPostCodeSettle(
  currentSurface: EmailAuthV2Surface | null
): boolean {
  return currentSurface === null || currentSurface === 'recovery_code'
}

/**
 * Outlook's audited CTA frequently has a real Microsoft href but target=_blank.
 * Navigating that href directly keeps the flow in the existing operator tab.
 */
export function microsoftSameTabNavigationTarget(href: string | null, baseUrl: string): string | null {
  const candidate = href?.trim() ?? ''
  if (!candidate || candidate.toLowerCase().startsWith('javascript:')) return null
  try {
    const target = new URL(candidate, baseUrl).toString()
    return isMicrosoftOwnedNavigationUrl(target) ? target : null
  } catch {
    return null
  }
}

/**
 * After submitting a recovery code Microsoft can hydrate Stay signed in (or the
 * next auth surface) slightly after the click. Give that transition a bounded
 * settle window before allowing another recovery_code dispatch, otherwise the
 * new handler can begin a long mailbox wait while Microsoft is already leaving
 * the old code surface.
 */
async function settleHandledRecoveryCode(page: Page): Promise<void> {
  await waitForMicrosoftAuthStep(page)
  for (let probe = 0; probe < RECOVERY_CODE_SETTLE_PROBES; probe += 1) {
    const detected = await detectMicrosoftSurface(page).catch(() => null)
    if (!shouldContinueRecoveryPostCodeSettle(detected?.surface ?? null)) return
    if (probe + 1 < RECOVERY_CODE_SETTLE_PROBES) {
      await page.waitForTimeout(RECOVERY_CODE_SETTLE_INTERVAL_MS).catch(() => undefined)
    }
  }
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
    if (!expectedMicrosoftNavigationInterruption(error, page.url())) throw error
  }
  await waitForMicrosoftAuthStep(page)
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
  const sameTabTarget = microsoftSameTabNavigationTarget(href, beforeUrl)
  if (sameTabTarget) {
    try {
      await page.goto(sameTabTarget, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    } catch (error) {
      if (!expectedMicrosoftNavigationInterruption(error, page.url())) throw error
      await waitForMicrosoftAuthStep(page)
    }
    await page.bringToFront().catch(() => undefined)
    return page
  }

  const popupPromise = page.waitForEvent('popup', { timeout: 2_500 }).catch(() => null)

  try {
    await link.click({ timeout: 8_000 })
  } catch (error) {
    if (!expectedMicrosoftNavigationInterruption(error, page.url())) throw error
  }

  const popup = await popupPromise
  if (popup) {
    const popupIsMicrosoftOwned = await waitForMicrosoftOwnedPage(popup, 8_000)
    await waitForMicrosoftAuthStep(page)

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

  await waitForMicrosoftAuthStep(page)
  await page.bringToFront().catch(() => undefined)
  return page
}

function needsAttention(kind: HotmailNeedsAttentionReason, message: string): EmailAuthV2HandlerResult {
  return { kind: 'needs_attention', reason: `${kind}:${message}` }
}

/**
 * Batch 5 production controller. The worker owns only the command/profile lifecycle;
 * Microsoft auth itself is now detect -> dispatch -> detect again through the V2
 * dispatcher. Navigation helpers are actions for individual detected surfaces, not
 * an encoded expected sequence.
 */
export async function runMicrosoftAuthV2WorkerController(
  initialPage: Page,
  credentials: MicrosoftAuthV2WorkerCredentials,
  options: MicrosoftAuthV2WorkerOptions = {}
): Promise<MicrosoftAuthV2WorkerResult> {
  configureMailboxProviderBrowser(initialPage.context(), {
    executablePath: credentials.executablePath,
    proxy: credentials.proxy
  })

  const pagesAtFlowStart = new Set(initialPage.context().pages())
  const commonHandlers = new MicrosoftCommonAuthHandlers(credentials)
  let page = initialPage
  let attempted = false
  let targetReady = false
  let attentionReason: HotmailNeedsAttentionReason | undefined
  let attentionMessage: string | undefined

  const setAttention = (reason: HotmailNeedsAttentionReason, message: string): EmailAuthV2HandlerResult => {
    attentionReason = reason
    attentionMessage = message
    return needsAttention(reason, message)
  }

  const common = async (surface: EmailAuthV2Surface): Promise<EmailAuthV2HandlerResult> => {
    const ui = createPlaywrightMicrosoftCommonAuthUi(
      page,
      credentials,
      waitForMicrosoftAuthStep,
      expectedMicrosoftNavigationInterruption
    )
    const outcome = await commonHandlers.handle(surface, ui)
    if (!outcome) return { kind: 'needs_attention', reason: `unsupported_common_surface:${surface}` }
    attempted = attempted || outcome.attempted
    if (outcome.result.kind === 'retryable') await waitForMicrosoftAuthStep(page)
    if (outcome.result.kind === 'needs_attention') {
      attentionReason = outcome.needsAttentionReason ?? 'needs_login'
      attentionMessage = outcome.message
    }
    return outcome.result
  }

  const recovery = async (surface: MicrosoftRecoveryV2Surface): Promise<EmailAuthV2HandlerResult> => {
    const result = await keepMicrosoftForegroundDuring(
      page,
      async () => await handleMicrosoftRecoveryChallenge(page, surface, credentials.backupEmail)
    )

    if (result.status === 'needs_attention') {
      const current = await detectMicrosoftSurface(page).catch(() => null)
      if (shouldYieldRecoveryNeedsAttentionToFreshSurface(surface, current?.surface ?? null)) {
        return { kind: 'handled' }
      }
      return setAttention('security_review', result.message)
    }

    attempted = true
    if (surface === 'recovery_code') {
      await settleHandledRecoveryCode(page)
    } else {
      await waitForMicrosoftAuthStep(page)
    }
    return { kind: 'handled' }
  }

  const handlers: MicrosoftAuthHandlerMap<MicrosoftSurfaceDetection> = {
    authenticated: async () => await common('authenticated'),
    username: async () => await common('username'),
    password: async () => await common('password'),
    account_picker: async () => await common('account_picker'),
    stay_signed_in: async () => await common('stay_signed_in'),
    passkey_prompt: async () => await common('passkey_prompt'),
    sign_in_continue: async () => await common('sign_in_continue'),
    recovery_method_choice: async () => await recovery('recovery_method_choice'),
    recovery_email_confirmation: async () => await recovery('recovery_email_confirmation'),
    recovery_code: async () => await recovery('recovery_code'),
    outlook_landing: async () => {
      const nextPage = await continueFromOutlookLanding(page)
      if (!nextPage) {
        await waitForMicrosoftAuthStep(page)
        return { kind: 'retryable', reason: 'outlook_landing_not_ready' }
      }
      page = nextPage
      attempted = true
      return { kind: 'handled' }
    },
    outlook_transition: async () => {
      await waitForMicrosoftAuthStep(page)
      return { kind: 'retryable', reason: 'outlook_transition' }
    },
    login_transition: async () => {
      await waitForMicrosoftAuthStep(page)
      return { kind: 'retryable', reason: 'login_transition' }
    },
    oauth_authorize: async () => {
      const loginEmail = credentials.loginEmail?.trim() ?? ''
      if (!loginEmail) {
        return setAttention(
          'needs_login',
          'Account thiếu Email canonical nên PAGE-AUTO không chọn tài khoản Microsoft trên OAuth authorize.'
        )
      }
      const ui = createPlaywrightMicrosoftCommonAuthUi(
        page,
        credentials,
        waitForMicrosoftAuthStep,
        expectedMicrosoftNavigationInterruption
      )
      const choice = await ui.chooseAccount(loginEmail)
      if (choice === 'unavailable') {
        await waitForMicrosoftAuthStep(page)
        return { kind: 'retryable', reason: 'oauth_authorize_not_ready' }
      }
      attempted = true
      return { kind: 'handled' }
    },
    password_method_choice: async () => {
      if (!await clickUseYourPassword(page)) {
        await waitForMicrosoftAuthStep(page)
        return { kind: 'retryable', reason: 'password_method_choice_not_ready' }
      }
      attempted = true
      return { kind: 'handled' }
    },
    password_change: async () => {
      if (options.allowPasswordChangeSurface) {
        targetReady = true
        return { kind: 'needs_attention', reason: 'password_change_target_ready' }
      }
      return setAttention(
        'needs_login',
        'Microsoft yêu cầu đổi Password trước khi tiếp tục. PAGE-AUTO không tự xử lý bước đổi Password ngoài action Password được chọn.'
      )
    },
    identity_review: async () => setAttention(
      'identity_review',
      'Microsoft đang yêu cầu xác minh danh tính. PAGE-AUTO dừng ở trạng thái cần xử lý thủ công.'
    ),
    security_review: async () => setAttention(
      'security_review',
      'Microsoft đang yêu cầu bước xác minh bảo mật/2FA ngoài recovery-email đã hỗ trợ. PAGE-AUTO không tự vượt bước này.'
    ),
    credential_error: async () => setAttention(
      'needs_login',
      'Microsoft không chấp nhận Email/PassEmail canonical hiện tại. PAGE-AUTO không thử credential khác và giữ phiên để xử lý thủ công.'
    ),
    manual_login: async () => setAttention(
      'needs_login',
      'Microsoft đang dùng một bước đăng nhập khác flow đã audit. PAGE-AUTO dừng để xử lý thủ công.'
    )
  }

  const result = await runMicrosoftAuthDispatchLoop({
    maxSteps: options.maxSteps ?? 32,
    detect: async () => {
      const previousPage = page
      const previousRoute = microsoftRouteLogLabel(previousPage.url())
      page = await adoptNewestMicrosoftFlowPage(page, pagesAtFlowStart)
      if (page !== previousPage) {
        console.info(
          `[PAGE-AUTO email auth] adopt-page ${previousRoute} -> ${microsoftRouteLogLabel(page.url())}; pages=${page.context().pages().length}`
        )
      }
      for (let readAttempt = 0; readAttempt < 3; readAttempt += 1) {
        const detected = await detectMicrosoftSurface(page)
        if (detected) return { surface: detected.surface, detection: detected }
        if (readAttempt < 2) await waitForMicrosoftAuthStep(page)
      }
      return null
    },
    handlers,
    onTransition: ({ step, surface, detection }) => {
      console.info(
        `[PAGE-AUTO email auth] step=${step} route=${microsoftRouteLogLabel(detection.snapshot.url)} state=${surface} pages=${page.context().pages().length}`
      )
    }
  })

  if (targetReady) return { status: 'target_ready', attempted }
  if (result.kind === 'authenticated') {
    await closeMicrosoftOwnedOpenerChain(page)
    return { status: 'authenticated', attempted }
  }

  await closeMicrosoftOwnedOpenerChain(page)
  if (result.kind === 'needs_attention') {
    if (!attentionReason) attentionReason = result.reason === 'microsoft_surface_unreadable' ? 'security_review' : 'needs_login'
    if (!attentionMessage) {
      attentionMessage = result.reason === 'microsoft_surface_unreadable'
        ? 'Không đọc được trạng thái đăng nhập Microsoft sau nhiều lần chờ; PAGE-AUTO dừng an toàn và giữ nguyên profile Email.'
        : result.reason === 'microsoft_auth_retry_budget_exhausted'
          ? 'Auto login Microsoft chưa đi tới trạng thái xác nhận an toàn sau các bước được hỗ trợ. PAGE-AUTO không tiếp tục tự động.'
          : `Microsoft auth V2 dừng an toàn: ${result.reason}`
    }
  }

  return {
    status: 'needs_attention',
    attempted,
    reason: attentionReason ?? 'needs_login',
    message: attentionMessage ?? 'Microsoft auth V2 chưa hoàn tất.'
  }
}
