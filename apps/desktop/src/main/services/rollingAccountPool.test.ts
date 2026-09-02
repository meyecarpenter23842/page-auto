import { describe, expect, it, vi } from 'vitest'
import { AccountExecutionCoordinator } from './accountExecutionCoordinator'
import { runRollingAccountPool } from './rollingAccountPool'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('runRollingAccountPool', () => {
  it('refills a freed slot immediately instead of waiting for the whole batch', async () => {
    const gates = new Map([
      [1, deferred()],
      [2, deferred()],
      [3, deferred()]
    ])
    const started: number[] = []

    const running = runRollingAccountPool({
      items: [1, 2, 3],
      concurrency: 2,
      tryAcquire: () => ({ release: () => undefined }),
      waitUntilRunnable: async () => true,
      shouldStop: () => false,
      run: async (accountId) => {
        started.push(accountId)
        await gates.get(accountId)!.promise
      }
    })

    await vi.waitFor(() => expect(started).toEqual([1, 2]))
    gates.get(1)!.resolve()
    await vi.waitFor(() => expect(started).toEqual([1, 2, 3]))

    // Account 2 is still running here; account 3 already filled account 1's freed slot.
    gates.get(2)!.resolve()
    gates.get(3)!.resolve()
    await running
  })

  it('does not let a globally locked account waste a rolling pool slot', async () => {
    const gates = new Map([
      [2, deferred()],
      [3, deferred()]
    ])
    const started: number[] = []
    let accountOneLocked = true

    const running = runRollingAccountPool({
      items: [1, 2, 3],
      concurrency: 2,
      tryAcquire: (accountId) => {
        if (accountId === 1 && accountOneLocked) return null
        return { release: () => undefined }
      },
      waitUntilRunnable: async () => true,
      shouldStop: () => false,
      idleDelayMs: 10,
      run: async (accountId) => {
        started.push(accountId)
        if (accountId === 2 || accountId === 3) await gates.get(accountId)!.promise
      }
    })

    await vi.waitFor(() => expect(started).toEqual([2, 3]))
    accountOneLocked = false
    gates.get(2)!.resolve()
    await vi.waitFor(() => expect(started).toEqual([2, 3, 1]))
    gates.get(3)!.resolve()
    await running
  })

  it('uses the real global coordinator across instances without losing a slot', async () => {
    const externalCoordinator = new AccountExecutionCoordinator()
    const poolCoordinator = new AccountExecutionCoordinator()
    const externalLease = externalCoordinator.tryAcquireLease(1)
    expect(externalLease).not.toBeNull()

    const gates = new Map([
      [2, deferred()],
      [3, deferred()]
    ])
    const started: number[] = []

    const running = runRollingAccountPool({
      items: [1, 2, 3],
      concurrency: 2,
      tryAcquire: (accountId) => poolCoordinator.tryAcquireLease(accountId),
      waitUntilRunnable: async () => true,
      shouldStop: () => false,
      idleDelayMs: 10,
      run: async (accountId) => {
        started.push(accountId)
        if (accountId === 2 || accountId === 3) await gates.get(accountId)!.promise
      }
    })

    await vi.waitFor(() => expect(started).toEqual([2, 3]))
    externalLease?.release()
    gates.get(2)!.resolve()
    await vi.waitFor(() => expect(started).toEqual([2, 3, 1]))
    gates.get(3)!.resolve()
    await running
  })

  it('releases the execution lease before running per-slot switch pacing', async () => {
    const pacingGate = deferred()
    const events: string[] = []
    const started: number[] = []

    const running = runRollingAccountPool({
      items: [1, 2],
      concurrency: 1,
      tryAcquire: (accountId) => ({
        release: () => events.push(`release:${accountId}`)
      }),
      waitUntilRunnable: async () => true,
      shouldStop: () => false,
      run: async (accountId) => {
        started.push(accountId)
        events.push(`run:${accountId}`)
      },
      afterRelease: async (accountId, context) => {
        events.push(`after:${accountId}:${context.remainingItems}`)
        if (accountId === 1) await pacingGate.promise
      }
    })

    await vi.waitFor(() => expect(events).toEqual(['run:1', 'release:1', 'after:1:1']))
    expect(started).toEqual([1])
    pacingGate.resolve()
    await running

    expect(started).toEqual([1, 2])
    expect(events).toEqual([
      'run:1',
      'release:1',
      'after:1:1',
      'run:2',
      'release:2',
      'after:2:0'
    ])
  })
})
