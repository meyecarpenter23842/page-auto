import type { BrowserContext, Page } from 'playwright-core'
import type { BrowserSettings } from '../../shared/appSettings'
import type { PostingJobResult } from '../../shared/posting'
import { inspectFacebookAccountIdentity } from './facebookAccountIdentity'
import { activeFacebookProfileId, detectFacebookAccessBlock } from './posting/pageState'

export type FacebookProfileActorState = 'profile' | 'page'

export function classifyFacebookProfileActor(activeProfileId: string | null | undefined): FacebookProfileActorState {
  return activeProfileId?.trim() ? 'page' : 'profile'
}

function failure(
  code: 'needs_login' | 'verification_required' | 'page_navigation_failed' | 'profile_identity_unconfirmed',
  message: string
): PostingJobResult {
  return {
    status: code === 'needs_login' || code === 'verification_required' ? 'needs_login' : 'failed',
    code,
    message
  }
}

async function serializedFacebookCookies(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies('https://www.facebook.com').catch(() => [])
  const values = cookies
    .filter((cookie) => cookie.domain.endsWith('facebook.com'))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
  return values.length ? values.join('; ') : null
}

async function success(context: BrowserContext, message: string): Promise<PostingJobResult> {
  const sessionCookie = await serializedFacebookCookies(context)
  return {
    status: 'success',
    message,
    ...(sessionCookie ? { sessionCookie } : {})
  }
}

async function accessFailure(page: Page): Promise<PostingJobResult | null> {
  const state = await detectFacebookAccessBlock(page)
  if (state === 'login_required') {
    return failure('needs_login', 'Facebook yêu cầu đăng nhập lại trong lúc khôi phục actor Profile.')
  }
  if (state === 'verification_required') {
    return failure('verification_required', 'Facebook yêu cầu checkpoint/khóa/xác minh thủ công; không chạy action Profile.')
  }
  return null
}

/**
 * Make the persistent Facebook context act as the personal Profile again.
 * c_user proves which account owns the session; i_user proves whether that
 * account is currently impersonating/switching into a Page identity.
 */
export async function ensureFacebookProfileIdentity(
  context: BrowserContext,
  page: Page,
  browser: BrowserSettings,
  expectedAccountUid: string
): Promise<PostingJobResult> {
  const accountIdentity = await inspectFacebookAccountIdentity(context, expectedAccountUid)
  if (accountIdentity.state === 'mismatch' || accountIdentity.state === 'missing') {
    return failure('needs_login', accountIdentity.message)
  }

  // A c_user cookie may still exist on locked/disabled/checkpoint surfaces. Access state
  // must therefore be checked before accepting an apparently-correct Profile actor.
  const initialBlock = await accessFailure(page)
  if (initialBlock) return initialBlock

  const actingProfileId = await activeFacebookProfileId(context).catch(() => null)
  if (classifyFacebookProfileActor(actingProfileId) === 'profile') {
    return success(context, 'Actor Profile đã đúng; không có i_user Page đang active.')
  }

  try {
    await context.clearCookies({ name: 'i_user' })
  } catch (error) {
    return failure(
      'profile_identity_unconfirmed',
      `Không xóa được trạng thái Page i_user trước khi chạy Profile: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  try {
    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: browser.navigationTimeoutMs
    })
    if (browser.pageSettleDelayMs > 0) await page.waitForTimeout(browser.pageSettleDelayMs)
  } catch (error) {
    return failure(
      'page_navigation_failed',
      `Không mở được Facebook Home sau khi khôi phục Profile: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const blocked = await accessFailure(page)
  if (blocked) return blocked

  const restoredAccountIdentity = await inspectFacebookAccountIdentity(context, expectedAccountUid)
  if (restoredAccountIdentity.state === 'mismatch' || restoredAccountIdentity.state === 'missing') {
    return failure('needs_login', restoredAccountIdentity.message)
  }

  const restoredActingProfileId = await activeFacebookProfileId(context).catch(() => null)
  if (classifyFacebookProfileActor(restoredActingProfileId) !== 'profile') {
    return failure(
      'profile_identity_unconfirmed',
      'Đã yêu cầu về Profile nhưng i_user Page vẫn còn active; không chạy action để tránh đăng nhầm actor.'
    )
  }

  return success(context, 'Đã khôi phục actor Profile và xác minh i_user Page không còn active.')
}
