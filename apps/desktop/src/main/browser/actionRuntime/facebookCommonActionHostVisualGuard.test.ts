import { describe, expect, it } from 'vitest'
import type { PostingJobResult } from '../../../shared/posting'
import { actionRuntimeResult, type ActionRunRequest } from '../../../shared/actionRuntime'
import type { ActionPreparationContext } from '../../services/actionRunner'
import type { FacebookSessionResult } from '../facebookSession'
import { FacebookCommonActionHost } from './facebookCommonActionHost'

function context(actor: ActionRunRequest['actor']): ActionPreparationContext {
  return {
    request: { runKey: 'visual', actionType: 'view_newsfeed', label: 'View', actor, config: {} },
    control: {
      isStopped: () => false,
      waitIfPaused: async () => undefined,
      sleep: async () => undefined
    },
    log: () => undefined
  }
}

const validSession: FacebookSessionResult = {
  accountId: 7,
  status: 'valid',
  reason: 'valid',
  cookie: null,
  cookieStatus: 'valid',
  lastCookieCheck: 1,
  message: 'valid'
}

const readyIdentity = async (): Promise<PostingJobResult> => ({ status: 'success', message: 'ready' })

describe('FacebookCommonActionHost visual guard', () => {
  it('runs the common visual guard only after profile identity is ready', async () => {
    const order: string[] = []
    const host = new FacebookCommonActionHost({
      ensureSession: async () => { order.push('session'); return validSession },
      ensureProfile: async () => { order.push('profile'); return readyIdentity() },
      switchPage: readyIdentity,
      ensureVisualLayout: async () => { order.push('visual'); return { status: 'ready' } }
    })

    const result = await host.prepare(context({ kind: 'profile', accountId: 7, accountUid: '10007' }))
    expect(result).toEqual({ status: 'ready' })
    expect(order).toEqual(['session', 'profile', 'visual'])
  })

  it('blocks the action when visual/layout recovery cannot establish a stable boundary', async () => {
    const host = new FacebookCommonActionHost({
      ensureSession: async () => validSession,
      ensureProfile: readyIdentity,
      switchPage: readyIdentity,
      ensureVisualLayout: async () => ({
        status: 'blocked',
        result: actionRuntimeResult('failed', 'visual_layout_unstable', 'layout drift')
      })
    })

    const result = await host.prepare(context({ kind: 'page', accountId: 7, accountUid: '10007', pageUid: '90001' }))
    expect(result).toMatchObject({
      status: 'blocked',
      result: { status: 'failed', code: 'visual_layout_unstable' }
    })
  })
})
