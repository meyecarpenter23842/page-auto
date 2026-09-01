export interface RollingPoolLease {
  release(): void
}

export interface RollingAccountPoolOptions<T> {
  items: readonly T[]
  concurrency: number
  tryAcquire: (item: T) => RollingPoolLease | null
  run: (item: T) => Promise<void>
  waitUntilRunnable: () => Promise<boolean>
  shouldStop: () => boolean
  idleDelayMs?: number
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

/**
 * Runs a rolling worker pool: as soon as one slot finishes, that same slot
 * immediately claims the next available item. There is no batch barrier.
 *
 * tryAcquire is intentionally synchronous so a globally locked account does
 * not consume a concurrency slot while other queued accounts are available.
 */
export async function runRollingAccountPool<T>(options: RollingAccountPoolOptions<T>): Promise<void> {
  const pending = [...options.items]
  const size = Math.max(1, Math.min(Math.floor(options.concurrency), pending.length || 1))
  const idleDelayMs = Math.max(10, options.idleDelayMs ?? 100)

  const runSlot = async (): Promise<void> => {
    while (pending.length > 0 && !options.shouldStop()) {
      if (!await options.waitUntilRunnable() || options.shouldStop()) return

      let claimedIndex = -1
      let lease: RollingPoolLease | null = null
      for (let index = 0; index < pending.length; index += 1) {
        const candidate = pending[index]
        if (candidate === undefined) continue
        const candidateLease = options.tryAcquire(candidate)
        if (!candidateLease) continue
        claimedIndex = index
        lease = candidateLease
        break
      }

      if (claimedIndex < 0 || !lease) {
        await sleep(idleDelayMs)
        continue
      }

      const [item] = pending.splice(claimedIndex, 1)
      if (item === undefined) {
        lease.release()
        continue
      }

      try {
        await options.run(item)
      } finally {
        lease.release()
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(size, pending.length || size) }, () => runSlot()))
}
