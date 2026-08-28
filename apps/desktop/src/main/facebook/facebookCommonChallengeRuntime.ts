import type { BrowserContext, Page } from 'playwright-core'
import type { FacebookLocale } from '../../shared/appSettings'
import type { EmailCodeProvider } from '../../shared/emailCode'
import type {
  FacebookCheckpoint282State,
  FacebookCommonChallengeType
} from '../../shared/facebookCheckpoint'
import type { PostingCheckpointKind } from '../../shared/posting'
import {
  facebookCheckpoint282IdentityAccepted
} from '../browser/facebookCheckpoint282'
import {
  inspectFacebookAccountIdentity,
  type FacebookAccountIdentityResult
} from '../browser/facebookAccountIdentity'
import {
  bootstrapFacebookSession,
  type FacebookSessionAccount,
  type FacebookSessionResult
} from '../browser/facebookSession'
import {
  inspectFacebookCommonChallenge,
  type FacebookCommonChallengeClassification
} from '../browser/posting/facebookCheckpoint'
import {
  completeFacebookEmailCodeChallenge,
  type FacebookEmailCodeChallengeResult
} from './facebookEmailCodeChallenge'

export interface FacebookCommonChallengeRunResult {
  state: FacebookCheckpoint282State
  challengeType: FacebookCommonChallengeType
  checkpointKind?: PostingCheckpointKind
  message: string
}

export interface FacebookCommonChallengeRuntimeInput {
  context: BrowserContext
  page: Page
  account: FacebookSessionAccount
  locale: FacebookLocale
  emailCodeProvider: EmailCodeProvider | null
}

export interface FacebookCommonChallengeRuntimeDependencies {
  inspectChallenge: (page: Page) => Promise<FacebookCommonChallengeClassification>
  inspectIdentity: (context: BrowserContext, uid: string) => Promise<FacebookAccountIdentityResult>
  bootstrapSession: (
    context: BrowserContext,
    page: Page,
    account: FacebookSessionAccount,
    locale: FacebookLocale
  ) => Promise<FacebookSessionResult>
  completeEmailChallenge: (
    page: Page,
    accountId: number,
    provider: EmailCodeProvider | null,
    observedAt?: number
  ) => Promise<FacebookEmailCodeChallengeResult>
}

const defaultDependencies: FacebookCommonChallengeRuntimeDependencies = {
  inspectChallenge: inspectFacebookCommonChallenge,
  inspectIdentity: inspectFacebookAccountIdentity,
  bootstrapSession: bootstrapFacebookSession,
  completeEmailChallenge: completeFacebookEmailCodeChallenge
}

function withClassification(
  classification: FacebookCommonChallengeClassification,
  state: FacebookCheckpoint282State,
  message: string
): FacebookCommonChallengeRunResult {
  return {
    state,
    challengeType: classification.type,
    ...(classification.checkpointKind ? { checkpointKind: classification.checkpointKind } : {}),
    message
  }
}

function manualClassificationResult(
  classification: FacebookCommonChallengeClassification,
  fallbackMessage?: string
): FacebookCommonChallengeRunResult {
  switch (classification.type) {
    case 'email_code_challenge':
      return withClassification(
        classification,
        'waiting',
        fallbackMessage ?? 'Facebook đang chờ mã Email; giữ live challenge để Email Support hoặc operator xử lý.'
      )
    case 'totp_2fa_challenge':
      return withClassification(
        classification,
        'needs_login',
        fallbackMessage ?? 'Facebook vẫn đang chờ mã 2FA sau continuation an toàn; cần kiểm tra dữ liệu 2FA của account.'
      )
    case 'login_reauth':
      return withClassification(
        classification,
        'needs_login',
        fallbackMessage ?? 'Facebook vẫn yêu cầu đăng nhập lại; cần kiểm tra credential của chính account.'
      )
    case 'identity_verification_required':
      return withClassification(
        classification,
        'needs_attention',
        fallbackMessage ?? 'Facebook yêu cầu xác minh danh tính. PAGE-AUTO dừng automation tại account này và không bypass.'
      )
    case 'security_review_required':
      return withClassification(
        classification,
        'needs_attention',
        fallbackMessage ?? 'Facebook yêu cầu security review. PAGE-AUTO dừng automation tại account này và không bypass.'
      )
    case 'unsupported_checkpoint':
      return withClassification(
        classification,
        'needs_attention',
        fallbackMessage ?? 'Facebook đang ở challenge chưa được Common Runtime hỗ trợ; cần operator kiểm tra.'
      )
    case 'checkpoint_cleared':
      return withClassification(
        classification,
        'needs_login',
        fallbackMessage ?? 'Checkpoint đã rời nhưng session/account chưa được xác minh.'
      )
  }
}

