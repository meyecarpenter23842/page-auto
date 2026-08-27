import type { HotmailActionStatus, HotmailNeedsAttentionReason } from '../../shared/hotmail'

export type MicrosoftLoginSurface =
  | 'authenticated'
  | 'stay_signed_in'
  | 'outlook_landing'
  | 'oauth_authorize'
  | 'username'
  | 'password'
  | 'password_change'
  | 'credential_error'
  | 'identity_review'
  | 'security_review'
  | 'manual_login'

export interface MicrosoftLoginSnapshot {
  url: string
  text: string
  emailInputCount: number
  passwordInputCount: number
}

export type EmailAuthResumeKind = 'recovery-result' | 'password-result'

export function classifyMicrosoftLoginSurface(snapshot: MicrosoftLoginSnapshot): MicrosoftLoginSurface {
  const url = snapshot.url.toLowerCase()
  const text = snapshot.text.toLowerCase()

  if (/verify your identity|confirm your identity|identity verification|xác minh danh tính/.test(text)) {
    return 'identity_review'
  }
  if (/enter.*code|security code|verification code|two[- ]step|two[- ]factor|approve.*sign.?in|authenticator|help us protect|xác minh bảo mật|mã bảo mật|trình xác thực|phê duyệt.*đăng nhập/.test(text)) {
    return 'security_review'
  }
  if (/account or password is incorrect|password is incorrect|incorrect password|we couldn.?t find an account|microsoft account doesn.?t exist|enter a valid email|tài khoản hoặc mật khẩu.*không đúng|mật khẩu.*không đúng|tài khoản.*không tồn tại/.test(text)) {
    return 'credential_error'
  }
  if (/stay signed in|remain signed in|duy trì đăng nhập|giữ trạng thái đăng nhập/.test(text)) {
    return 'stay_signed_in'
  }
  if (/account\.live\.com\/(client\/)?password\/change/.test(url)
    || /change your password|new password|reenter password|password expired|update your password|đổi mật khẩu|mật khẩu mới|nhập lại mật khẩu|mật khẩu.*hết hạn/.test(text)) {
    return 'password_change'
  }
  if (snapshot.passwordInputCount > 0) return 'password'
  if (snapshot.emailInputCount > 0) return 'username'
  if (/microsoft\.com\/[^?#]*\/microsoft-365\/outlook\/email-and-calendar-software-microsoft-outlook/.test(url)
    && /sign in|open outlook/.test(text)) {
    return 'outlook_landing'
  }
  if (/login\.microsoftonline\.com\/[^/?#]+\/oauth2\/v2\.0\/authorize(?:[?#]|$)/.test(url)) {
    return 'oauth_authorize'
  }
  if (/login\.live\.com|signin|oauth20_authorize/.test(url) || /sign in|đăng nhập|enter your email|email, phone, or skype/.test(text)) {
    return 'manual_login'
  }
  if (/outlook\.live\.com\/(mail|owa)(\/|$)/.test(url) || /account\.live\.com(\/|$)/.test(url)) {
    return 'authenticated'
  }
  return 'manual_login'
}

export function nextEmailAuthResumeKind(
  kind: EmailAuthResumeKind,
  status: HotmailActionStatus,
  reason: HotmailNeedsAttentionReason | undefined
): EmailAuthResumeKind | null {
  return status === 'needs_attention' && reason !== undefined && reason !== 'manual_completion_required'
    ? kind
    : null
}

export function shouldResumeEmailActionAfterAuth(
  pendingKind: EmailAuthResumeKind | null,
  requestedKind: EmailAuthResumeKind,
  confirmCompleted: boolean
): boolean {
  return confirmCompleted && pendingKind === requestedKind
}
