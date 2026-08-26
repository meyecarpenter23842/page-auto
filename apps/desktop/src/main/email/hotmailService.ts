import type { AccountRepository } from '../database/accountRepository'
import type { HotmailRepository } from '../database/hotmailRepository'
import type {
  HotmailBatchPayload,
  HotmailBatchResult,
  HotmailBrowserOpenResult,
  HotmailDashboardRow,
  HotmailOAuthStartResult,
  HotmailProxyStatus,
  HotmailProxyTestResult,
  HotmailSettingsView,
  SaveHotmailSettingsInput
} from '../../shared/hotmail'
import { EmailBrowserManager } from './emailBrowserManager'
import { EMAIL_PROFILE_IN_USE_CACHE_MS, isEmailProfileInUseOverrideActive } from './emailBrowserLifecycle'
import { inspectEmailProfile, validateEmailProfileRoot } from './emailProfileResolver'
import { EmailProxyPool, normalizeEmailProxyLines } from './emailProxyPool'
import { testEmailProxy } from './emailProxyTester'
import { MicrosoftGraphMailAdapter } from './microsoftGraphMailAdapter'
import { MicrosoftOAuthService } from './microsoftOAuthService'
import type { EmailSecretCipher } from './emailSecretStore'
import { parseVerificationCode } from './verificationCodeParser'

function uniqueAccountIds(payload: HotmailBatchPayload): number[] {
  return [...new Set(payload.accountIds.filter((id) => Number.isInteger(id) && id > 0))]
}

type ResolveEmailBrowserExecutable = (requestedExecutable: string, profileRoot: string) => Promise<string>

export class HotmailService {
  private readonly oauth: MicrosoftOAuthService
  private readonly mail = new MicrosoftGraphMailAdapter()
  private readonly browser: EmailBrowserManager
  private readonly proxyPool: EmailProxyPool
  private readonly runtimeStatus = new Map<number, HotmailDashboardRow['runtimeStatus']>()
  private readonly profileInUseUntil = new Map<number, number>()

  constructor(
    private readonly accounts: AccountRepository,
    private readonly repository: HotmailRepository,
    cipher: EmailSecretCipher,
    private readonly resolveBrowserExecutable: ResolveEmailBrowserExecutable
  ) {
    this.oauth = new MicrosoftOAuthService(cipher)
    this.proxyPool = new EmailProxyPool(() => this.repository.getProxySettings())
    this.browser = new EmailBrowserManager((accountId) => this.proxyPool.release(accountId))
  }

  async listDashboard(): Promise<HotmailDashboardRow[]> {
    const settings = this.repository.getProfileSettings()
    const rows = this.repository.listDashboardRows()
    return await Promise.all(rows.map(async (row) => {
      const profile = await inspectEmailProfile(settings.profileRoot, row.uid)
      const inUseUntil = this.profileInUseUntil.get(row.accountId)
      if (inUseUntil !== undefined && !isEmailProfileInUseOverrideActive(inUseUntil)) {
        this.profileInUseUntil.delete(row.accountId)
      }
      const profileStatus = this.browser.isOpen(row.accountId) || profile.status === 'running'
        ? 'running'
        : isEmailProfileInUseOverrideActive(this.profileInUseUntil.get(row.accountId))
          ? 'in_use'
          : profile.status
      return {
        ...row,
        profileStatus,
        profileDirectory: profile.profileDirectory,
        runtimeStatus: this.runtimeStatus.get(row.accountId) ?? row.runtimeStatus
      }
    }))
  }

  getSettings(): HotmailSettingsView {
    return this.repository.getSettingsView(this.proxyPool.peek()?.display ?? null)
  }

  async saveSettings(input: SaveHotmailSettingsInput): Promise<HotmailSettingsView> {
    const normalizedProxyEntries = input.proxyListText === undefined
      ? undefined
      : normalizeEmailProxyLines(input.proxyListText)
    if (input.proxyMode === 'random_ipv4') {
      const effectiveCount = normalizedProxyEntries?.length ?? this.repository.getProxySettings().entries.length
      if (effectiveCount === 0) throw new Error('Random IPv4 cần ít nhất một proxy Email hợp lệ trong pool.')
    }

    if (input.profileRoot.trim()) await validateEmailProfileRoot(input.profileRoot)
    if (input.browserExecutable.trim()) {
      // Manual mode is validated using the same persistent-context semantics as Email runtime.
      await this.resolveBrowserExecutable(input.browserExecutable, input.profileRoot)
    }

    // Empty browserExecutable intentionally remains empty: that is Browser Auto.
    // Do not persist a Facebook/global browser fallback or pin one auto-detected path.
    this.repository.saveSettings(input, normalizedProxyEntries)
    this.profileInUseUntil.clear()
    return this.getSettings()
  }

