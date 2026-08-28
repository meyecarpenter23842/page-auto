import type { FacebookSessionResult } from '../facebookSession'
import type { PostingJobResult } from '../../../shared/posting'
import {
  actionRuntimeResult,
  type ActionPreparationContext,
  type ActionPreparationHost,
  type ActionPreparationResult
} from '../../../shared/actionRuntime'

export interface FacebookCommonActionHooks {
  ensureSession(context: ActionPreparationContext): Promise<FacebookSessionResult>
  ensureProfile(context: ActionPreparationContext): Promise<PostingJobResult>
  switchPage(context: ActionPreparationContext, pageUid: string): Promise<PostingJobResult>
}

function sessionBlock(result: FacebookSessionResult): ActionPreparationResult | null {
  if (result.status === 'valid' && result.reason === 'valid') return null
  if (result.reason === 'checkpoint') {
    return {
      status: 'blocked',
      result: actionRuntimeResult('needs_attention', 'checkpoint_required', result.message)
    }
  }
  return {
    status: 'blocked',
    result: actionRuntimeResult('needs_attention', 'session_needs_login', result.message)
  }
}

function actorIdentityBlock(result: PostingJobResult, actor: 'profile' | 'page'): ActionPreparationResult | null {
  if (result.status === 'success') return null
  if (result.code === 'verification_required') {
    return {
      status: 'blocked',
      result: actionRuntimeResult('needs_attention', 'checkpoint_required', result.message)
    }
  }
  if (result.status === 'needs_login' || result.code === 'needs_login') {
    return {
      status: 'blocked',
      result: actionRuntimeResult('needs_attention', 'session_needs_login', result.message)
    }
  }
  if (actor === 'profile' && result.code === 'profile_identity_unconfirmed') {
    return {
      status: 'blocked',
      result: actionRuntimeResult('failed', 'profile_identity_unconfirmed', result.message)
    }
  }
  if (actor === 'page' && result.code === 'page_identity_unconfirmed') {
    return {
      status: 'blocked',
      result: actionRuntimeResult('failed', 'page_identity_unconfirmed', result.message)
    }
  }
  if (result.code === 'page_navigation_failed') {
    return {
      status: 'blocked',
      result: actionRuntimeResult('failed', 'navigation_failed', result.message)
    }
  }
  return {
    status: 'blocked',
    result: actionRuntimeResult('failed', actor === 'profile' ? 'profile_identity_unconfirmed' : 'page_switch_failed', result.message)
  }
}

export class FacebookCommonActionHost implements ActionPreparationHost {
  constructor(private readonly hooks: FacebookCommonActionHooks) {}

  async prepare(context: ActionPreparationContext): Promise<ActionPreparationResult> {
    context.log('debug', 'Kiểm tra/khôi phục Facebook session bằng common runtime.')
    const session = await this.hooks.ensureSession(context)
    const blockedSession = sessionBlock(session)
    if (blockedSession) return blockedSession

    if (context.request.actor.kind === 'profile') {
      context.log('debug', 'Session hợp lệ; xác minh actor Profile bằng c_user/i_user.')
      const profileResult = await this.hooks.ensureProfile(context)
      const blockedProfile = actorIdentityBlock(profileResult, 'profile')
      if (blockedProfile) return blockedProfile
      context.log('info', 'Actor Profile đã được common runtime xác minh.')
      return { status: 'ready' }
    }

    const pageUid = context.request.actor.pageUid.trim()
    if (!pageUid) {
      return {
        status: 'blocked',
        result: actionRuntimeResult('failed', 'page_uid_required', 'Actor Page thiếu Page UID.')
      }
    }

    context.log('debug', 'Session hợp lệ; chuyển sang Page bằng common Page identity runtime.')
    const switchResult = await this.hooks.switchPage(context, pageUid)
    const blockedSwitch = actorIdentityBlock(switchResult, 'page')
    if (blockedSwitch) return blockedSwitch

    context.log('info', 'Page identity đã được common runtime xác minh.')
    return { status: 'ready' }
  }
}
