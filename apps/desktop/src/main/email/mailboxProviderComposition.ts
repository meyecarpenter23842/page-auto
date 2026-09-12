import type { BrowserContext } from 'playwright-core'
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
    const result = await this.service.prepareChallengeBaseline({
      mailbox: request.mailbox,
      providerId: this.id
    })
    return {
      providerId: result.providerId,
      mailbox: result.mailbox,
      status: result.status,
      messageKeys: result.messageKeys,
      message: result.message
    }
  }

  async getVerificationCode(request: MailProviderCodeRequest): Promise<MailProviderCodeResult> {
    const result = await this.service.getFreshCode({
      mailbox: request.mailbox,
      providerId: this.id,
      challengeId: `router-${this.id}`,
      ...(request.notBefore === undefined ? {} : { notBefore: request.notBefore }),
      consumedMessageKeys: request.excludedMessageKeys ?? [],
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      ...(request.pollIntervalMs === undefined ? {} : { pollIntervalMs: request.pollIntervalMs })
    })
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

/**
 * Production mailbox composition root used by Microsoft Auth.
 *
 * The router sees only MailProvider contracts. Concrete provider/page lifecycle
 * remains behind the registered module adapters. Microsoft/Hotmail mailbox is
 * intentionally not registered until E-MOD-5.
 */
export function createMailboxProviderRouter(operatorContext: BrowserContext): MailboxProviderRouter {
  const service = createMailboxCodeService(operatorContext)
  const inboxes = new MailboxCodeServiceProviderAdapter('inboxes', service, 'lookback')
  const fvia = new MailboxCodeServiceProviderAdapter('fvia_inboxes', service, 'baseline_current')
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

  return new MailboxProviderRouter([
    { providerId: 'inboxes', resolve: async () => inboxes },
    { providerId: 'fvia_inboxes', resolve: async () => fvia },
    { providerId: 'mailto_plus', resolve: async () => await resolveMailtoPlus() }
  ])
}
