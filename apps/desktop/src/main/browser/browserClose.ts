export interface BrowserCloseTarget {
  close(): Promise<void>
}

export interface BrowserCloseOptions {
  retryDelayMs?: number
  sleep?: (milliseconds: number) => Promise<void>
}

function closeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const defaultSleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Browser/context shutdown is a lifecycle boundary, not best-effort cleanup.
 * Retry one rejected close because Windows/Chrome may still be draining CDP work;
 * if the retry also fails, propagate the failure so the worker cannot report a
 * false "Chrome closed" success.
 */
export async function closeBrowserTarget(
  target: BrowserCloseTarget | null,
  label: string,
  options: BrowserCloseOptions = {}
): Promise<void> {
  if (!target) return

  try {
    await target.close()
    return
  } catch (firstError) {
    const retryDelayMs = Math.max(0, options.retryDelayMs ?? 150)
    const sleep = options.sleep ?? defaultSleep
    if (retryDelayMs > 0) await sleep(retryDelayMs)

    try {
      await target.close()
      return
    } catch (retryError) {
      throw new Error(
        `${label} không đóng được sau 2 lần thử: ${closeErrorMessage(retryError)} (lần đầu: ${closeErrorMessage(firstError)})`
      )
    }
  }
}
