import { chromium, type BrowserContext, type Page } from 'playwright-core'
import {
  type BrowserSettings,
  type NetworkSettings,
  type SessionSettings
} from '../../shared/appSettings'
import type { PostingCheckpointKind } from '../../shared/posting'
import { applyBrowserContextSettings, buildBrowserLaunchOptions, waitForBrowserStartupDelay } from '../browser/browserRuntime'
import { inspectFacebookAccountIdentity } from '../browser/facebookAccountIdentity'
import { readFacebookDisplayName } from '../browser/facebookProfileInfo'
import {
  bootstrapFacebookSession,
  validateFacebookSession,
  type FacebookSessionAccount,
  type FacebookSessionResult,
  type FacebookSessionTiming
} from '../browser/facebookSession'
import { detectFacebookCheckpointKind } from '../browser/posting/facebookCheckpoint'
import { classifyPageIdentityUid, PageIdentitySwitcher } from '../browser/posting/pageIdentitySwitcher'
import { activeFacebookProfileId, detectFacebookAccessBlock } from '../browser/posting/pageState'
import { effectiveNavigationTimeoutMs, probeFacebookThroughProxy } from '../browser/proxyPreflight'
import {
  bootstrapFacebookSessionWithEmailSupport,
  type FacebookEmailSupportFailureCode
} from './facebookEmailSupportedSession'
import {
  createPacedFacebookPage,
  withoutFacebookInteractionPacing
} from './facebookInteractionPacing'

export type FacebookCommonErrorCode =
  | 'needs_login'
  | 'verification_required'
  | 'email_auth_missing'
  | 'email_auth_expired'
  | 'email_code_not_found'
  | 'email_support_error'
  | 'email_code_failed'
  | 'proxy_unavailable'
  | 'profile_in_use'
  | 'browser_launch_failed'
  | 'page_navigation_failed'
  | 'page_identity_unconfirmed'
  | 'unexpected_error'

export type FacebookCommonSessionState = 'valid' | 'needs_login' | 'verification_required'

export interface FacebookCommonSessionValidation {
  phase: 'before_run' | 'after_run'
  state: FacebookCommonSessionState
  message: string
  checkpointKind?: PostingCheckpointKind
}

export interface FacebookCommonStepResult {
  status: 'success' | 'failed' | 'needs_login'
  code?: FacebookCommonErrorCode
  message: string
  sessionValidation?: FacebookCommonSessionValidation
}

export interface FacebookRuntimeAccount extends FacebookSessionAccount {
  name?: string | null
}

export interface FacebookRuntimeProxyConfig {
  server: string
  username?: string
  password?: string
}

export interface FacebookCommonRuntimeRequest {
  profileDirectory: string
  pageUid: string
  browser: BrowserSettings
  session: SessionSettings
  network: NetworkSettings
  sessionAccount: FacebookRuntimeAccount
  userAgent?: string
  proxy?: FacebookRuntimeProxyConfig
  diagnostic?: (message: string) => void
}

export interface FacebookRuntimeMetadata {
  accountName: string | null
  sessionCookie: string | null
  sessionValidated: boolean
}

export interface FacebookAfterTaskValidation {
  sessionValidation: FacebookCommonSessionValidation
  messageSuffix: string | null
}

export type OpenFacebookCommonRuntimeResult =
  | { status: 'ready'; runtime: FacebookCommonRuntime }
  | { status: 'failed'; result: FacebookCommonStepResult }

const PROFILE_IN_USE_PATTERN = /processsingleton|profile.*in use|user data directory is already in use/i

export function classifyFacebookBrowserLaunchFailure(message: string): FacebookCommonStepResult {
  const profileInUse = PROFILE_IN_USE_PATTERN.test(message)
  return {
    status: 'failed',
    code: profileInUse ? 'profile_in_use' : 'browser_launch_failed',
    message: profileInUse ? 'Browser profile đang được mở ở process khác.' : message
  }
}

export function beforeRunFacebookSessionFailure(
  session: FacebookSessionResult,
  checkpointKind?: PostingCheckpointKind
): FacebookCommonStepResult {
  const verificationRequired = session.reason === 'checkpoint'
  return {
    status: 'needs_login',
    code: verificationRequired ? 'verification_required' : 'needs_login',
    message: session.message,
    sessionValidation: {
      phase: 'before_run',
      state: verificationRequired ? 'verification_required' : 'needs_login',
      message: session.message,
      ...(verificationRequired && checkpointKind ? { checkpointKind } : {})
    }
  }
}

export function beforeRunFacebookEmailSupportFailure(
  code: FacebookEmailSupportFailureCode,
  message: string
): FacebookCommonStepResult {
  return {
    status: 'needs_login',
    code,
    message,
    sessionValidation: {
      phase: 'before_run',
      state: 'needs_login',
      message
    }
  }
}

function beforeRunIdentityFailure(message: string): FacebookCommonStepResult {
  return {
    status: 'needs_login',
    code: 'needs_login',
    message,
    sessionValidation: {
      phase: 'before_run',
      state: 'needs_login',
      message
    }
  }
}

