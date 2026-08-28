import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountRecord } from '../../shared/accounts'
import type { FacebookCheckpoint282Result } from '../../shared/facebookCheckpoint'
import { readCheckpoint282History } from '../browser/checkpoint282Assets'
import { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { Checkpoint282RunLifecycle } from './checkpoint282RunLifecycle'
import { Checkpoint282RuntimeController, type Checkpoint282BrowserRuntime } from './checkpoint282RuntimeController'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'page-auto-cp282-controller-'))
  roots.push(root)
  return root
}

const account = { id: 7, uid: '123456' } as AccountRecord

function result(state: FacebookCheckpoint282Result['state'], message = state): FacebookCheckpoint282Result {
  return {
    accountId: account.id,
    uid: account.uid,
    state,
    surface: 'mbasic',
    message
  }
}

describe('Checkpoint282RuntimeController', () => {
  it('holds the account lease during manual CP282 and releases it after recheck resolves', async () => {
    const coordinator = new AccountExecutionCoordinator()
    const lifecycle = new Checkpoint282RunLifecycle(tempRoot())
    const browser: Checkpoint282BrowserRuntime = {
      runCheckpoint282: vi.fn(async (_account, payload) => payload.action === 'start' ? result('waiting_manual') : result('resolved')),
      closeAccount: vi.fn(async () => undefined)
    }
    const controller = new Checkpoint282RuntimeController(coordinator, lifecycle, browser)

    const first = await controller.run(account, { accountId: 7, surface: 'mbasic', action: 'start', asset: null })
    expect(first.state).toBe('waiting_manual')

    let sameAccountEntered = false
    const queued = coordinator.run(account.id, async () => {
      sameAccountEntered = true
      return 'next-task'
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(sameAccountEntered).toBe(false)

    const recheck = await controller.run(account, { accountId: 7, surface: 'mbasic', action: 'recheck', asset: null })
    expect(recheck.state).toBe('resolved')
    await queued
    expect(sameAccountEntered).toBe(true)
    expect(browser.closeAccount).toHaveBeenCalledWith(account.id)
  })

  it('returns a retryable busy result without stealing a lease from another account operation', async () => {
    const coordinator = new AccountExecutionCoordinator()
    const externalLease = coordinator.tryAcquireLease(account.id)
    const lifecycle = new Checkpoint282RunLifecycle(tempRoot())
    const browser: Checkpoint282BrowserRuntime = {
      runCheckpoint282: vi.fn(async () => result('resolved')),
      closeAccount: vi.fn(async () => undefined)
    }
    const controller = new Checkpoint282RuntimeController(coordinator, lifecycle, browser)

    const attempt = await controller.run(account, { accountId: 7, surface: 'mbasic', action: 'start', asset: null })
    expect(attempt.state).toBe('error')
    expect(attempt.message).toContain('đang được nghiệp vụ khác sử dụng')
    expect(browser.runCheckpoint282).not.toHaveBeenCalled()
    externalLease?.release()
  })

  it('stops a held manual browser, records history and frees the same account for the next operation', async () => {
    const root = tempRoot()
    const coordinator = new AccountExecutionCoordinator()
    const lifecycle = new Checkpoint282RunLifecycle(root)
    const browser: Checkpoint282BrowserRuntime = {
      runCheckpoint282: vi.fn(async () => result('waiting_manual')),
      closeAccount: vi.fn(async () => undefined)
    }
    const controller = new Checkpoint282RuntimeController(coordinator, lifecycle, browser)

    await controller.run(account, { accountId: 7, surface: 'mbasic', action: 'start', asset: null })
    const stopped = await controller.run(account, { accountId: 7, surface: 'mbasic', action: 'stop', asset: null })
    expect(stopped.state).toBe('stopped')
    expect(readCheckpoint282History(root, account.uid)[0]).toEqual(expect.objectContaining({ state: 'stopped', action: 'stop' }))

    const lease = coordinator.tryAcquireLease(account.id)
    expect(lease).not.toBeNull()
    lease?.release()
  })
})
