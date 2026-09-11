import type { Locator, Page } from 'playwright-core'
import type { HotmailNeedsAttentionReason } from '../../shared/hotmail'
import { emailCredentialValueMatches, traceEmailCredential } from './emailCredentialBinding'
import type { EmailAuthV2HandlerResult, EmailAuthV2Surface } from './emailAuthV2Contracts'
import { microsoftAccountPickerEntryMatchesCanonicalEmail } from './emailLoginPolicy'

export const MICROSOFT_COMMON_AUTH_SURFACES = [
  'authenticated',
  'username',
  'password',
  'account_picker',
  'stay_signed_in',
  'passkey_prompt',
  'sign_in_continue'
] as const satisfies readonly EmailAuthV2Surface[]

export type MicrosoftCommonAuthSurface = (typeof MICROSOFT_COMMON_AUTH_SURFACES)[number]

const MICROSOFT_COMMON_AUTH_SURFACE_SET = new Set<string>(MICROSOFT_COMMON_AUTH_SURFACES)

export function isMicrosoftCommonAuthSurface(surface: EmailAuthV2Surface): surface is MicrosoftCommonAuthSurface {
  return MICROSOFT_COMMON_AUTH_SURFACE_SET.has(surface)
}

export interface MicrosoftCommonAuthCredentials {
  accountId: number
  profileDirectory: string
  loginEmail?: string
  loginPassword?: string
}

export type MicrosoftAccountPickerChoice = 'canonical' | 'another' | 'unavailable'

/**
 * Narrow UI port used by the independent Batch 2 handlers.
 *
 * Production Playwright selectors live in the adapter below; unit tests can
 * exercise handler semantics without constructing a browser context.
 */
export interface MicrosoftCommonAuthUi {
  fillUsername(value: string): Promise<string | null>
  fillPassword(value: string): Promise<string | null>
  clickPrimarySubmit(): Promise<boolean>
  chooseAccount(canonicalEmail: string): Promise<MicrosoftAccountPickerChoice>
  clickStaySignedIn(): Promise<boolean>
  /** Present only on adapters that audited the Microsoft DOM passkey Cancel control. */
  clickPasskeyCancel?(): Promise<boolean>
}

export interface MicrosoftCommonAuthHandlerOutcome {
  result: EmailAuthV2HandlerResult
  attempted: boolean
  needsAttentionReason?: HotmailNeedsAttentionReason
  message?: string
}

