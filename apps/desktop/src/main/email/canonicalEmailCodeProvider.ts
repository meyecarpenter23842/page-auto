import type { AccountRepository } from '../database/accountRepository'
import type { HotmailRepository } from '../database/hotmailRepository'
import type { EmailSecretCipher } from './emailSecretStore'
import { MicrosoftGraphMailAdapter } from './microsoftGraphMailAdapter'
import { MicrosoftOAuthService } from './microsoftOAuthService'
import { parseVerificationCode, type MailMessageSnapshot } from './verificationCodeParser'
import {
  EMAIL_CODE_DB_RETENTION_MS,
  type EmailCodeFailureStatus,
  type EmailCodeProvider,
  type EmailCodeRequest,
  type EmailCodeResult
} from '../../shared/emailCode'

const EMAIL_CODE_POLL_MS = 1_500
const MAX_EMAIL_CODE_WAIT_MS = 20_000
const MANUAL_CODE_MAX_AGE_MS = 30 * 60_000
const FACEBOOK_CODE_MAX_AGE_MS = 10 * 60_000
const FACEBOOK_MAIL_HINT = /facebook|facebookmail|meta/i

export interface CanonicalEmailCodeState {
  oauthStatus: string
  oauthClientId: string | null
  refreshTokenCiphertext: string | null
  lastCodeAt?: number | null
}

export interface CanonicalEmailCodeStatePatch {
  oauthStatus?: 'valid' | 'expired'
  mailStatus?: 'ready' | 'needs_login' | 'error'
  lastCheckAt?: number
  lastCode?: string | null
  lastCodeAt?: number | null
  lastError?: string | null
}

export interface CanonicalEmailCodeProviderDependencies {
  getAccount: (accountId: number) => { email: string | null } | null
  getState: (accountId: number) => CanonicalEmailCodeState | null
  readMessages: (accountId: number, state: CanonicalEmailCodeState, limit: number) => Promise<MailMessageSnapshot[]>
  updateState: (accountId: number, patch: CanonicalEmailCodeStatePatch) => void
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_EMAIL_CODE_WAIT_MS, Math.floor(value ?? 0)))
}

function supportResult(accountId: number, status: EmailCodeFailureStatus, message: string): EmailCodeResult {
  return { accountId, status, code: null, receivedAt: null, sender: null, message }
}

export function classifyEmailCodeReadError(error: unknown): EmailCodeFailureStatus {
  const message = error instanceof Error ? error.message : String(error)
  return /invalid_grant|invalid_client|interaction_required|token|oauth|mail\.read|\b401\b|\b403\b/i.test(message)
    ? 'email_auth_expired'
    : 'email_support_error'
}

function facebookMessageHint(message: MailMessageSnapshot): boolean {
  return FACEBOOK_MAIL_HINT.test(`${message.sender}\n${message.subject}`)
}

export class CanonicalEmailCodeProvider implements EmailCodeProvider {
  private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(private readonly dependencies: CanonicalEmailCodeProviderDependencies) {
    this.now = dependencies.now ?? Date.now
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  }

