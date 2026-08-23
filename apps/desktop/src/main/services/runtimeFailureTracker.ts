import type { PostingResultStatus } from '../../shared/posting'

interface FailureState {
  count: number
}

export interface ConsecutiveFailureDecision {
  count: number
  limitReached: boolean
}

export class ConsecutiveFailureTracker {
  private readonly states = new Map<string, FailureState>()

  record(
    runId: number,
    accountId: number | null,
    status: PostingResultStatus,
    hasRunItem: boolean,
    limit: number
  ): ConsecutiveFailureDecision {
    if (accountId === null) return { count: 0, limitReached: false }
    const key = `${runId}:${accountId}`

    if (status === 'success' || status === 'skipped' || !hasRunItem) {
      this.states.delete(key)
      return { count: 0, limitReached: false }
    }

    if (status !== 'failed') return { count: this.states.get(key)?.count ?? 0, limitReached: false }

    const next = (this.states.get(key)?.count ?? 0) + 1
    if (next >= limit) {
      this.states.delete(key)
      return { count: next, limitReached: true }
    }

    this.states.set(key, { count: next })
    return { count: next, limitReached: false }
  }

  clear(): void {
    this.states.clear()
  }
}
