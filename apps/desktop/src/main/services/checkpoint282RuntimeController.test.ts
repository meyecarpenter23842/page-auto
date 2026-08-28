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
  vi.useRealTimers()
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

function cp956Result(
  state: FacebookCheckpoint282Result['state'],
  challengeType: NonNullable<FacebookCheckpoint282Result['challengeType']>
): FacebookCheckpoint282Result {
  return {
    accountId: account.id,
    uid: account.uid,
    state,
    surface: 'desktop',
    checkpointKind: '956',
    challengeType,
    message: state
  }
}

function browserRuntime(overrides: Partial<Checkpoint282BrowserRuntime> = {}): Checkpoint282BrowserRuntime {
  return {
    runCheckpoint282: vi.fn(async (_account, payload) => payload.action === 'start' ? result('waiting_manual') : result('resolved')),
    runCheckpoint956: vi.fn(async (_account, payload) => payload.action === 'start'
      ? cp956Result('waiting', 'email_code_challenge')
      : cp956Result('resolved', 'checkpoint_cleared')),
    closeAccount: vi.fn(async () => undefined),
    ...overrides
  }
}

describe('Checkpoint282RuntimeController', () => {
  it('holds the account lease during manual CP282 and releases it after recheck resolves', async () => {
    const coordinator = new AccountExecutionCoordinator()
    const lifecycle = new Checkpoint282RunLifecycle(tempRoot())
    const browser = browserRuntime()
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
    const browser = browserRuntime({ runCheckpoint282: vi.fn(async () => result('resolved')) })
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
    const browser = browserRuntime({ runCheckpoint282: vi.fn(async () => result('waiting_manual')) })
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

describe('CP956 Common Challenge controller', () => {
  it('uses the CP956 executor directly, keeps a typed waiting lease, then resolves on live recheck', async () => {
    const coordinator = new AccountExecutionCoordinator()
    const browser = browserRuntime()
    const controller = new Checkpoint282RuntimeController(
      coordinator,
      new Checkpoint282RunLifecycle(tempRoot()),
      browser,
      60_000
    )

    const first = await controller.run(account, {
      accountId: 7,
      surface: 'desktop',
      action: 'start',
      checkpointKind: '956',
      asset: null
    })
    expect(first).toEqual(expect.objectContaining({
      state: 'waiting',
      challengeType: 'email_code_challenge',
      checkpointKind: '956'
    }))
    expect(first.holdExpiresAt).toBeGreaterThan(Date.now())
    expect(browser.runCheckpoint956).toHaveBeenCalledTimes(1)
    expect(browser.runCheckpoint282).not.toHaveBeenCalled()
    expect(coordinator.tryAcquireLease(account.id)).toBeNull()

    const recheck = await controller.run(account, {
      accountId: 7,
      surface: 'desktop',
      action: 'recheck',
      checkpointKind: '956',
      asset: null
    })
    expect(recheck.state).toBe('resolved')
    const lease = coordinator.tryAcquireLease(account.id)
    expect(lease).not.toBeNull()
    lease?.release()
  })

  it('watchdogs a held CP956 browser and releases its lease instead of hanging forever', async () => {
    vi.useFakeTimers()
    const coordinator = new AccountExecutionCoordinator()
    const browser = browserRuntime({
      runCheckpoint956: vi.fn(async () => cp956Result('waiting', 'unsupported_checkpoint'))
    })
    const controller = new Checkpoint282RuntimeController(
      coordinator,
      new Checkpoint282RunLifecycle(tempRoot()),
      browser,
      1_000
    )

    await controller.run(account, {
      accountId: 7,
      surface: 'desktop',
      action: 'start',
      checkpointKind: '956',
      asset: null
    })
    expect(coordinator.tryAcquireLease(account.id)).toBeNull()

    await vi.advanceTimersByTimeAsync(1_100)
    expect(browser.closeAccount).toHaveBeenCalledWith(account.id)
    const lease = coordinator.tryAcquireLease(account.id)
    expect(lease).not.toBeNull()
    lease?.release()

    const timedOut = await controller.run(account, {
      accountId: 7,
      surface: 'desktop',
      action: 'recheck',
      checkpointKind: '956',
      asset: null
    })
    expect(timedOut.state).toBe('checkpoint_timeout')
  })

  it('releases a held CP956 lease when the browser crashes and reports it on recheck', async () => {
    const listeners: { closed?: (accountId: number) => void } = {}
    const coordinator = new AccountExecutionCoordinator()
    const browser = browserRuntime({
      onAccountClosed: vi.fn((listener: (accountId: number) => void) => {
        listeners.closed = listener
        return () => { delete listeners.closed }
      })
    })
    const controller = new Checkpoint282RuntimeController(
      coordinator,
      new Checkpoint282RunLifecycle(tempRoot()),
      browser,
      60_000
    )

    await controller.run(account, {
      accountId: 7,
      surface: 'desktop',
      action: 'start',
      checkpointKind: '956',
      asset: null
    })
    expect(coordinator.tryAcquireLease(account.id)).toBeNull()

    listeners.closed?.(account.id)
    const lease = coordinator.tryAcquireLease(account.id)
    expect(lease).not.toBeNull()
    lease?.release()

    const recheck = await controller.run(account, {
      accountId: 7,
      surface: 'desktop',
      action: 'recheck',
      checkpointKind: '956',
      asset: null
    })
    expect(recheck.state).toBe('error')
    expect(recheck.message).toContain('đóng/crash')
  })

  it('stops and closes a held CP956 account cleanly', async () => {
    const coordinator = new AccountExecutionCoordinator()
    const browser = browserRuntime()
    const controller = new Checkpoint282RuntimeController(
      coordinator,
      new Checkpoint282RunLifecycle(tempRoot()),
      browser,
      60_000
    )

    await controller.run(account, {
      accountId: 7,
      surface: 'desktop',
      action: 'start',
      checkpointKind: '956',
      asset: null
    })
    const stopped = await controller.run(account, {
      accountId: 7,
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