  async getEmailCode(request: EmailCodeRequest): Promise<EmailCodeResult> {
    const accountId = request.accountId
    const account = this.dependencies.getAccount(accountId)
    if (!account?.email?.trim()) {
      return supportResult(accountId, 'email_auth_missing', 'Account chưa có Email/OAuth sẵn sàng để lấy mã.')
    }

    const startedAt = this.now()
    const timeoutMs = boundedTimeout(request.timeoutMs)
    const deadline = startedAt + timeoutMs

    while (true) {
      const now = this.now()
      const state = this.dependencies.getState(accountId)
      const clientId = state?.oauthClientId?.trim() ?? ''
      if (!clientId || !state?.refreshTokenCiphertext) {
        return supportResult(accountId, 'email_auth_missing', 'Email OAuth chưa có Client ID + Refresh Token canonical cho account này.')
      }

      if (state.lastCodeAt && now - state.lastCodeAt > EMAIL_CODE_DB_RETENTION_MS) {
        this.dependencies.updateState(accountId, { lastCode: null, lastCodeAt: null })
      }

      try {
        const messages = await this.dependencies.readMessages(accountId, state, 25)
        const minimumReceivedAt = Math.max(
          request.notBefore ?? 0,
          now - (request.consumer === 'facebook_login' ? FACEBOOK_CODE_MAX_AGE_MS : MANUAL_CODE_MAX_AGE_MS)
        )
        const eligible = messages.filter((message) => {
          if (message.receivedAt < minimumReceivedAt) return false
          if (request.consumer === 'facebook_login' && !facebookMessageHint(message)) return false
          return true
        })
        const match = parseVerificationCode(eligible, now)

        if (match) {
          this.dependencies.updateState(accountId, {
            oauthStatus: 'valid',
            mailStatus: 'ready',
            lastCheckAt: now,
            lastCode: match.code,
            lastCodeAt: match.receivedAt,
            lastError: null
          })
          return {
            accountId,
            status: 'success',
            code: match.code,
            receivedAt: match.receivedAt,
            sender: match.sender || null,
            message: request.consumer === 'facebook_login'
              ? 'Email Support Service đã nhận mã Facebook mới.'
              : `Đã lấy mã mới từ ${match.sender || 'mailbox'}.`
          }
        }

        this.dependencies.updateState(accountId, {
          oauthStatus: 'valid',
          mailStatus: 'ready',
          lastCheckAt: now,
          lastError: null
        })
      } catch (error) {
        const status = classifyEmailCodeReadError(error)
        this.dependencies.updateState(accountId, status === 'email_auth_expired'
          ? { oauthStatus: 'expired', mailStatus: 'needs_login', lastCheckAt: now, lastError: 'Microsoft OAuth cần kết nối lại.' }
          : { mailStatus: 'error', lastCheckAt: now, lastError: 'Email Support Service không đọc được mailbox.' })
        return supportResult(
          accountId,
          status,
          status === 'email_auth_expired'
            ? 'Email OAuth đã hết hạn hoặc không còn hợp lệ; cần lấy/cập nhật OAuth.'
            : 'Email Support Service không đọc được mailbox; kiểm tra kết nối Email rồi thử lại.'
        )
      }

      if (this.now() >= deadline) {
        return supportResult(accountId, 'email_code_not_found', 'Chưa tìm thấy mã Email mới phù hợp trong cửa sổ thời gian yêu cầu.')
      }
      await this.sleep(Math.min(EMAIL_CODE_POLL_MS, Math.max(1, deadline - this.now())))
    }
  }
}

export interface CanonicalEmailCodeRuntime {
  provider: CanonicalEmailCodeProvider
  dispose: () => void
}

export function createCanonicalEmailCodeRuntime(
  accounts: AccountRepository,
  repository: HotmailRepository,
  cipher: EmailSecretCipher
): CanonicalEmailCodeRuntime {
  const oauth = new MicrosoftOAuthService(cipher)
  const mail = new MicrosoftGraphMailAdapter()
  const provider = new CanonicalEmailCodeProvider({
    getAccount: (accountId) => accounts.getById(accountId),
    getState: (accountId) => repository.getEmailState(accountId),
    updateState: (accountId, patch) => { repository.updateEmailState(accountId, patch) },
    readMessages: async (accountId, state, limit) => {
      const clientId = state.oauthClientId?.trim() ?? ''
      if (!clientId || !state.refreshTokenCiphertext) throw new Error('Microsoft OAuth token missing.')
      const settings = repository.getProfileSettings()
      const accessToken = await oauth.getAccessToken(
        { refreshTokenCiphertext: state.refreshTokenCiphertext },
        { clientId, tenant: settings.oauthTenant },
        (refreshTokenCiphertext) => {
          repository.updateEmailState(accountId, {
            oauthClientId: clientId,
            refreshTokenCiphertext,
            oauthStatus: 'valid',
            oauthUpdatedAt: Date.now(),
            lastError: null
          })
        }
      )
      repository.updateEmailState(accountId, {
        oauthStatus: 'valid',
        lastTokenCheckAt: Date.now(),
        lastError: null
      })
      return mail.listRecentMessages(accessToken, limit)
    }
  })

  return { provider, dispose: () => oauth.dispose() }
}