function normalizePageIdentityFailure(result: {
  status: string
  code?: string
  message: string
}): FacebookCommonStepResult {
  const code: FacebookCommonErrorCode =
    result.code === 'needs_login'
      || result.code === 'verification_required'
      || result.code === 'page_navigation_failed'
      || result.code === 'page_identity_unconfirmed'
      ? result.code
      : 'page_identity_unconfirmed'

  return {
    status: code === 'needs_login' || code === 'verification_required' ? 'needs_login' : 'failed',
    code,
    message: result.message
  }
}

export async function checkFacebookCommonAccess(
  page: Page,
  messageContext = 'trong lúc chạy tác vụ Facebook'
): Promise<FacebookCommonStepResult> {
  const state = await detectFacebookAccessBlock(page)
  if (state === 'login_required') {
    return {
      status: 'needs_login',
      code: 'needs_login',
      message: `Facebook yêu cầu đăng nhập lại ${messageContext}.`
    }
  }
  if (state === 'verification_required') {
    return {
      status: 'needs_login',
      code: 'verification_required',
      message: `Facebook yêu cầu checkpoint/xác minh thủ công ${messageContext}.`
    }
  }
  return { status: 'success', message: 'Facebook access state hợp lệ.' }
}

export class FacebookCommonRuntime {
  private lifetimeTimer: NodeJS.Timeout | null = null
  private accountName: string | null
  private sessionCookie: string | null = null
  private sessionValidated = false
  private closed = false

  private constructor(
    readonly context: BrowserContext,
    readonly page: Page,
    readonly browser: BrowserSettings,
    private readonly request: FacebookCommonRuntimeRequest
  ) {
    this.accountName = request.sessionAccount.name?.trim() || null
    this.lifetimeTimer = setTimeout(() => {
      void this.context.close().catch(() => undefined)
    }, request.browser.maxLifetimeMinutes * 60_000)
  }

  static async open(request: FacebookCommonRuntimeRequest): Promise<OpenFacebookCommonRuntimeResult> {
    let context: BrowserContext | null = null
    try {
      await waitForBrowserStartupDelay(request.browser)
      context = await chromium.launchPersistentContext(request.profileDirectory, {
        ...buildBrowserLaunchOptions(request.browser),
        viewport: null,
        ...(request.userAgent ? { userAgent: request.userAgent } : {}),
        ...(request.proxy
          ? {
              proxy: {
                server: request.proxy.server,
                ...(request.proxy.username ? { username: request.proxy.username } : {}),
                ...(request.proxy.password ? { password: request.proxy.password } : {})
              }
            }
          : {})
      })
      await applyBrowserContextSettings(context, request.browser)

      const runtimeBrowser: BrowserSettings = {
        ...request.browser,
        navigationTimeoutMs: effectiveNavigationTimeoutMs(
          request.browser.navigationTimeoutMs,
          request.network.networkTimeoutMs
        )
      }
      const rawPage = context.pages()[0] ?? await context.newPage()
      rawPage.setDefaultTimeout(request.network.networkTimeoutMs)
      rawPage.setDefaultNavigationTimeout(runtimeBrowser.navigationTimeoutMs)
      const page = createPacedFacebookPage(rawPage, runtimeBrowser, request.diagnostic)
      return {
        status: 'ready',
        runtime: new FacebookCommonRuntime(context, page, runtimeBrowser, request)
      }
    } catch (error) {
      await context?.close().catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      return { status: 'failed', result: classifyFacebookBrowserLaunchFailure(message) }
    }
  }

  metadata(): FacebookRuntimeMetadata {
    return {
      accountName: this.accountName,
      sessionCookie: this.sessionCookie,
      sessionValidated: this.sessionValidated
    }
  }

  private sessionTiming(): FacebookSessionTiming {
    return {
      networkTimeoutMs: this.request.network.networkTimeoutMs,
      navigationTimeoutMs: this.browser.navigationTimeoutMs,
      pageSettleDelayMs: this.browser.pageSettleDelayMs
    }
  }

  // Compatibility boundary only. Actual operator delay is now owned once by the paced Page operations.
  async pace(boundary: string): Promise<void> {
    this.request.diagnostic?.(`pacing=${boundary} source=facebook-operation-wrapper`)
  }

  private async checkpointKind(): Promise<PostingCheckpointKind | undefined> {
    const kind = await detectFacebookCheckpointKind(this.page).catch(() => null)
    if (!kind) return undefined
    this.request.diagnostic?.(`state=checkpoint kind=${kind}`)
    return kind
  }

  private async ensurePageIdentity(): Promise<FacebookCommonStepResult> {
    const activePageUid = await activeFacebookProfileId(this.context).catch(() => null)
    if (classifyPageIdentityUid(this.request.pageUid, activePageUid) === 'match') {
      this.request.diagnostic?.(`state=page_identity reuse i_user=${this.request.pageUid}`)
      return { status: 'success', message: 'Page identity hiện tại đã đúng Page UID.' }
    }

    const identity = await new PageIdentitySwitcher(
      this.page,
      this.context,
      this.browser,
      this.request.network.networkTimeoutMs
    ).switchTo(this.request.pageUid)
    if (identity.status !== 'success') return normalizePageIdentityFailure(identity)
    this.request.diagnostic?.('state=page_identity switched')
    return { status: 'success', message: identity.message }
  }

