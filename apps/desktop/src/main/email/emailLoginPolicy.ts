import type { HotmailActionStatus, HotmailNeedsAttentionReason } from '../../shared/hotmail'

export type MicrosoftLoginSurface =
  | 'authenticated'
  | 'stay_signed_in'
  | 'outlook_landing'
  | 'outlook_transition'
  | 'login_transition'
  | 'oauth_authorize'
  | 'account_picker'
  | 'username'
  | 'password_method_choice'
  | 'password'
  | 'password_change'
  | 'credential_error'
  | 'identity_review'
  | 'security_review'
  | 'manual_login'

export type MicrosoftRoute =
  | 'outlook_mail'
  | 'outlook_landing'
  | 'account_live'
  | 'login_oauth'
  | 'login'
  | 'other'

export interface MicrosoftLoginSnapshot {
  url: string
  text: string
  emailInputCount: number
  passwordInputCount: number
  /** Exact Microsoft username/login field markers such as input[name="loginfmt"]. */
  usernameInputCount?: number
  /** Visible email/recovery proof fields that are not the canonical Microsoft username/login field. */
  proofEmailInputCount?: number
  /** OTP/security-code style inputs. */
  verificationCodeInputCount?: number
  /** Structured account-picker control marker. */
  useAnotherAccountControlCount?: number
  /** Structured recovery/security proof controls. */
  sendCodeControlCount?: number
  usePasswordControlCount?: number
}

export type EmailAuthResumeKind = 'recovery-result' | 'password-result'

export function microsoftAccountPickerEntryMatchesCanonicalEmail(entryText: string, canonicalEmail: string): boolean {
  const email = canonicalEmail.trim().toLowerCase()
  if (!email) return false

  const normalizedText = entryText.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalizedText) return false

  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9._%+@-])${escapedEmail}($|[^a-z0-9._%+@-])`, 'i').test(normalizedText)
}

export function classifyMicrosoftRoute(value: string): MicrosoftRoute {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const path = url.pathname.toLowerCase()

    if (host === 'outlook.live.com' && /^\/(mail|owa)(\/|$)/.test(path)) return 'outlook_mail'
    if ((host === 'microsoft.com' || host.endsWith('.microsoft.com'))
      && /\/microsoft-365\/outlook\/email-and-calendar-software-microsoft-outlook(?:\/|$)/.test(path)) {
      return 'outlook_landing'
    }
    if (host === 'account.live.com') return 'account_live'
    if (host === 'login.live.com' && path === '/oauth20_authorize.srf') return 'login_oauth'
    if (host === 'login.microsoftonline.com' && /\/oauth2\/v2\.0\/authorize(?:\/|$)/.test(path)) return 'login_oauth'
    if (host === 'login.live.com' || host === 'login.microsoftonline.com') return 'login'
    return 'other'
  } catch {
    return 'other'
  }
}

export function classifyMicrosoftLoginSurface(snapshot: MicrosoftLoginSnapshot): MicrosoftLoginSurface {
  const route = classifyMicrosoftRoute(snapshot.url)
  const url = snapshot.url.toLowerCase()
  const text = snapshot.text.toLowerCase()
  const usernameInputCount = snapshot.usernameInputCount ?? snapshot.emailInputCount
  const proofEmailInputCount = snapshot.proofEmailInputCount ?? 0
  const verificationCodeInputCount = snapshot.verificationCodeInputCount ?? 0
  const useAnotherAccountControlCount = snapshot.useAnotherAccountControlCount ?? 0
  const sendCodeControlCount = snapshot.sendCodeControlCount ?? 0
  const usePasswordControlCount = snapshot.usePasswordControlCount ?? 0

  if (/verify your identity|confirm your identity|identity verification|xác minh danh tính/.test(text)) {
    return 'identity_review'
  }

  if (/enter a valid email address|enter a valid email|valid email address, phone number, or skype/i.test(text)) {
    return usernameInputCount > 0 ? 'username' : 'credential_error'
  }
  if (/account or password is incorrect|password is incorrect|incorrect password|we couldn.?t find an account|microsoft account doesn.?t exist|tài khoản hoặc mật khẩu.*không đúng|mật khẩu.*không đúng|tài khoản.*không tồn tại/.test(text)) {
    return 'credential_error'
  }
  if (/stay signed in|remain signed in|duy trì đăng nhập|giữ trạng thái đăng nhập/.test(text)) {
    return 'stay_signed_in'
  }
  if ((route === 'account_live' && /account\.live\.com\/(client\/)?password\/change/.test(url))
    || /change your password|new password|reenter password|password expired|update your password|đổi mật khẩu|mật khẩu mới|nhập lại mật khẩu|mật khẩu.*hết hạn/.test(text)) {
    return 'password_change'
  }

  // An actual code/OTP input is always a security challenge. Do not auto-bypass it.
  if (verificationCodeInputCount > 0) return 'security_review'

  // Structured credential fields take priority over nearby fallback/security links.
  // Microsoft can render “Send a code to …” next to the normal password form.
  if (snapshot.passwordInputCount > 0) return 'password'
  if (usernameInputCount > 0) return 'username'

  const recoveryEmailProofCopy = /verify your email|we(?:'|’)ll send a code|we will send a code|send code|already received a code|xác minh email|gửi mã/.test(text)

  // The live consumer OAuth flow can ask for recovery proof while offering “Use your password”.
  // The recovery input is not guaranteed to stay input[type=email], so the method-choice decision
  // uses the structured password control plus any independent proof evidence instead of one tag shape.
  const hasRecoveryProofEvidence = proofEmailInputCount > 0 || sendCodeControlCount > 0 || recoveryEmailProofCopy
  if (usePasswordControlCount > 0 && hasRecoveryProofEvidence) {
    return 'password_method_choice'
  }

  const structuredSecurityProof = proofEmailInputCount > 0 && sendCodeControlCount > 0
  const knownSecurityCopy = /enter.*code|security code|verification code|two[- ]step|two[- ]factor|approve.*sign.?in|authenticator|help us protect|xác minh bảo mật|mã bảo mật|trình xác thực|phê duyệt.*đăng nhập/.test(text)

  if (structuredSecurityProof || knownSecurityCopy || ((route === 'login_oauth' || route === 'login') && recoveryEmailProofCopy)) {
    return 'security_review'
  }

  if (route === 'outlook_landing') return 'outlook_landing'
  if (route === 'outlook_mail') {
    if (/outlook\.live\.com\/mail\/0\/(?:inbox|sentitems|drafts|junkemail|archive|deleteditems|id\/)/.test(url)
      || /inbox|new mail|sent items|drafts|junk email|focused|hộp thư đến|thư mới|mục đã gửi|bản nháp|thư rác|ưu tiên/.test(text)) {
      return 'authenticated'
    }
    return 'outlook_transition'
  }

  if (route === 'login_oauth') {
    if (useAnotherAccountControlCount > 0) return 'account_picker'
    return 'oauth_authorize'
  }
  if (route === 'login') return 'login_transition'

  if (/signin/.test(url) || /sign in|đăng nhập|enter your email|email, phone, or skype/.test(text)) {
    return 'manual_login'
  }
  if (route === 'account_live') return 'authenticated'
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
