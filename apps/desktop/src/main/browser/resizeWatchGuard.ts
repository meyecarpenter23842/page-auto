export async function runWithResizeWatcherPaused(
  stopWatching: () => void,
  operation: () => Promise<void>,
  armWatching: () => void
): Promise<void> {
  stopWatching()
  try {
    await operation()
  } finally {
    armWatching()
  }
}
