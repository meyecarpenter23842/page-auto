import type { MailProviderId } from './mailProvider'

/**
 * Issue #347 Batch 0 contract only.
 *
 * These states are intentionally not wired into the production auth loop yet.
 * Batch 1+ must migrate the runtime to this contract without assuming a linear
 * Microsoft sequence.
 */
export const EMAIL_AUTH_V2_SURFACES = [
  'authenticated',
  'outlook_landing',
  'outlook_transition',
  'login_transition',
  'oauth_authorize',
  'account_picker',
  'username',
  'password_method_choice',
  'password',
  'password_change',
  'stay_signed_in',
  'passkey_prompt',
  'sign_in_continue',
  'recovery_method_choice',
  'recovery_email_confirmation',
  'recovery_code',
  'credential_error',
  'identity_review',
  'security_review',
  'manual_login'
] as const

export type EmailAuthV2Surface = (typeof EMAIL_AUTH_V2_SURFACES)[number]

export const EMAIL_AUTH_V2_HANDLER_RESULT_KINDS = [
  'handled',
  'retryable',
  'needs_attention',
  'authenticated'
] as const

export type EmailAuthV2HandlerResultKind = (typeof EMAIL_AUTH_V2_HANDLER_RESULT_KINDS)[number]

export const EMAIL_AUTH_V2_RESULT_SEMANTICS = {
  handled: { terminal: false, mustDetectAgain: true },
  retryable: { terminal: false, mustDetectAgain: true },
  needs_attention: { terminal: true, mustDetectAgain: false },
  authenticated: { terminal: true, mustDetectAgain: false }
} as const satisfies Record<EmailAuthV2HandlerResultKind, {
  terminal: boolean
  mustDetectAgain: boolean
}>

export type EmailAuthV2HandlerResult =
  | { kind: 'handled' }
  | { kind: 'retryable'; reason: string }
  | { kind: 'needs_attention'; reason: string }
  | { kind: 'authenticated' }

export const EMAIL_PAGE_ROLES = [
  'microsoft_auth',
  'outlook_mail',
  'mailbox_provider',
  'unrelated'
] as const

export type EmailPageRole = (typeof EMAIL_PAGE_ROLES)[number]

export const MAILBOX_CODE_SURFACES = [
  'provider_closed',
  'provider_unavailable',
  'overlay_blocking',
  'home',
  'add_inbox_dialog',
  'mailbox_ready_expected',
  'mailbox_ready_other',
  'message_list',
  'message_detail_expected',
  'message_detail_other'
] as const

export type MailboxCodeSurface = (typeof MAILBOX_CODE_SURFACES)[number]

/**
 * Recovery-round metadata that must survive re-detection of Microsoft states.
 * Do not add plaintext PassEmail or plaintext verification codes here.
 */
export interface EmailRecoveryRoundContract {
  challengeId: string
  mailbox: string
  providerId: MailProviderId | null
  requestedAt: number | null
  /** Message identity present before Send code; authority preventing old mail from entering this round. */
  baselineMessageKeys: readonly string[]
  /** Message identity already consumed/submitted in this auth recovery session/round. */
  consumedMessageKeys: readonly string[]
  lastSubmittedMessageKey: string | null
  lastSubmittedCodeFingerprint: string | null
  submitAttempts: number
}

export const EMAIL_AUTH_V2_REQUIRED_HANDLER_KEYS = [
  'username',
  'password',
  'account_picker',
  'stay_signed_in',
  'passkey_prompt',
  'sign_in_continue',
  'recovery_method_choice',
  'recovery_email_confirmation',
  'recovery_code',
  'authenticated'
] as const satisfies readonly EmailAuthV2Surface[]
