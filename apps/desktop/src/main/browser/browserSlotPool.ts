export type BrowserWindowOwner = 'profile' | 'posting' | 'scenario'

interface BrowserSlotEntry {
  slotIndex: number
  owners: Set<BrowserWindowOwner>
}

export type BrowserSlotClaimStatus = 'allocated' | 'shared' | 'existing'
export type BrowserSlotReleaseStatus = 'freed' | 'retained' | 'missing' | 'owner_missing'

export interface BrowserSlotClaimResult {
  accountId: number
  owner: BrowserWindowOwner
  slotIndex: number
  status: BrowserSlotClaimStatus
}

export interface BrowserSlotReleaseResult {
  accountId: number
  owner: BrowserWindowOwner
  slotIndex: number | null
  status: BrowserSlotReleaseStatus
}

export interface BrowserSlotSnapshotEntry {
  accountId: number
  slotIndex: number
  owners: BrowserWindowOwner[]
}

/**
 * Main-process allocator for Compact Chrome slots.
 *
 * One account owns exactly one slot even when profile, posting and scenario lifecycles
 * reference the same persistent Chrome. Released slots are reused from the lowest index
 * without moving any other active account. Dense re-numbering is explicit via compact()
 * and is reserved for the operator-triggered re-tile action.
 */
export class BrowserSlotPool {
  private readonly entries = new Map<number, BrowserSlotEntry>()
  private readonly freeSlots: number[] = []
  private nextSlotIndex = 0

  claim(accountId: number, owner: BrowserWindowOwner): BrowserSlotClaimResult {
    const existing = this.entries.get(accountId)
    if (existing) {
      if (existing.owners.has(owner)) {
        return { accountId, owner, slotIndex: existing.slotIndex, status: 'existing' }
      }
      existing.owners.add(owner)
      return { accountId, owner, slotIndex: existing.slotIndex, status: 'shared' }
    }

    const slotIndex = this.takeLowestFreeSlot()
    this.entries.set(accountId, { slotIndex, owners: new Set([owner]) })
    return { accountId, owner, slotIndex, status: 'allocated' }
  }

  release(accountId: number, owner: BrowserWindowOwner): BrowserSlotReleaseResult {
    const entry = this.entries.get(accountId)
    if (!entry) return { accountId, owner, slotIndex: null, status: 'missing' }
    if (!entry.owners.delete(owner)) {
      return { accountId, owner, slotIndex: entry.slotIndex, status: 'owner_missing' }
    }
    if (entry.owners.size > 0) {
      return { accountId, owner, slotIndex: entry.slotIndex, status: 'retained' }
    }

    this.entries.delete(accountId)
    this.insertFreeSlot(entry.slotIndex)
    return { accountId, owner, slotIndex: entry.slotIndex, status: 'freed' }
  }

  slotFor(accountId: number): number | null {
    return this.entries.get(accountId)?.slotIndex ?? null
  }

  activeCount(): number {
    return this.entries.size
  }

  snapshot(): BrowserSlotSnapshotEntry[] {
    return [...this.entries]
      .map(([accountId, entry]) => ({
        accountId,
        slotIndex: entry.slotIndex,
        owners: [...entry.owners].sort()
      }))
      .sort((left, right) => left.slotIndex - right.slotIndex || left.accountId - right.accountId)
  }

  /**
   * Explicitly compact active assignments to 0..N-1. Normal claim/release never calls
   * this, so closing one Chrome does not make unrelated running Chrome jump positions.
   */
  compact(): number {
    const ordered = this.snapshot()
    let changed = 0
    for (let slotIndex = 0; slotIndex < ordered.length; slotIndex += 1) {
      const current = ordered[slotIndex]
      if (!current) continue
      const entry = this.entries.get(current.accountId)
      if (!entry) continue
      if (entry.slotIndex !== slotIndex) changed += 1
      entry.slotIndex = slotIndex
    }
    this.freeSlots.splice(0)
    this.nextSlotIndex = ordered.length
    return changed
  }

  private takeLowestFreeSlot(): number {
    const recycled = this.freeSlots.shift()
    if (recycled !== undefined) return recycled
    const next = this.nextSlotIndex
    this.nextSlotIndex += 1
    return next
  }

  private insertFreeSlot(slotIndex: number): void {
    let low = 0
    let high = this.freeSlots.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      const middleValue = this.freeSlots[middle]
      if (middleValue !== undefined && middleValue < slotIndex) low = middle + 1
      else high = middle
    }
    if (this.freeSlots[low] === slotIndex) return
    this.freeSlots.splice(low, 0, slotIndex)
  }
}