export type MicrosoftWaitForStep = (page: Page) => Promise<void>
export type MicrosoftNavigationInterruptionCheck = (error: unknown, currentUrl: string) => boolean

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function findCanonicalAccountPickerEntry(page: Page, canonicalEmail: string): Promise<Locator | null> {
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

/**
 * Production Playwright adapter for the common Microsoft credential handlers.
 * Input values are read back after fill so handlers can verify DOM state before
 * any submit click. Password trace remains fingerprint-only through the existing
 * credential trace helper; plaintext secrets are never logged here.
 */
export function createPlaywrightMicrosoftCommonAuthUi(
  page: Page,
  credentials: MicrosoftCommonAuthCredentials,
  waitForStep: MicrosoftWaitForStep,
  isExpectedNavigationInterruption: MicrosoftNavigationInterruptionCheck
): MicrosoftCommonAuthUi {
  return {
    async fillUsername(value) {
      const username = await firstVisible([
        page.locator('input[name="loginfmt"]:visible').first(),
        page.locator('input[autocomplete="username"]:visible').first()
      ])
      if (!username) return null
      await username.fill(value)
      return (await username.inputValue().catch(() => '')).trim()
    },

    async fillPassword(value) {
      const password = await firstVisible([
        page.locator('input[name="passwd"][type="password"]:visible').first(),
        page.locator('input[type="password"]:visible').first(),
        page.getByLabel(/password|mật khẩu/i).first()
      ])
      if (!password) return null

      traceEmailCredential('worker-before-fill', {
        accountId: credentials.accountId,
        email: credentials.loginEmail,
        secret: value,
        profileDirectory: credentials.profileDirectory
      })
      await password.fill(value)
      const filledPassword = await password.inputValue().catch(() => '')
      traceEmailCredential('worker-after-fill', {
        accountId: credentials.accountId,
        email: credentials.loginEmail,
        secret: filledPassword,
        profileDirectory: credentials.profileDirectory
      })
      return filledPassword
    },

    async clickPrimarySubmit() {
      const submit = await firstVisible([
        page.locator('#idSIButton9:visible').first(),
        page.getByRole('button', { name: /next|sign in|continue|tiếp theo|đăng nhập|tiếp tục/i }).last(),
        page.locator('input[type="submit"]:visible').last(),
        page.locator('button[type="submit"]:visible').last()
      ])
      if (!submit) return false
      await submit.click()
      await waitForStep(page)
      return true
    },

    async chooseAccount(canonicalEmail) {
      const canonicalAccount = await findCanonicalAccountPickerEntry(page, canonicalEmail)
      if (canonicalAccount) {
        try {
          await canonicalAccount.click({ timeout: 8_000 })
        } catch (error) {
          if (!isExpectedNavigationInterruption(error, page.url())) throw error
        }
        await waitForStep(page)
        return 'canonical'
      }

      const anotherAccount = await firstVisible([
        page.getByRole('button', { name: /^(use another account|sign in with another account|sử dụng tài khoản khác|đăng nhập bằng tài khoản khác)$/i }).first(),
        page.getByRole('link', { name: /^(use another account|sign in with another account|sử dụng tài khoản khác|đăng nhập bằng tài khoản khác)$/i }).first(),
        page.getByText(/^(use another account|sign in with another account|sử dụng tài khoản khác|đăng nhập bằng tài khoản khác)$/i).first()
      ])
      if (!anotherAccount) return 'unavailable'
      await anotherAccount.click()
      await waitForStep(page)
      return 'another'
    },

    async clickStaySignedIn() {
      const submit = await firstVisible([
        page.locator('#idSIButton9:visible').first(),
        page.getByRole('button', { name: /^yes$/i }).first(),
        page.getByRole('button', { name: /yes|continue|có|tiếp tục/i }).last(),
        page.locator('input[type="submit"]:visible').last()
      ])
      if (!submit) return false
      await submit.click()
      await waitForStep(page)
      return true
    },

    async clickPasskeyCancel() {
      const cancel = await firstVisible([
        page.getByRole('button', { name: /^cancel$/i }).first(),
        page.locator('button:visible').filter({ hasText: /^cancel$/i }).first()
      ])
      if (!cancel) return false
      try {
        await cancel.click({ timeout: 8_000 })
      } catch (error) {
        if (!isExpectedNavigationInterruption(error, page.url())) throw error
      }
      await waitForStep(page)
      return true
    }
  }
}

function needsLogin(reason: string, message: string, attempted = false): MicrosoftCommonAuthHandlerOutcome {
  return {
    result: { kind: 'needs_attention', reason },
    attempted,
    needsAttentionReason: 'needs_login',
    message
  }
}

function retryable(reason: string): MicrosoftCommonAuthHandlerOutcome {
  return {
    result: { kind: 'retryable', reason },
    attempted: false
  }
}

/**
 * Batch 2 credential/common handler set.
 *
 * The object is per auto-login attempt so Username/passkey retry state stays bounded
 * across re-detection while each handler still owns only one Microsoft surface.
 */
export class MicrosoftCommonAuthHandlers {
  private usernameSubmitAttempts = 0
  private passkeyCancelAttempts = 0

  constructor(private readonly credentials: MicrosoftCommonAuthCredentials) {}

  async handle(
    surface: EmailAuthV2Surface,
    ui: MicrosoftCommonAuthUi
  ): Promise<MicrosoftCommonAuthHandlerOutcome | null> {
    switch (surface) {
      case 'authenticated':
        return {
          result: { kind: 'authenticated' },
          attempted: false
        }
      case 'username':
        return await this.handleUsername(ui)
      case 'password':
        return await this.handlePassword(ui)
      case 'account_picker':
        return await this.handleAccountPicker(ui)
      case 'stay_signed_in':
        return await this.handleStaySignedIn(ui)
      case 'passkey_prompt':
        return await this.handlePasskeyPrompt(ui)
      case 'sign_in_continue':
        return needsLogin(
          'sign_in_continue_live_evidence_required',
          'Microsoft đang ở bước Sign in tiếp sau Passkey nhưng marker live của surface này chưa được audit. PAGE-AUTO không tự đoán selector để tiếp tục.'
        )
      default:
        return null
    }
  }

  private canonicalEmail(): string | null {
    const email = this.credentials.loginEmail?.trim() ?? ''
    return email || null
  }

  private canonicalPassword(): string | null {
    const password = this.credentials.loginPassword ?? ''
    return password || null
  }

  private async handleUsername(ui: MicrosoftCommonAuthUi): Promise<MicrosoftCommonAuthHandlerOutcome> {
    const email = this.canonicalEmail()
    if (!email) {
      return needsLogin(
        'missing_canonical_email',
        'Account thiếu Email canonical để auto login Microsoft. PAGE-AUTO giữ profile mở để đăng nhập thủ công.'
      )
    }

    if (this.usernameSubmitAttempts >= 2) {
      return needsLogin(
        'username_retry_budget_exhausted',
        'Microsoft vẫn từ chối Email canonical sau khi PAGE-AUTO đã xác nhận field chứa đúng giá trị và thử lại có giới hạn. PAGE-AUTO giữ phiên để kiểm tra dữ liệu Email.'
      )
    }

    const filledEmail = await ui.fillUsername(email)
    if (filledEmail === null) return retryable('username_input_not_ready')
    if (filledEmail !== email) {
      return needsLogin(
        'username_fill_mismatch',
        'PAGE-AUTO không xác nhận được field Microsoft đã nhận đúng Email canonical nên không bấm Next.'
      )
    }

    if (!await ui.clickPrimarySubmit()) return retryable('username_submit_not_ready')
    this.usernameSubmitAttempts += 1
    return {
      result: { kind: 'handled' },
      attempted: true
    }
  }

  private async handlePassword(ui: MicrosoftCommonAuthUi): Promise<MicrosoftCommonAuthHandlerOutcome> {
    const password = this.canonicalPassword()
    if (!password) {
      return needsLogin(
        'missing_canonical_password',
        'Account thiếu PassEmail canonical để auto login Microsoft. PAGE-AUTO giữ profile mở để đăng nhập thủ công.'
      )
    }

    const filledPassword = await ui.fillPassword(password)
    if (filledPassword === null) return retryable('password_input_not_ready')
    if (!emailCredentialValueMatches(password, filledPassword)) {
      return needsLogin(
        'password_fill_mismatch',
        'PAGE-AUTO phát hiện Password trong DOM khác PassEmail của command hiện tại nên không bấm Sign in. Bật credential trace để đối chiếu fingerprint.'
      )
    }

    if (!await ui.clickPrimarySubmit()) return retryable('password_submit_not_ready')
    return {
      result: { kind: 'handled' },
      attempted: true
    }
  }

  private async handleAccountPicker(ui: MicrosoftCommonAuthUi): Promise<MicrosoftCommonAuthHandlerOutcome> {
    const email = this.canonicalEmail()
    if (!email) {
      return needsLogin(
        'missing_canonical_email',
        'Account thiếu Email canonical nên PAGE-AUTO không chọn tài khoản Microsoft từ Account Picker.'
      )
    }

    const choice = await ui.chooseAccount(email)
    if (choice === 'unavailable') return retryable('account_picker_not_ready')
    return {
      result: { kind: 'handled' },
      attempted: true
    }
  }

  private async handleStaySignedIn(ui: MicrosoftCommonAuthUi): Promise<MicrosoftCommonAuthHandlerOutcome> {
    if (!await ui.clickStaySignedIn()) return retryable('stay_signed_in_not_ready')
    return {
      result: { kind: 'handled' },
      attempted: true
    }
  }

  private async handlePasskeyPrompt(ui: MicrosoftCommonAuthUi): Promise<MicrosoftCommonAuthHandlerOutcome> {
    if (!ui.clickPasskeyCancel) {
      return needsLogin(
        'passkey_live_evidence_required',
        'Microsoft đang ở bước Passkey nhưng adapter hiện tại chưa có capability Cancel đã audit. PAGE-AUTO giữ phiên để xử lý thủ công.'
      )
    }
    if (this.passkeyCancelAttempts >= 2) {
      return needsLogin(
        'passkey_cancel_retry_budget_exhausted',
        'Microsoft tiếp tục trả lại màn Passkey sau hai lần Cancel đã xác nhận. PAGE-AUTO dừng để tránh lặp vô hạn.'
      )
    }
    if (!await ui.clickPasskeyCancel()) return retryable('passkey_cancel_not_ready')
    this.passkeyCancelAttempts += 1
    return {
      result: { kind: 'handled' },
      attempted: true
    }
  }
}
