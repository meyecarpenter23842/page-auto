import type { BrowserContext, Page } from 'playwright-core'
import type { FacebookLocale } from '../../shared/appSettings'
import {
  bootstrapFacebookSession,
  type FacebookSessionAccount,
  type FacebookSessionResult
} from '../browser/facebookSession'
import { getEmailCodeProvider } from '../services/emailCodeProviderRegistry'
import {
  completeFacebookEmailCodeChallenge,
  type FacebookEmailCodeChallengeStatus
} from './facebookEmailCodeChallenge'

export type FacebookEmailSupportFailureCode = Exclude<FacebookEmailCodeChallengeStatus, 'not_applicable' | 'success'>

export type FacebookEmailSupportedBootstrapResult =
  | { status: 'session'; session: FacebookSessionResult }
  | { status: 'email_failure'; code: FacebookEmailSupportFailureCode; message: string }

export async function bootstrapFacebookSessionWithEmailSupport(
  context: BrowserContext,
  page: Page,
  account: FacebookSessionAccount,
  locale: FacebookLocale = 'auto'
): Promise<FacebookEmailSupportedBootstrapResult> {
  let session = await bootstrapFacebookSession(context, page, account, locale)
  if (session.status === 'valid' || session.reason !== 'checkpoint') {
    return { status: 'session', session }
  }

  const emailChallenge = await completeFacebookEmailCodeChallenge(
    page,
    account.id,
    getEmailCodeProvider()
  )
  if (emailChallenge.status === 'not_applicable') return { status: 'session', session }
  if (emailChallenge.status !== 'success') {
    return { status: 'email_failure', code: emailChallenge.status, message: emailChallenge.message }
  }

  // Re-enter the existing Common session state machine after the Email challenge.
  // It remains responsible for TOTP, identity review and final c_user validation.
  session = await bootstrapFacebookSession(context, page, account, locale)
  return { status: 'session', session }
}
