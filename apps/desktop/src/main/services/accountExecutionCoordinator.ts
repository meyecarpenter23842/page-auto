const accountExecutionTails = new Map<number, Promise<void>>()

function diagnostic(accountId: number, message: string): void {
  console.info(`[PAGE-AUTO scheduler] account=${accountId} ${message}`)
}

export interface AccountExecutionLease {
  accountId: number
  release: () => void
}

/**
 * All coordinator instances in Electron Main share one account lock table.
 * This keeps Scenario Runner, Page tasks, posting and checkpoint flows from
 * driving the same Facebook account concurrently even when the services are
 * registered from separate IPC modules.
 */
export class AccountExecutionCoordinator {
  private readonly tails = accountExecutionTails

  tryAcquireLease(accountId: number): AccountExecutionLease | null {
    if (this.tails.has(accountId)) {
      diagnostic(accountId, 'lease rejected because account operation is active')
      return null
    }

    let releaseGate!: () => void
    const gate = new Promise<void>((resolve) => { releaseGate = resolve })
    this.tails.set(accountId, gate)
    diagnostic(accountId, 'lease acquired')

    let released = false
    return {
      accountId,
      release: () => {
        if (released) return
        released = true
        releaseGate()
        if (this.tails.get(accountId) === gate) this.tails.delete(accountId)
        diagnostic(accountId, 'lease released')
      }
    }
  }

  async run<T>(accountId: number, task: () => Promise<T>): Promise<T> {
    const queuedBehindExisting = this.tails.has(accountId)
    const previous = this.tails.get(accountId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    this.tails.set(accountId, tail)

    diagnostic(accountId, queuedBehindExisting ? 'queued behind active account operation' : 'queued for account operation')
    await previous
    diagnostic(accountId, 'ENTER account operation')
    try {
      const result = await task()
      diagnostic(accountId, 'EXIT account operation resolved')
      return result
    } catch (error) {
      diagnostic(accountId, `EXIT account operation rejected type=${error instanceof Error ? error.name : typeof error}`)
      throw error
    } finally {
      release()
      if (this.tails.get(accountId) === tail) this.tails.delete(accountId)
    }
  }
}
