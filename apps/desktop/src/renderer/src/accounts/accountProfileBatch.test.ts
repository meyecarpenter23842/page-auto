import { describe, expect, it, vi } from 'vitest'
import type { BrowserProfileResult } from '../../../shared/accounts'
import { openAccountProfilesBatch } from './accountProfileBatch'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('openAccountProfilesBatch', () => {
  it('dispatches all selected account opens before waiting for any one session check', async () => {
    const first = deferred<BrowserProfileResult>()
    const second = deferred<BrowserProfileResult>()
    const opener = vi.fn((accountId: number) => accountId === 1 ? first.promise : second.promise)

    const pending = openAccountProfilesBatch([
      { id: 1, uid: '1001' },
      { id: 2, uid: '1002' }
    ], opener)

    expect(opener).toHaveBeenCalledTimes(2)
    expect(opener).toHaveBeenNthCalledWith(1, 1)
    expect(opener).toHaveBeenNthCalledWith(2, 2)

    first.resolve({ status: 'started' })
    second.resolve({ status: 'already_open' })

    await expect(pending).resolves.toEqual([
      { accountId: 1, uid: '1001', status: 'started', message: null },
      { accountId: 2, uid: '1002', status: 'already_open', message: null }
    ])
  })

  it('keeps one account failure from blocking the other selected accounts', async () => {
    const outcomes = await openAccountProfilesBatch([
      { id: 1, uid: '1001' },
      { id: 2, uid: '1002' }
    ], async (accountId) => {
      if (accountId === 1) throw new Error('profile busy')
      return { status: 'started' }
    })

    expect(outcomes[0]).toMatchObject({ status: 'error', message: 'profile busy' })
    expect(outcomes[1]).toMatchObject({ status: 'started' })
  })
})