  checkAccessBlock(messageContext = 'trong lúc chạy tác vụ Facebook'): Promise<FacebookCommonStepResult> {
    return checkFacebookCommonAccess(this.page, messageContext)
  }

  async prepareForPage(): Promise<FacebookCommonStepResult> {
    if (this.request.proxy && this.request.network.checkProxyBeforeRun) {
      const proxyCheck = await probeFacebookThroughProxy(this.page, this.request.network)
      if (proxyCheck.status === 'failed') {
        return { status: 'failed', code: 'proxy_unavailable', message: proxyCheck.message }
      }
    }

    const bootstrap = await withoutFacebookInteractionPacing(this.page, () => (
      bootstrapFacebookSessionWithEmailSupport(
        this.context,
        this.page,
        this.request.sessionAccount,
        this.request.session.facebookLocale,
        this.sessionTiming()
      )
    ))
    if (bootstrap.status === 'email_failure') {
      return beforeRunFacebookEmailSupportFailure(bootstrap.code, bootstrap.message)
    }
    const session = bootstrap.session
    if (session.status !== 'valid') {
      const checkpointKind = session.reason === 'checkpoint' ? await this.checkpointKind() : undefined
      return beforeRunFacebookSessionFailure(session, checkpointKind)
    }
    this.sessionValidated = true
    this.sessionCookie = session.cookie

    const accountIdentity = await inspectFacebookAccountIdentity(
      this.context,
      this.request.sessionAccount.uid
    )
    if (accountIdentity.state === 'mismatch' || accountIdentity.state === 'missing') {
      this.sessionValidated = false
      return beforeRunIdentityFailure(accountIdentity.message)
    }
    if (!this.accountName && accountIdentity.state === 'match') {
      this.accountName = await readFacebookDisplayName(this.page).catch(() => null)
    }

    if (!this.request.pageUid.trim()) {
      this.request.diagnostic?.('state=profile_identity ready page_switch=skipped')
      return { status: 'success', message: 'Profile identity đã sẵn sàng; action này không yêu cầu Page switch.' }
    }
    return this.ensurePageIdentity()
  }

  async validateAfterTask(): Promise<FacebookAfterTaskValidation> {
    const afterSession = await validateFacebookSession(this.context, this.page)
    if (afterSession.state === 'valid') {
      return {
        messageSuffix: null,
        sessionValidation: { phase: 'after_run', state: 'valid', message: afterSession.message }
      }
    }

    if (afterSession.state === 'needs_login') {
      const recovered = await withoutFacebookInteractionPacing(this.page, () => (
        bootstrapFacebookSession(
          this.context,
          this.page,
          this.request.sessionAccount,
          this.request.session.facebookLocale,
          this.sessionTiming()
        )
      ))
      if (recovered.status === 'valid') {
        const recoveredIdentity = await inspectFacebookAccountIdentity(
          this.context,
          this.request.sessionAccount.uid
        )
        if (recoveredIdentity.state === 'match' || recoveredIdentity.state === 'unverifiable') {
          this.sessionCookie = recovered.cookie ?? this.sessionCookie
          this.sessionValidated = true
          if (!this.accountName && recoveredIdentity.state === 'match') {
            this.accountName = await readFacebookDisplayName(this.page).catch(() => null)
          }
          return {
            messageSuffix: 'Session vừa hết đã được tự đăng nhập lại.',
            sessionValidation: {
              phase: 'after_run',
              state: 'valid',
              message: 'Đã tự phục hồi session sau tác vụ Facebook.'
            }
          }
        }
      }

      this.sessionValidated = false
      const verificationRequired = recovered.reason === 'checkpoint'
      const checkpointKind = verificationRequired ? await this.checkpointKind() : undefined
      return {
        messageSuffix: recovered.message,
        sessionValidation: {
          phase: 'after_run',
          state: verificationRequired ? 'verification_required' : 'needs_login',
          message: recovered.message,
          ...(checkpointKind ? { checkpointKind } : {})
        }
      }
    }

    this.sessionValidated = false
    const checkpointKind = afterSession.state === 'verification_required'
      ? await this.checkpointKind()
      : undefined
    return {
      messageSuffix: afterSession.message,
      sessionValidation: {
        phase: 'after_run',
        state: afterSession.state,
        message: afterSession.message,
        ...(checkpointKind ? { checkpointKind } : {})
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.lifetimeTimer) {
      clearTimeout(this.lifetimeTimer)
      this.lifetimeTimer = null
    }
    if (this.request.browser.closeDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.request.browser.closeDelayMs))
    }
    await this.context.close().catch(() => undefined)
  }
}
