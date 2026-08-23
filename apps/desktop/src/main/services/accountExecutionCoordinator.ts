export class AccountExecutionCoordinator {
  private readonly tails = new Map<number, Promise<void>>()

  async run<T>(accountId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(accountId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    this.tails.set(accountId, tail)

    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.tails.get(accountId) === tail) this.tails.delete(accountId)
    }
  }
}