  async startOAuth(accountId: number): Promise<HotmailOAuthStartResult> {
    const account = this.requireAccount(accountId)
    if (!account.email) throw new Error('Account chưa có Email trong Account Manager.')
    const settings = this.repository.getProfileSettings()
    const clientId = settings.oauthClientId.trim()
    this.runtimeStatus.set(accountId, 'connecting')
    try {
      return await this.oauth.startDeviceCode(accountId, {
        clientId,
        tenant: settings.oauthTenant
      }, {
        saveRefreshToken: (ciphertext, status) => {
          const now = Date.now()
          this.repository.updateEmailState(accountId, {
            oauthClientId: clientId,
            refreshTokenCiphertext: ciphertext,
            oauthStatus: status,
            oauthUpdatedAt: now,
            lastTokenCheckAt: now,
            mailStatus: 'ready',
            lastError: null
          })
          this.runtimeStatus.set(accountId, 'idle')
        },
        setOAuthStatus: (status, error = null) => {
          this.repository.updateEmailState(accountId, {
            oauthStatus: status,
            ...(status === 'error' || status === 'expired' ? { mailStatus: 'needs_login' } : {}),
            lastError: error
          })
          if (status !== 'pending') this.runtimeStatus.set(accountId, status === 'valid' ? 'idle' : 'error')
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repository.updateEmailState(accountId, { oauthStatus: 'error', mailStatus: 'error', lastError: message })
      this.runtimeStatus.set(accountId, 'error')
      throw error
    }
  }

  async getCodes(payload: HotmailBatchPayload): Promise<HotmailBatchResult> {
    const results: HotmailBatchResult['results'] = []
    for (const accountId of uniqueAccountIds(payload)) {
      const account = this.accounts.getById(accountId)
      if (!account) {
        results.push({ accountId, status: 'error', message: 'Account không tồn tại.' })
        continue
      }
      if (!account.email) {
        results.push({ accountId, status: 'error', message: 'Account chưa có Email.' })
        continue
      }
      this.runtimeStatus.set(accountId, 'reading')
      try {
        const messages = await this.readMessages(accountId)
        const match = parseVerificationCode(messages)
        const now = Date.now()
        this.repository.updateEmailState(accountId, {
          oauthStatus: 'valid',
          mailStatus: 'ready',
          lastCheckAt: now,
          ...(match ? { lastCode: match.code, lastCodeAt: match.receivedAt } : {}),
          lastError: null
        })
        this.runtimeStatus.set(accountId, 'idle')
        results.push(match
          ? { accountId, status: 'success', message: `Đã lấy code mới từ ${match.sender || 'mailbox'}.`, code: match.code, receivedAt: match.receivedAt }
          : { accountId, status: 'success', message: 'Đọc mail thành công nhưng chưa thấy verification code phù hợp.', code: null, receivedAt: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const oauthStatus = /token|oauth|mail\.read|401|403/i.test(message) ? 'expired' as const : undefined
        this.repository.updateEmailState(accountId, {
          ...(oauthStatus ? { oauthStatus } : {}),
          mailStatus: oauthStatus ? 'needs_login' : 'error',
          lastCheckAt: Date.now(),
          lastError: message
        })
        this.runtimeStatus.set(accountId, 'error')
        results.push({ accountId, status: 'error', message })
      }
    }
    return { results }
  }

  async checkMail(payload: HotmailBatchPayload): Promise<HotmailBatchResult> {
    const results: HotmailBatchResult['results'] = []
    for (const accountId of uniqueAccountIds(payload)) {
      this.runtimeStatus.set(accountId, 'reading')
      try {
        await this.readMessages(accountId, 1)
        this.repository.updateEmailState(accountId, { oauthStatus: 'valid', mailStatus: 'ready', lastCheckAt: Date.now(), lastError: null })
        this.runtimeStatus.set(accountId, 'idle')
        results.push({ accountId, status: 'success', message: 'Microsoft mailbox Mail.Read hoạt động.' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const oauthStatus = /token|oauth|mail\.read|401|403/i.test(message) ? 'expired' as const : undefined
        this.repository.updateEmailState(accountId, {
          ...(oauthStatus ? { oauthStatus } : {}),
          mailStatus: oauthStatus ? 'needs_login' : 'error',
          lastCheckAt: Date.now(),
          lastError: message
        })
        this.runtimeStatus.set(accountId, 'error')
        results.push({ accountId, status: 'error', message })
      }
    }
    return { results }
  }

  async openMail(accountId: number): Promise<HotmailBrowserOpenResult> {
    const account = this.requireAccount(accountId)
    const settings = this.repository.getProfileSettings()
    this.runtimeStatus.set(accountId, 'opening')
    try {
      const inspection = await inspectEmailProfile(settings.profileRoot, account.uid)
      if (inspection.status === 'not_configured' || inspection.status === 'missing') {
        this.profileInUseUntil.delete(accountId)
        const result = await this.browser.open(account, settings.profileRoot, settings.browserExecutable, null)
        this.runtimeStatus.set(accountId, 'error')
        return result
      }

      const attachedExternally = inspection.status === 'running' && !this.browser.isOpen(accountId)
      const activeAssignment = this.proxyPool.assignment(accountId)
      // Resolve even for a live CDP profile: connectOverCDP may race with browser shutdown,
      // and the worker must have an executable ready for safe relaunch.
      const executable = await this.resolveBrowserExecutable(settings.browserExecutable, settings.profileRoot)
      const proxy = attachedExternally ? null : (activeAssignment ?? this.proxyPool.acquire(accountId))
      const result = await this.browser.open(account, settings.profileRoot, executable, proxy)

      if (proxy && !result.proxyManagedExternally) {
        if (result.status === 'started' || result.status === 'already_open') this.proxyPool.recordSuccess(proxy)
        else if (/proxy/i.test(result.message)) this.proxyPool.recordFailure(proxy)
      }
      if (result.proxyManagedExternally) this.proxyPool.release(accountId)
      if (result.status === 'profile_in_use') this.profileInUseUntil.set(accountId, Date.now() + EMAIL_PROFILE_IN_USE_CACHE_MS)
      else this.profileInUseUntil.delete(accountId)
      if (result.status === 'error' || result.status === 'missing_profile' || result.status === 'profile_in_use') {
        this.proxyPool.release(accountId)
        this.runtimeStatus.set(accountId, 'error')
      } else {
        this.runtimeStatus.set(accountId, 'idle')
      }

      return result
    } catch (error) {
      this.proxyPool.release(accountId)
      this.profileInUseUntil.delete(accountId)
      this.runtimeStatus.set(accountId, 'error')
      return {
        accountId,
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        profileDirectory: null,
        attached: false,
        proxyManagedExternally: false
      }
    }
  }

  getProxyStatus(): HotmailProxyStatus {
    return this.proxyPool.status()
  }

  rotateProxy(): HotmailProxyStatus {
    return this.proxyPool.rotate()
  }

  async testProxy(): Promise<HotmailProxyTestResult> {
    const settings = this.repository.getProfileSettings()
    const proxySettings = this.repository.getProxySettings()
    const proxy = proxySettings.mode === 'direct' ? null : this.proxyPool.peek()
    if (proxySettings.mode === 'random_ipv4' && !proxy) {
      return {
        ok: false,
        proxy: null,
        publicIp: null,
        message: this.proxyPool.cooldownCount() > 0
          ? 'Tất cả proxy Email đang cooldown. Hãy chờ hoặc cập nhật pool rồi kiểm tra lại.'
          : 'Pool Random IPv4 chưa có proxy hợp lệ.'
      }
    }
    const executable = await this.resolveBrowserExecutable(settings.browserExecutable, settings.profileRoot)
    const result = await testEmailProxy(proxy, executable)
    if (proxy) {
      if (result.ok) this.proxyPool.recordSuccess(proxy)
      else this.proxyPool.recordFailure(proxy)
    }
    return result
  }

  dispose(): void {
    this.oauth.dispose()
    this.browser.closeAll()
  }

  private requireAccount(accountId: number) {
    const account = this.accounts.getById(accountId)
    if (!account) throw new Error(`Không tìm thấy account #${accountId}.`)
    return account
  }

  private async readMessages(accountId: number, limit = 25) {
    const state = this.repository.getEmailState(accountId)
    const settings = this.repository.getProfileSettings()
    const clientId = state?.oauthClientId?.trim() ?? ''
    if (!clientId) {
      throw new Error('Account chưa có Microsoft OAuth Client ID trong canonical Email state.')
    }

    const accessToken = await this.oauth.getAccessToken(
      { refreshTokenCiphertext: state?.refreshTokenCiphertext ?? null },
      { clientId, tenant: settings.oauthTenant },
      (refreshTokenCiphertext) => {
        this.repository.updateEmailState(accountId, {
          oauthClientId: clientId,
          refreshTokenCiphertext,
          oauthStatus: 'valid',
          oauthUpdatedAt: Date.now(),
          lastError: null
        })
      }
    )

    this.repository.updateEmailState(accountId, {
      oauthStatus: 'valid',
      lastTokenCheckAt: Date.now(),
      lastError: null
    })
    return this.mail.listRecentMessages(accessToken, limit)
  }
}
