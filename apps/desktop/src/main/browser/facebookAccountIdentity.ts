import type { BrowserContext } from 'playwright-core'

export type FacebookAccountIdentityState = 'match' | 'mismatch' | 'missing' | 'unverifiable'

export interface FacebookAccountIdentityResult {
  state: FacebookAccountIdentityState
  expectedUserId: string | null
  currentUserId: string | null
  message: string
}

export function expectedFacebookUserId(rawUid: string): string | null {
  const normalized = rawUid.trim()
  return /^\d+$/.test(normalized) ? normalized : null
}

export function classifyFacebookAccountIdentity(
  rawExpectedUid: string,
  rawCurrentUserId: string | null | undefined
): FacebookAccountIdentityState {
  const expectedUserId = expectedFacebookUserId(rawExpectedUid)
  if (!expectedUserId) return 'unverifiable'
  const currentUserId = rawCurrentUserId?.trim() || null
  if (!currentUserId) return 'missing'
  return currentUserId === expectedUserId ? 'match' : 'mismatch'
}

export async function inspectFacebookAccountIdentity(
  context: BrowserContext,
  rawExpectedUid: string
): Promise<FacebookAccountIdentityResult> {
  const expectedUserId = expectedFacebookUserId(rawExpectedUid)
  if (!expectedUserId) {
    return {
      state: 'unverifiable',
      expectedUserId: null,
      currentUserId: null,
      message: 'UID account không phải ID số nên không thể đối chiếu c_user; tiếp tục bằng session gate hiện có.'
    }
  }

  const cookies = await context.cookies('https://www.facebook.com')
  const currentUserId = cookies.find((cookie) => cookie.name === 'c_user')?.value?.trim() || null
  const state = classifyFacebookAccountIdentity(expectedUserId, currentUserId)

  if (state === 'match') {
    return {
      state,
      expectedUserId,
      currentUserId,
      message: 'Facebook session khớp đúng UID account cấu hình.'
    }
  }
  if (state === 'missing') {
    return {
      state,
      expectedUserId,
      currentUserId,
      message: 'Không tìm thấy c_user để xác minh đúng account; cần đăng nhập lại trước khi automation tiếp tục.'
    }
  }
  return {
    state,
    expectedUserId,
    currentUserId,
    message: 'Persistent profile/cookie đang đăng nhập Facebook account khác với UID cấu hình; đã chặn automation để tránh thao tác nhầm account.'
  }
}
