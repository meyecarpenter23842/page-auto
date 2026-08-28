import { describe, expect, it, vi } from 'vitest'
import type { AccountRecord } from '../../shared/accounts'
import type { FacebookCheckpoint282Result } from '../../shared/facebookCheckpoint'
import { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { Checkpoint282RunLifecycle } from './checkpoint282RunLifecycle'
import { Checkpoint282RuntimeController, type Checkpoint282BrowserRuntime } from './checkpoint282RuntimeController'

const account = { id: 7, uid: '123456' } as AccountRecord

function probe(state: FacebookCheckpoint282Result['state'], kind?: FacebookCheckpoint282Result['checkpointKind']): FacebookCheckpoint282Result {
  return {
    accountId: account.id,
    uid: account.uid,
    state,
    surface: 'desktop',
    message: state,
    ...(kind ? { checkpointKind: kind } : {})
  }
}

describe('CP956 workbench runtime', () => {
  it('holds the account lease on CP956 and releases it after a successful recheck', async () => {
    const coordinator = new AccountExecutionCoordinator()
    const browser: Checkpoint282BrowserRuntime = {
      runCheckpoint282: vi.fn(async (_account, payload) => payload.action === 'start'
        ? probe('different_checkpoint', '956')
        : probe('resolved')),
      closeAccount: vi.fn(async () => undefined)
    }
    const controller = new Checkpoint282RuntimeController(
      coordinator,
      new Checkpoint282RunLifecycle('unused-cp956-test'),
      browser
    )

    const first = await controller.run(account, {
      accountId: account.id,
      surface: 'desktop',
      action: 'start',
      checkpointKind: '956',
      asset: null
    })
    expect(first.state).toBe('waiting_manual')

    let sameAccountEntered = false
    const queued = coordinator.run(account.id, async () => {
      sameAccountEntered = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(sameAccountEntered).toBe(false)

    const recheck = await controller.run(account, {
      accountId: account.id,
      surface: 'desktop',
      action: 'recheck',
      checkpointKind: '956',
      asset: null
    })
    expect(recheck.state).toBe('resolved')
    await queued
    expect(sameAccountEntered).toBe(true)
    expect(browser.closeAccount).toHaveBeenCalledWith(account.id)
  })

  it('stops a held CP956 browser and releases the account', async () => {
    const coordinator = new AccountExecutionCoordinator()
    const browser: Checkpoint282BrowserRuntime = {
      runCheckpoint282: vi.fn(async () => probe('different_checkpoint', '956')),
      closeAccount: vi.fn(async () => undefined)
    }
    const controller = new Checkpoint282RuntimeController(
      coordinator,
      new Checkpoint282RunLifecycle('unused-cp956-test'),
      browser
    )

    await controller.run(account, {
      accountId: account.id,
      surface: 'desktop',
      action: 'start',
      checkpointKind: '956',
      asset: null
    })
    const stopped = await controller.run(account, {
      accountId: account.id,
      surface: 'desktop',
      action: 'stop',
      checkpointKind: '956',
      asset: null
    })

    expect(stopped.state).toBe('stopped')
    expect(browser.closeAccount).toHaveBeenCalledWith(account.id)
    const lease = coordinator.tryAcquireLease(account.id)
    expect(lease).not.toBeNull()
    lease?.release()
  })
})
