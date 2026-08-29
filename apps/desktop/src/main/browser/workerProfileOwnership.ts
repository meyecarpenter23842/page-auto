export type WorkerProfileReuseDecision = 'reuse' | 'replace' | 'busy'

function normalizedProfileDirectory(value: string): string {
  return value.trim().replace(/[\\/]+$/g, '').toLowerCase()
}

export function workerProfileReuseDecision(
  currentProfileDirectory: string,
  requestedProfileDirectory: string,
  busy: boolean
): WorkerProfileReuseDecision {
  if (normalizedProfileDirectory(currentProfileDirectory) === normalizedProfileDirectory(requestedProfileDirectory)) {
    return 'reuse'
  }
  return busy ? 'busy' : 'replace'
}
