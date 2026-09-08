import type { BrowserContext, Page } from 'playwright-core'
import type { EmailPageRole } from './emailAuthV2Contracts'
import { classifyMicrosoftRoute } from './emailLoginPolicy'

const MAILBOX_PROVIDER_HOSTS = new Set([
  'inboxes.com',
  'www.inboxes.com',
  'fviainboxes.com',
  'www.fviainboxes.com',
  'tempmail.plus',
  'www.tempmail.plus'
])

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function classifyEmailPageUrl(value: string): EmailPageRole {
  const route = classifyMicrosoftRoute(value)
  if (route === 'outlook_mail') return 'outlook_mail'
  if (route === 'outlook_landing' || route === 'account_live' || route === 'login_oauth' || route === 'login') {
    return 'microsoft_auth'
  }

  const hostname = hostnameOf(value)
  if (!hostname) return 'unrelated'
  if (hostname === 'microsoft.com' || hostname.endsWith('.microsoft.com')) return 'microsoft_auth'
  if (MAILBOX_PROVIDER_HOSTS.has(hostname)) return 'mailbox_provider'
  return 'unrelated'
}

export interface EmailPageRegistrySnapshot {
  microsoftAuth: readonly Page[]
  outlookMail: readonly Page[]
  mailboxProvider: readonly Page[]
  unrelated: readonly Page[]
}

/**
 * Resolves browser pages by explicit role evidence instead of tab index.
 *
 * The registry deliberately does not own navigation or cleanup. Callers decide
 * whether an existing role-matching page can be reused for a target, while the
 * registry guarantees that a mailbox/operator page is never selected merely
 * because it happens to be context.pages()[0].
 */
export class EmailPageRegistry {
  constructor(private readonly context: BrowserContext) {}

  roleOf(page: Page): EmailPageRole {
    if (page.isClosed()) return 'unrelated'
    return classifyEmailPageUrl(page.url())
  }

  pages(role: EmailPageRole): Page[] {
    return this.context.pages().filter((page) => !page.isClosed() && this.roleOf(page) === role)
  }

  snapshot(): EmailPageRegistrySnapshot {
    return {
      microsoftAuth: this.pages('microsoft_auth'),
      outlookMail: this.pages('outlook_mail'),
      mailboxProvider: this.pages('mailbox_provider'),
      unrelated: this.pages('unrelated')
    }
  }

  newest(role: EmailPageRole, predicate?: (page: Page) => boolean): Page | null {
    const candidates = this.pages(role)
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index]
      if (candidate && (!predicate || predicate(candidate))) return candidate
    }
    return null
  }

  newestMicrosoft(predicate?: (page: Page) => boolean): Page | null {
    const pages = this.context.pages()
    for (let index = pages.length - 1; index >= 0; index -= 1) {
      const candidate = pages[index]
      if (!candidate || candidate.isClosed()) continue
      const role = this.roleOf(candidate)
      if (role !== 'microsoft_auth' && role !== 'outlook_mail') continue
      if (!predicate || predicate(candidate)) return candidate
    }
    return null
  }

  async resolveOrCreate(role: 'microsoft_auth' | 'outlook_mail', predicate?: (page: Page) => boolean): Promise<Page> {
    return this.newest(role, predicate) ?? await this.context.newPage()
  }

  async resolveMicrosoftActionPage(predicate?: (page: Page) => boolean): Promise<Page> {
    return this.newestMicrosoft(predicate)
      ?? this.newestMicrosoft()
      ?? await this.context.newPage()
  }
}
