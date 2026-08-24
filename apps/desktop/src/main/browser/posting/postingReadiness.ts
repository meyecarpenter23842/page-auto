export interface PollForReadyOptions {
  attempts: number
  intervalMs: number
  sleep?: (milliseconds: number) => Promise<void>
}

export interface MediaReadinessSnapshot {
  previewCount: number
  removeControlCount: number
  busyCount: number
}

export function isMediaAttachmentReady(
  baseline: MediaReadinessSnapshot,
  current: MediaReadinessSnapshot,
  expectedCount: number
): boolean {
  const target = Math.max(1, Math.round(expectedCount))
  const previewDelta = Math.max(0, current.previewCount - baseline.previewCount)
  const removeDelta = Math.max(0, current.removeControlCount - baseline.removeControlCount)
  const attachmentCount = Math.max(previewDelta, removeDelta)
  return current.busyCount === 0 && attachmentCount >= target
}

const defaultSleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

export function readinessAttempts(timeoutMs: number, intervalMs: number): number {
  const normalizedTimeout = Math.max(0, Math.round(timeoutMs))
  const normalizedInterval = Math.max(1, Math.round(intervalMs))
  return Math.max(1, Math.ceil(normalizedTimeout / normalizedInterval))
}

export async function pollForReady<T>(
  probe: () => Promise<T | null>,
  options: PollForReadyOptions
): Promise<T | null> {
  const attempts = Math.max(1, Math.round(options.attempts))
  const intervalMs = Math.max(0, Math.round(options.intervalMs))
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await probe()
    if (value !== null) return value
    if (attempt + 1 < attempts && intervalMs > 0) await sleep(intervalMs)
  }

  return null
}