async function verifyIdentity(
  input: FacebookCommonChallengeRuntimeInput,
  deps: FacebookCommonChallengeRuntimeDependencies
): Promise<FacebookCommonChallengeRunResult | null> {
  const identity = await deps.inspectIdentity(input.context, input.account.uid)
  if (!facebookCheckpoint282IdentityAccepted(identity.state)) return null
  return {
    state: 'resolved',
    challengeType: 'checkpoint_cleared',
    message: identity.state === 'match'
      ? 'Checkpoint đã cleared và c_user khớp đúng UID account.'
      : 'Checkpoint đã cleared; UID không phải ID số nên tiếp tục theo session Facebook Common đã xác minh.'
  }
}

async function continueSessionAfterCleared(
  input: FacebookCommonChallengeRuntimeInput,
  deps: FacebookCommonChallengeRuntimeDependencies,
  allowEmailContinuation: boolean
): Promise<FacebookCommonChallengeRunResult> {
  // Once the live classifier says the challenge is gone, re-enter the normal
  // Session Common flow before trusting identity/c_user. This is intentionally
  // after inspection so bootstrap navigation cannot destroy a live challenge.
  const session = await deps.bootstrapSession(input.context, input.page, input.account, input.locale)
  if (session.status === 'valid') {
    const verified = await verifyIdentity(input, deps)
    if (verified) return verified
    return {
      state: 'needs_login',
      challengeType: 'checkpoint_cleared',
      message: 'Session Facebook đã báo valid nhưng c_user/account identity không khớp; giữ account để operator kiểm tra.'
    }
  }

  const afterBootstrap = await deps.inspectChallenge(input.page)
  if (allowEmailContinuation && afterBootstrap.type === 'email_code_challenge') {
    return continueEmailChallenge(input, deps)
  }
  return manualClassificationResult(afterBootstrap, session.message)
}

async function continueEmailChallenge(
  input: FacebookCommonChallengeRuntimeInput,
  deps: FacebookCommonChallengeRuntimeDependencies
): Promise<FacebookCommonChallengeRunResult> {
  const emailResult = await deps.completeEmailChallenge(
    input.page,
    input.account.id,
    input.emailCodeProvider,
    Date.now()
  )

  if (emailResult.status === 'success') {
    const afterEmail = await deps.inspectChallenge(input.page)
    if (afterEmail.type === 'checkpoint_cleared') {
      return continueSessionAfterCleared(input, deps, false)
    }
    if (afterEmail.type === 'totp_2fa_challenge' || afterEmail.type === 'login_reauth') {
      const session = await deps.bootstrapSession(input.context, input.page, input.account, input.locale)
      if (session.status === 'valid') {
        const verified = await verifyIdentity(input, deps)
        if (verified) return verified
      }
      const afterContinuation = await deps.inspectChallenge(input.page)
      return manualClassificationResult(afterContinuation, session.message)
    }
    return manualClassificationResult(afterEmail, emailResult.message)
  }

  if (
    emailResult.status === 'email_auth_missing'
    || emailResult.status === 'email_auth_expired'
    || emailResult.status === 'email_code_not_found'
  ) {
    return {
      state: 'waiting',
      challengeType: 'email_code_challenge',
      message: emailResult.message
    }
  }

  return {
    state: 'needs_attention',
    challengeType: 'email_code_challenge',
    message: emailResult.message
  }
}

/**
 * Common Facebook challenge state-machine used by CP956 and future common callers.
 * Invariant: inspect the current live page before any bootstrap/navigation.
 */
export async function runFacebookCommonChallengeRuntime(
  input: FacebookCommonChallengeRuntimeInput,
  overrides: Partial<FacebookCommonChallengeRuntimeDependencies> = {}
): Promise<FacebookCommonChallengeRunResult> {
  const deps: FacebookCommonChallengeRuntimeDependencies = {
    inspectChallenge: overrides.inspectChallenge ?? defaultDependencies.inspectChallenge,
    completeEmailChallenge: overrides.completeEmailChallenge ?? defaultDependencies.completeEmailChallenge,
    bootstrapSession: overrides.bootstrapSession ?? defaultDependencies.bootstrapSession,
    inspectIdentity: overrides.inspectIdentity ?? defaultDependencies.inspectIdentity
  }
  const classification = await deps.inspectChallenge(input.page)

  switch (classification.type) {
    case 'checkpoint_cleared':
      return continueSessionAfterCleared(input, deps, true)
    case 'email_code_challenge':
      return continueEmailChallenge(input, deps)
    case 'totp_2fa_challenge':
    case 'login_reauth': {
      const session = await deps.bootstrapSession(input.context, input.page, input.account, input.locale)
      if (session.status === 'valid') {
        const verified = await verifyIdentity(input, deps)
        if (verified) return verified
      }
      const afterContinuation = await deps.inspectChallenge(input.page)
      return manualClassificationResult(afterContinuation, session.message)
    }
    case 'identity_verification_required':
    case 'security_review_required':
    case 'unsupported_checkpoint':
      return manualClassificationResult(classification)
  }
}
