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

describe('FacebookCommonActionHost', () => {
  it('uses session common only for profile actor', async () => {
    let switchCalls = 0
    const host = new FacebookCommonActionHost({
      ensureSession: async () => session(),
      switchPage: async (): Promise<PostingJobResult> => {
        switchCalls += 1
        return { status: 'success', message: 'switched' }
      }
    })

    const result = await host.prepare(preparationContext({ kind: 'profile', accountId: 7, accountUid: '10007' }))

    expect(result).toEqual({ status: 'ready' })
    expect(switchCalls).toBe(0)
  })

  it('switches and verifies Page only after session is valid', async () => {
    let switchUid = ''
    const host = new FacebookCommonActionHost({
      ensureSession: async () => session(),
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
