import type { Locator, Page } from 'playwright-core'
import {
  isMicrosoftFidoCreateUrl,
  isMicrosoftPasswordChangeUrl,
  isMicrosoftSecurityHubUrl,
  isMicrosoftSignInManagementUrl
} from './microsoftAccountSecurityNavigation'
import { MICROSOFT_SECURITY_URL } from './microsoftSecurityActionEntry'

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    if (await locator.isVisible().catch(() => false)) return locator
  }
  return null
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 12_000 }).catch(() => undefined)
  await page.waitForTimeout(250)
}

export async function navigateToMicrosoftSecurityHub(page: Page): Promise<boolean> {
  if (isMicrosoftFidoCreateUrl(page.url())) return false
  if (isMicrosoftSecurityHubUrl(page.url())) return true

  // Direct stable hub URL first. Microsoft can redirect into auth/recovery when needed.
  await page.goto(MICROSOFT_SECURITY_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  }).catch(() => undefined)
  await settle(page)
  if (isMicrosoftSecurityHubUrl(page.url())) return true

  // If the account home shell intercepted navigation, fall back to its visible Security CTA.
  if (!page.url().toLowerCase().startsWith('https://account.microsoft.com/')) return false
  const security = await firstVisible([
    page.getByRole('link', { name: /^security$/i }).first(),
    page.getByRole('button', { name: /^security$/i }).first(),
    page.getByText(/^security$/i).first()
  ])
  if (!security) return false
  await security.click({ timeout: 8_000 }).catch(() => undefined)
  await settle(page)
  return isMicrosoftSecurityHubUrl(page.url())
}

export async function navigateToManageHowISignIn(page: Page): Promise<boolean> {
  if (isMicrosoftSignInManagementUrl(page.url())) return true
  if (!await navigateToMicrosoftSecurityHub(page)) return false

  const manage = await firstVisible([
    page.getByRole('link', { name: /manage how i sign in/i }).first(),
    page.getByRole('button', { name: /manage how i sign in/i }).first(),
    page.getByText(/manage how i sign in/i).first()
  ])
  if (!manage) return false

  await manage.click({ timeout: 8_000 }).catch(() => undefined)
  await settle(page)
  if (isMicrosoftFidoCreateUrl(page.url())) return false
  return isMicrosoftSignInManagementUrl(page.url())
}

export async function navigateToChangePasswordFromSecurity(page: Page): Promise<boolean> {
  if (isMicrosoftPasswordChangeUrl(page.url())) return true
  if (!await navigateToMicrosoftSecurityHub(page)) return false

  const changePassword = await firstVisible([
    page.getByRole('link', { name: /change password/i }).first(),
    page.getByRole('button', { name: /change password/i }).first(),
    page.getByText(/change password/i).first()
  ])
  if (!changePassword) return false

  await changePassword.click({ timeout: 8_000 }).catch(() => undefined)
  await settle(page)
  if (isMicrosoftFidoCreateUrl(page.url())) return false
  return isMicrosoftPasswordChangeUrl(page.url())
}
