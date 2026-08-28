export interface Checkpoint282StaleResultDecision {
  ignore: boolean
  remaining: number
}

export function markCheckpoint282ResultStale(current: number): number {
  return Math.max(0, Math.floor(current)) + 1
}

export function consumeCheckpoint282StaleResult(current: number): Checkpoint282StaleResultDecision {
  const normalized = Math.max(0, Math.floor(current))
  if (normalized === 0) return { ignore: false, remaining: 0 }
  return { ignore: true, remaining: normalized - 1 }
}
