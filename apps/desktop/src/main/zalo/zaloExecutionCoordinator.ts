export interface ZaloAccountLease {
  release: () => void
}

/** Zalo-only execution lease. Numeric IDs never enter the Facebook coordinator namespace. */
export class ZaloExecutionCoordinator {
  private readonly active = new Set<number>()

  tryAcquire(accountId: number): ZaloAccountLease | null {
    if (this.active.has(accountId)) return null
    this.active.add(accountId)
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.active.delete(accountId)
      }
    }
  }

  isActive(accountId: number): boolean {
    return this.active.has(accountId)
  }

  clear(): void {
    this.active.clear()
  }
}
