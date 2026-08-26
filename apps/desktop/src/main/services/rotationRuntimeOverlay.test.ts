import { describe, expect, it } from 'vitest'
import type { ExecuteSinglePostingJobResult } from '../../shared/posting'
import type { PostingJobPreview, RotationRuntimeSnapshot } from '../../shared/rotation'
import { RotationRuntimeOverlayRegistry } from './rotationRuntimeOverlay'

function runtimeSnapshot(overrides: Partial<RotationRuntimeSnapshot> = {}): RotationRuntimeSnapshot {
  return {
    pageTabId: 7,
    runId: 101,
    status: 'running',
    currentAccountId: null,
    currentAccountIndex: null,
    slotsCompletedThisTurn: 0,
    targetSlotsThisTurn: 1,
    cycle: 0,
    nextActionAt: null,
    message: null,
    lastResult: null,
    run: {
      run: {
        id: 101,
        pageTabId: 7,
        pageUid: '999',
        snapshot: {
          accounts: [
            { accountId: 11, enabled: true, sortOrder: 0 },
            { accountId: 22, enabled: true, sortOrder: 1 }
          ]
        }
      }
    } as unknown as RotationRuntimeSnapshot['run'],
    ...overrides
  }
}

function postingOutcome(accountId: number, status: 'success' | 'failed'): ExecuteSinglePostingJobResult {
  return {
    accountId,
    item: status === 'success' ? { id: 1 } : null,
    result: {
      status,
      code: status === 'failed' ? 'proxy_unavailable' : undefined,
      message: status === 'success' ? 'Đăng thành công.' : 'Proxy lỗi.'
    },
    run: {
      run: {
        id: 101,
        pageTabId: 7
      }
    }
  } as unknown as ExecuteSinglePostingJobResult
}

const preview: PostingJobPreview = {
  groupUid: '123456',
  contentPreview: 'Nội dung đang đăng',
  contentLength: 18,
  imageCount: 2,
  postIndex: 1,
  variantIndex: 0
}

describe('RotationRuntimeOverlayRegistry', () => {
  it('tracks runtime state by account id instead of account index', () => {
    const overlay = new RotationRuntimeOverlayRegistry()
    overlay.decorate(runtimeSnapshot())

    overlay.notePostingStart(101, 22)
    overlay.notePrepared(101, 22, preview)
    const active = overlay.decorate(runtimeSnapshot({ currentAccountId: 22, currentAccountIndex: 0 }))

    expect(active.accountStates).toEqual([
      { accountId: 11, status: 'not_run', message: null },
      { accountId: 22, status: 'running', message: 'Đang chạy.' }
    ])
    expect(active.currentPostPreview).toEqual(preview)

    overlay.notePostingResult(postingOutcome(22, 'success'))
    const completed = overlay.decorate(runtimeSnapshot({ currentAccountId: null, currentAccountIndex: null }))
    expect(completed.accountStates?.find((entry) => entry.accountId === 22)?.status).toBe('completed_turn')
    expect(completed.currentPostPreview).toBeNull()
  })

  it('keeps account errors red after the rotation releases the account', () => {
    const overlay = new RotationRuntimeOverlayRegistry()
    overlay.decorate(runtimeSnapshot())

    overlay.notePostingStart(101, 11)
    overlay.notePostingResult(postingOutcome(11, 'failed'))
    const snapshot = overlay.decorate(runtimeSnapshot({ currentAccountId: null }))

    expect(snapshot.accountStates?.find((entry) => entry.accountId === 11)).toMatchObject({
      status: 'error',
      message: 'Proxy lỗi.'
    })
  })

  it('resets per-run account colors when the next account cycle starts', () => {
    const overlay = new RotationRuntimeOverlayRegistry()
    overlay.decorate(runtimeSnapshot())
    overlay.notePostingStart(101, 22)
    overlay.notePostingResult(postingOutcome(22, 'success'))
    overlay.decorate(runtimeSnapshot({ currentAccountId: null }))

    const betweenCycles = overlay.decorate(runtimeSnapshot({ cycle: 1, status: 'waiting_window' }))
    expect(betweenCycles.accountStates?.find((entry) => entry.accountId === 22)?.status).toBe('completed_turn')

    overlay.notePostingStart(101, 11)
    const nextCycle = overlay.decorate(runtimeSnapshot({ cycle: 1, currentAccountId: 11 }))
    expect(nextCycle.accountStates).toEqual([
      { accountId: 11, status: 'running', message: 'Đang chạy.' },
      { accountId: 22, status: 'not_run', message: null }
    ])
  })
})
