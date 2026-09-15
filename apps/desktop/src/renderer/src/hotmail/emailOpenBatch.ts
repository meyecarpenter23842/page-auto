export const MAX_EMAIL_OPEN_CONCURRENCY = 20

export function normalizeEmailOpenConcurrency(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(MAX_EMAIL_OPEN_CONCURRENCY, Math.max(1, Math.trunc(parsed)))
}

export async function runEmailOpenBatch<T>(
  accountIds: readonly number[],
  concurrency: number,
  openAccount: (accountId: number) => Promise<T>
): Promise<T[]> {
  const ids = [...new Set(accountIds.filter((accountId) => Number.isInteger(accountId) && accountId > 0))]
  if (ids.length === 0) return []

  const limit = Math.min(ids.length, normalizeEmailOpenConcurrency(concurrency))
  const results = new Array<T>(ids.length)
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= ids.length) return
      results[index] = await openAccount(ids[index]!)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}
