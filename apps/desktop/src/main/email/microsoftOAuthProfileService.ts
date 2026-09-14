import type { AccountRepository } from '../database/accountRepository'
import type { HotmailRepository } from '../database/hotmailRepository'
import type { HotmailOAuthStartResult } from '../../shared/hotmail'
import { buildEmailLoginPayload } from './emailCredentialBinding'
import type { EmailCommonRuntime } from './emailCommonRuntime'
import { ensureEmailProfileDirectory, inspectEmailProfile } from './emailProfileResolver'
import type { EmailSecretCipher } from './emailSecretStore'
import {
  createMicrosoftAuthorizationRequest,
  exchangeMicrosoftAuthorizationCode
} from './microsoftOAuthAuthorization'
import { MicrosoftOAuthProfileManager } from './microsoftOAuthProfileManager'
import type { MailboxProviderWorkerRequestHandler } from './mailboxProviderWorkerRpc'

type ResolveEmailBrowserExecutable = (requestedExecutable: string, profileRoot: string) => Promise<string>

function result(accountId: number, started: boolean, message: string): HotmailOAuthStartResult {
  return {
    accountId,
    started,
    userCode: null,
    verificationUri: null,
    expiresAt: null,
    message
  }
}

export class MicrosoftOAuthProfileService {
  private readonly manager: MicrosoftOAuthProfileManager

  constructor(
    private readonly accounts: AccountRepository,
    private readonly repository: HotmailRepository,
    private readonly cipher: EmailSecretCipher,
    private readonly resolveBrowserExecutable: ResolveEmailBrowserExecutable,
    private readonly runtime: EmailCommonRuntime,
    mailboxProviderRequestHandler?: MailboxProviderWorkerRequestHandler
  ) {
    this.manager = new MicrosoftOAuthProfileManager(mailboxProviderRequestHandler)
  }

  isActive(accountId: number): boolean {
    return this.manager.isActive(accountId)
  }

  hasAnyActive(accountIds: number[]): boolean {
    return accountIds.some((accountId) => this.manager.isActive(accountId))
  }

  async startOAuth(accountId: number): Promise<HotmailOAuthStartResult> {
    const account = this.accounts.getById(accountId)
    if (!account) throw new Error(`Không tìm thấy account #${accountId}.`)
    if (!account.email) throw new Error('Account chưa có Email trong Account Manager.')

    const owner = this.runtime.currentOwner(accountId)
    if (owner) {
      throw new Error('Account Email đang có workflow bảo mật khác hoạt động; hoàn tất flow đó trước khi lấy OAuth.')
    }

    const settings = this.repository.getProfileSettings()
    const clientId = settings.oauthClientId.trim()
    if (!clientId) throw new Error('Chưa cấu hình Microsoft OAuth Client ID cho Hotmail Auto.')

    let inspection = await inspectEmailProfile(settings.profileRoot, account.uid)
    if (inspection.status === 'not_configured') throw new Error('Chưa cấu hình Email Profile Root.')

    if (!this.manager.isActive(accountId) && this.runtime.isOpen(accountId)) {
      this.runtime.closeAccount(accountId)
      inspection = await inspectEmailProfile(settings.profileRoot, account.uid)
    }

    const profileDirectory = inspection.profileDirectory
      ?? await ensureEmailProfileDirectory(settings.profileRoot, account.uid)
    const executablePath = await this.resolveBrowserExecutable(settings.browserExecutable, settings.profileRoot)
    const attachedExternally = inspection.status === 'running' && !this.manager.isActive(accountId)
    const proxy = attachedExternally
      ? null
      : (this.runtime.proxyPool.assignment(accountId) ?? this.runtime.proxyPool.acquire(accountId))
    const authorization = createMicrosoftAuthorizationRequest({
      clientId,
      tenant: settings.oauthTenant
    })

    this.repository.updateEmailState(accountId, {
      oauthClientId: clientId,
      oauthStatus: 'pending',
      lastError: null
    })

    try {
      const profileResult = await this.manager.authorize({
        accountId,
        profileDirectory,
        executablePath,
        authorizationUrl: authorization.authorizationUrl,
        state: authorization.state,
        ...buildEmailLoginPayload(account),
        proxy
      })

      if (profileResult.status === 'needs_attention') {
        this.repository.updateEmailState(accountId, {
          oauthClientId: clientId,
          oauthStatus: 'pending',
          mailStatus: 'needs_login',
          lastError: profileResult.message
        })
        return result(accountId, true, profileResult.message)
      }

      if (profileResult.status !== 'success' || !profileResult.code) {
        throw new Error(profileResult.message)
      }

      const token = await exchangeMicrosoftAuthorizationCode(
        { clientId, tenant: settings.oauthTenant },
        {
          code: profileResult.code,
          codeVerifier: authorization.codeVerifier,
          redirectUri: authorization.redirectUri
        }
      )
      const now = Date.now()
      this.repository.updateEmailState(accountId, {
        oauthClientId: clientId,
        refreshTokenCiphertext: this.cipher.encrypt(token.refreshToken),
        oauthStatus: 'valid',
        oauthUpdatedAt: now,
        lastTokenCheckAt: now,
        mailStatus: 'ready',
        lastError: null
      })
      if (proxy) this.runtime.proxyPool.recordSuccess(proxy)
      this.manager.closeAccount(accountId)
      this.runtime.proxyPool.release(accountId)
      return result(accountId, true, 'Đã lấy và lưu Microsoft OAuth refresh token bằng đúng Email profile.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repository.updateEmailState(accountId, {
        oauthClientId: clientId,
        oauthStatus: 'error',
        mailStatus: /login|identity|security|profile/i.test(message) ? 'needs_login' : 'error',
        lastError: message
      })
      if (proxy && /proxy|tunnel/i.test(message)) this.runtime.proxyPool.recordFailure(proxy)
      this.manager.closeAccount(accountId)
      this.runtime.proxyPool.release(accountId)
      throw error
    }
  }

  dispose(): void {
    const activeAccountIds = this.manager.activeAccountIds()
    this.manager.dispose()
    for (const accountId of activeAccountIds) this.runtime.proxyPool.release(accountId)
  }
}
