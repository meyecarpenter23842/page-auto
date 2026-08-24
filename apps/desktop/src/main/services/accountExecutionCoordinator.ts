function diagnostic(accountId: number, message: string): void {
  console.info(`[PAGE-AUTO scheduler] account=${accountId} ${message}`)
}

export class AccountExecutionCoordinator {
  private readonly tails = new Map<number, Promise<void>>()

  async run<T>(accountId: number, task: () => Promise<T>): Promise<T> {
    const queuedBehindExisting = this.tails.has(accountId)
    const previous = this.tails.get(accountId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    this.tails.set(accountId, tail)

    diagnostic(accountId, queuedBehindExisting ? 'queued behind active account job' : 'queued for PostingService')
    await previous
    diagnostic(accountId, 'ENTER PostingService')
    try {
      const result = await task()
      diagnostic(accountId, 'EXIT PostingService resolved')
      return result
    } catch (error) {
      diagnostic(accountId, `EXIT PostingService rejected type=${error instanceof Error ? error.name : typeof error}`)
      throw error
    } finally {
      release()
      if (this.tails.get(accountId) === tail) this.tails.delete(accountId)
    }
  }
}
