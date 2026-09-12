import type { BrowserContext } from 'playwright-core'
import { emailDiagnostic } from './emailRuntimeDiagnostic'
import { EmailPageRegistry } from './emailPageRegistry'
import {
  createMailboxCodeService,
  type MailboxCodeService,
  type MailboxCodeServiceProviderId
} from './mailboxCodeService'
import type {
  MailProvider,
  MailProviderCodeRequest,
  MailProviderCodeResult,
  MailProviderMessageKeySnapshotRequest,
  MailProviderMessageKeySnapshotResult,
  MailProviderResumeFreshness
} from './mailProvider'
import { MailboxProviderRouter } from './mailboxProviderRouter'
import { resolveMailboxProviderContext } from './mailboxProviderBrowserRuntime'
import {
  createMailboxProviderWorkerRpc,
  type MailboxProviderWorkerRpc
} from './mailboxProviderWorkerRpc'
import {
  createMailtoPlusMailboxRuntime,
  type MailtoPlusMailboxRuntime
} from './mailtoPlusMailboxRuntime'

class MailboxCodeServiceProviderAdapter implements MailProvider {
  readonly resumeFreshness: MailProviderResumeFreshness

  constructor(
    readonly id: MailboxCodeServiceProviderId,
    private readonly service: MailboxCodeService,
    resumeFreshness: MailProviderResumeFreshness
  ) {
    this.resumeFreshness = resumeFreshness
  }

  async snapshotMessageKeys(
    request: MailProviderMessageKeySnapshotRequest
  ): Promise<MailProviderMessageKeySnapshotResult> {
    if (this.id === 'fvia_inboxes') {
      emailDiagnostic('mailbox-provider', 'fvia-snapshot-start', {
        role: request.role,
        purpose: request.purpose
      })
    }
    const result = await this.service.prepareChallengeBaseline({
      mailbox: request.mailbox,
      providerId: this.id
    })
    if (this.id === 'fvia_inboxes') {
      emailDiagnostic('mailbox-provider', 'fvia-snapshot-result', {
        status: result.status,
        messageKeyCount: result.messageKeys.length
      })
    }
    return {
      providerId: result.providerId,
      mailbox: result.mailbox,
      status: result.status,
      messageKeys: result.messageKeys,
      message: result.message
    }
  }

  async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
    if (this.id === 'fvia_inboxes') {
      emailDiagnostic('mailbox-provider', 'fvia-code-start', {
        role: request.role,
        purpose: request.purpose,
        excludedMessageKeyCount: request.excludedMessageKeys?.length ?? 0
      })
    }
    const result = await this.service.getFreshCode({
      mailbox: request.mailbox,
      providerId: this.id,
      challengeId: `router-${this.id}`,
      ...(request.notBefore === undefined ? {} : { notBefore: request.notBefore }),
      consumedMessageKeys: request.excludedMessageKeys ?? [],
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      ...(request.pollIntervalMs === undefined ? {} : { pollIntervalMs: request.pollIntervalMs })
    })
    if (this.id === 'fvia_inboxes') {
      emailDiagnostic('mailbox-provider', 'fvia-code-result', {
        status: result.status,
        hasCode: Boolean(result.code),
        hasMessageKey: Boolean(result.messageKey)
      })
    }
    return {
      providerId: result.providerId,
      mailbox: result.mailbox,
      status: result.status,
      code: result.code,
      sender: result.sender,
      messageKey: result.messageKey,
      message: result.message
    }
  }
}

let mainMailboxProviderRpc: MailboxProviderWorkerRpc | null | undefined

function resolveMainMailboxProviderRpc(): MailboxProviderWorkerRpc | null {
  if (mainMailboxProviderRpc !== undefined) return mainMailboxProviderRpc
  const parentPort = process.parentPort
  if (!parentPort) {
    mainMailboxProviderRpc = null
    return null
  }

  const rpc = createMailboxProviderWorkerRpc((message) => parentPort.postMessage(message))
  parentPort.on('message', (event) => { rpc.handleMessage(event) })
  mainMailboxProviderRpc = rpc
  return rpc
}

/**
 * Production mailbox composition root used by Microsoft Auth.
 *
 * The router sees only MailProvider contracts. Concrete provider/page lifecycle
 * remains behind the registered module adapters. Microsoft/Hotmail mailbox is
 * represented by a provider-neutral worker RPC adapter; OAuth/Graph stays Main-owned.
 */
export function createMailboxProviderRouter(operatorContext: BrowserContext): MailboxProviderRouter {
  const service = createMailboxCodeService(operatorContext)
  const inboxes = new MailboxCodeServiceProviderAdapter('inboxes', service, 'lookback')
  const fvia = new MailboxCodeServiceProviderAdapter('fvia_inboxes', service, 'baseline_current')
  const mainRpc = resolveMainMailboxProviderRpc()
  let mailtoRuntime: MailtoPlusMailboxRuntime | null = null

  const resolveMailtoPlus = async (): Promise<MailProvider | null> => {
    if (mailtoRuntime && !mailtoRuntime.page.isClosed()) return mailtoRuntime.provider

    const providerContext = await resolveMailboxProviderContext(operatorContext)
    if (!providerContext) return null
    const registry = new EmailPageRegistry(providerContext)
    const preferredPage = mailtoRuntime && !mailtoRuntime.page.isClosed()
      ? mailtoRuntime.page
      : null

    mailtoRuntime = await createMailtoPlusMailboxRuntime({
      preferredPage,
      pages: registry.pages('mailbox_provider'),
      createPage: async () => await providerContext.newPage()
    })
    return mailtoRuntime?.provider ?? null
  }

  emailDiagnostic('mailbox-router', 'created', {
    operatorPageCount: operatorContext.pages().length
  })

  return new MailboxProviderRouter([
    {
      providerId: 'microsoft',
      resolve: async (request) => mainRpc?.createProvider('microsoft', request.accountId, 'lookback') ?? null
    },
    { providerId: 'inboxes', resolve: async () => inboxes },
    {
      providerId: 'fvia_inboxes',
      resolve: async (request) => {
        emailDiagnostic('mailbox-router', 'fvia-resolve', {
          accountId: request.accountId,
          operatorPageCount: operatorContext.pages().length
        })
        return fvia
      }
    },
    { providerId: 'mailto_plus', resolve: async () => await resolveMailtoPlus() }
  ])
}
