import type { AccountRecord } from '../../shared/accounts'
import type { AccountRepository } from '../database/accountRepository'
import type { HotmailRepository } from '../database/hotmailRepository'
import { classifyEmailCodeReadError } from './canonicalEmailCodeProvider'
import type { EmailSecretCipher } from './emailSecretStore'
import { normalizeMailboxAddress } from './mailProvider'
import {
  mailboxProviderUnavailableResponse,
  mailboxProviderWorkerResponse,
  type MailboxProviderWorkerRequestHandler,
  type MailboxProviderWorkerRequestMessage
} from './mailboxProviderWorkerRpc'
import { MicrosoftGraphMailAdapter } from './microsoftGraphMailAdapter'
import { MicrosoftMailboxProvider } from './microsoftMailboxProvider'
import { MicrosoftOAuthService } from './microsoftOAuthService'

export type MicrosoftMailboxOwnerResolution =
  | { status: 'resolved'; account: AccountRecord }
  | { status: 'mailbox_not_found'; message: string }
  | { status: 'provider_unavailable'; message: string }

/**
 * Bind a requested Hotmail/Outlook mailbox to the canonical Account Manager row
 * that owns its OAuth state. Never borrow OAuth from the current auth account
 * when its primary Email is a different mailbox.
 */
export function resolveMicrosoftMailboxOwner(
  accounts: Pick<AccountRepository, 'getById' | 'list'>,
  requesterAccountId: number,
  requestedMailbox: string
): MicrosoftMailboxOwnerResolution {
  const mailbox = normalizeMailboxAddress(requestedMailbox)
  if (!mailbox) {
    return { status: 'mailbox_not_found', message: 'Microsoft mailbox không hợp lệ.' }
  }

  const preferred = Number.isInteger(requesterAccountId) && requesterAccountId > 0
    ? accounts.getById(requesterAccountId)
    : null
  if (preferred && normalizeMailboxAddress(preferred.email ?? '') === mailbox) {
    return { status: 'resolved', account: preferred }
  }

  const matches = accounts
    .list({ search: mailbox })
    .filter((account) => normalizeMailboxAddress(account.email ?? '') === mailbox)
  const unique = [...new Map(matches.map((account) => [account.id, account])).values()]

  if (unique.length === 0) {
    return {
      status: 'mailbox_not_found',
      message: 'Mail KP Hotmail/Outlook chưa có canonical account Email khớp mailbox để dùng OAuth.'
    }
  }
  if (unique.length > 1) {
    return {
      status: 'provider_unavailable',
      message: 'Có nhiều account cùng bind một Hotmail/Outlook mailbox; không thể chọn OAuth owner an toàn.'
    }
  }
  return { status: 'resolved', account: unique[0]! }
}

export interface MicrosoftMailboxRuntime {
  handleWorkerRequest: MailboxProviderWorkerRequestHandler
  dispose: () => void
}

function providerFailureResponse(
  request: MailboxProviderWorkerRequestMessage,
  status: 'mailbox_not_found' | 'provider_unavailable',
  message: string
) {
  const response = mailboxProviderUnavailableResponse(request, message)
  return {
    ...response,
    result: {
      ...response.result,
      status
    }
  } as typeof response
}

/**
 * Main-owned Microsoft mailbox runtime. OAuth refresh tokens, DB state and Graph
 * access never cross into the Email browser worker; the worker sees only typed
 * mailbox-provider RPC requests/results.
 */
export function createMicrosoftMailboxRuntime(
  accounts: AccountRepository,
  repository: HotmailRepository,
  cipher: EmailSecretCipher
): MicrosoftMailboxRuntime {
  const oauth = new MicrosoftOAuthService(cipher)
  const graph = new MicrosoftGraphMailAdapter()

  const readMessages = async (accountId: number, limit: number) => {
    const state = repository.getEmailState(accountId)
    const clientId = state?.oauthClientId?.trim() ?? ''
    if (!state || state.provider !== 'microsoft' || !clientId || !state.refreshTokenCiphertext) {
      repository.updateEmailState(accountId, {
        provider: 'microsoft',
        mailStatus: 'needs_login',
        lastCheckAt: Date.now(),
        lastError: 'Microsoft mailbox OAuth chưa sẵn sàng.'
      })
      throw new Error('Microsoft OAuth token missing.')
    }

    try {
      const settings = repository.getProfileSettings()
      const accessToken = await oauth.getAccessToken(
        { refreshTokenCiphertext: state.refreshTokenCiphertext },
        { clientId, tenant: settings.oauthTenant },
        (refreshTokenCiphertext) => {
          repository.updateEmailState(accountId, {
            provider: 'microsoft',
            oauthClientId: clientId,
            refreshTokenCiphertext,
            oauthStatus: 'valid',
            oauthUpdatedAt: Date.now(),
            lastError: null
          })
        }
      )
      repository.updateEmailState(accountId, {
        provider: 'microsoft',
        oauthStatus: 'valid',
        mailStatus: 'ready',
        lastTokenCheckAt: Date.now(),
        lastCheckAt: Date.now(),
        lastError: null
      })
      return await graph.listRecentMessages(accessToken, limit)
    } catch (error) {
      const status = classifyEmailCodeReadError(error)
      repository.updateEmailState(accountId, status === 'email_auth_expired'
        ? {
            provider: 'microsoft',
            oauthStatus: 'expired',
            mailStatus: 'needs_login',
            lastCheckAt: Date.now(),
            lastError: 'Microsoft OAuth cần kết nối lại.'
          }
        : {
            provider: 'microsoft',
            mailStatus: 'error',
            lastCheckAt: Date.now(),
            lastError: 'Microsoft mailbox không đọc được bằng Graph.'
          })
      throw error
    }
  }

  const handleWorkerRequest: MailboxProviderWorkerRequestHandler = async (request) => {
    if (request.providerId !== 'microsoft') {
      return mailboxProviderUnavailableResponse(request, `Main mailbox bridge không sở hữu provider ${request.providerId}.`)
    }

    const owner = resolveMicrosoftMailboxOwner(accounts, request.accountId, request.request.mailbox)
    if (owner.status !== 'resolved') {
      return providerFailureResponse(request, owner.status, owner.message)
    }

    const mailbox = normalizeMailboxAddress(request.request.mailbox)
    if (!mailbox) return providerFailureResponse(request, 'mailbox_not_found', 'Microsoft mailbox không hợp lệ.')

    const provider = new MicrosoftMailboxProvider({
      mailbox,
      readMessages: async (limit) => await readMessages(owner.account.id, limit)
    })

    if (request.operation === 'get_verification_code') {
      const result = await provider.getVerificationCode(request.request)
      return mailboxProviderWorkerResponse(request, result)
    }
    const result = await provider.snapshotMessageKeys!(request.request)
    return mailboxProviderWorkerResponse(request, result)
  }

  return {
    handleWorkerRequest,
    dispose: () => oauth.dispose()
  }
}
