import { describe, expect, it } from 'vitest'
import type { FacebookSessionResult } from '../facebookSession'
import type { PostingJobResult } from '../../../shared/posting'
import type { ActionRunRequest } from '../../../shared/actionRuntime'
import type { ActionPreparationContext } from '../../services/actionRunner'
import { FacebookCommonActionHost } from './facebookCommonActionHost'

function session(reason: FacebookSessionResult['reason'] = 'valid'): FacebookSessionResult {
  const valid = reason === 'valid'
  return {
    accountId: 7,
    status: valid ? 'valid' : 'needs_login',
    reason,
    cookie: null,
    cookieStatus: valid ? 'valid' : 'needs_login',
    lastCookieCheck: 1,
    message: valid ? 'valid' : `blocked:${reason}`
  }
}

function preparationContext(actor: ActionRunRequest['actor']): ActionPreparationContext {
  return {
    request: {
      runKey: 'run',
      actionType: 'view_newsfeed',
      label: 'View newsfeed',
      actor,
      config: {}
    },
    control: {
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      sleep: async () => undefined
    },
    log: () => undefined
  }
}

function profileReady(): Promise<PostingJobResult> {
  return Promise.resolve({ status: 'success', message: 'profile ready' })
}

describe('FacebookCommonActionHost', () => {
  it('verifies profile identity after session is valid', async () => {
    let profileCalls = 0
    let switchCalls = 0
    const host = new FacebookCommonActionHost({
      ensureSession: async () => session(),
      ensureProfile: async () => {
        profileCalls += 1
        return { status: 'success', message: 'profile ready' }
      },
      switchPage: async (): Promise<PostingJobResult> => {
        switchCalls += 1
        return { status: 'success', message: 'switched' }
      }
    })

    const result = await host.prepare(preparationContext({ kind: 'profile', accountId: 7, accountUid: '10007' }))

    expect(result).toEqual({ status: 'ready' })
    expect(profileCalls).toBe(1)
    expect(switchCalls).toBe(0)
  })

  it('blocks profile action when the active actor cannot be restored from Page', async () => {
    const host = new FacebookCommonActionHost({
      ensureSession: async () => session(),
      ensureProfile: async (): Promise<PostingJobResult> => ({
        status: 'failed',
        code: 'profile_identity_unconfirmed',
        message: 'i_user still active'
      }),
      switchPage: async () => ({ status: 'success', message: 'unused' })
    })

    const result = await host.prepare(preparationContext({ kind: 'profile', accountId: 7, accountUid: '10007' }))

    expect(result).toMatchObject({
      status: 'blocked',
      result: { status: 'failed', code: 'profile_identity_unconfirmed' }
    })
  })

  it('switches and verifies Page only after session is valid', async () => {
    let switchUid = ''
    const host = new FacebookCommonActionHost({
      ensureSession: async () => session(),
      ensureProfile: profileReady,
      switchPage: async (_context, pageUid): Promise<PostingJobResult> => {
        switchUid = pageUid
        return { status: 'success', message: 'switched' }
      }
    })

    const result = await host.prepare(preparationContext({ kind: 'page', accountId: 7, accountUid: '10007', pageUid: '90001' }))

    expect(result).toEqual({ status: 'ready' })
    expect(switchUid).toBe('90001')
  })

  it('never routes checkpoint into Page switch', async () => {
    let switchCalls = 0
    const host = new FacebookCommonActionHost({
      ensureSession: async () => session('checkpoint'),
      ensureProfile: profileReady,
      switchPage: async (): Promise<PostingJobResult> => {
        switchCalls += 1
        return { status: 'success', message: 'unexpected' }
      }
    })

    const result = await host.prepare(preparationContext({ kind: 'page', accountId: 7, accountUid: '10007', pageUid: '90001' }))

    expect(result).toMatchObject({ status: 'blocked', result: { status: 'needs_attention', code: 'checkpoint_required' } })
    expect(switchCalls).toBe(0)
  })

  it('maps Page identity verification failure to typed action failure', async () => {
    const host = new FacebookCommonActionHost({
      ensureSession: async () => session(),
      ensureProfile: profileReady,
      switchPage: async (): Promise<PostingJobResult> => ({
        status: 'failed',
        code: 'page_identity_unconfirmed',
        message: 'not confirmed'
      })
    })

    const result = await host.prepare(preparationContext({ kind: 'page', accountId: 7, accountUid: '10007', pageUid: '90001' }))

    expect(result).toMatchObject({ status: 'blocked', result: { status: 'failed', code: 'page_identity_unconfirmed' } })
  })
})
