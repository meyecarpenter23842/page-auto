export type EmailRuntimeOwner = 'password' | 'recovery' | 'combo'

export class EmailRuntimeOwnership {
  private readonly owners = new Map<number, EmailRuntimeOwner>()

  current(accountId: number): EmailRuntimeOwner | null {
    return this.owners.get(accountId) ?? null
  }

  claim(accountId: number, owner: EmailRuntimeOwner, continuation = false): boolean {
    const current = this.owners.get(accountId)
    if (continuation) return current === owner
    if (current) return false
    this.owners.set(accountId, owner)
    return true
  }

  release(accountId: number, owner: EmailRuntimeOwner): void {
    if (this.owners.get(accountId) === owner) this.owners.delete(accountId)
  }

  clear(accountId: number): void {
    this.owners.delete(accountId)
  }

  clearAll(): void {
    this.owners.clear()
  }
}
