import type { BrowserContext, Page } from 'playwright-core'
import { EmailPageRegistry } from './emailPageRegistry'

export const MICROSOFT_ACCOUNT_HOME_URL =
  'https://account.microsoft.com/?ref=MeControl&refd=account.microsoft.com'

export const MICROSOFT_SECURITY_URL = 'https://account.microsoft.com/security'

export function isMicrosoftAccountHubUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === 'account.microsoft.com'
  } catch {
    return false
  }
}

export function isMicrosoftSecurityAuthResumeUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host === 'outlook.live.com') return false
    if (host === 'account.microsoft.com') return false
    return host === 'login.live.com'
      || host === 'login.microsoftonline.com'
      || host === 'login.microsoft.com'
      || host === 'account.live.com'
  } catch {
    return false
  }
}

export function findExistingMicrosoftSecurityAuthPage(context: BrowserContext): Page | null {
  const pages = [...context.pages()].reverse()
  return pages.find((page) => !page.isClosed() && isMicrosoftSecurityAuthResumeUrl(page.url())) ?? null
}

export async function openMicrosoftAccountHome(context: BrowserContext): Promise<Page> {
  const page = await new EmailPageRegistry(context).resolveOrCreate(
    'microsoft_auth',
    (candidate) => {
      try {
        return isMicrosoftAccountHubUrl(candidate.url())
      } catch {
        return false
      }
    }
  )
  await page.goto(MICROSOFT_ACCOUNT_HOME_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  })
  await page.bringToFront().catch(() => undefined)
  return page
}
