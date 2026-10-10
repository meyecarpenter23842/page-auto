export class ZaloActionStoppedError extends Error {
  constructor() {
    super('Zalo action đã dừng theo yêu cầu operator.')
    this.name = 'ZaloActionStoppedError'
  }
}

export class ZaloActionControl {
  private paused = false
  private stopped = false
  private resumeWaiters = new Set<() => void>()

  reset(): void {
    this.paused = false
    this.stopped = false
    this.flushResumeWaiters()
  }

  pause(): void {
    if (this.stopped) return
    this.paused = true
  }

  resume(): void {
    this.paused = false
    this.flushResumeWaiters()
  }

  stop(): void {
    this.stopped = true
    this.paused = false
    this.flushResumeWaiters()
  }

  isStopped(): boolean {
    return this.stopped
  }

  async waitIfPaused(): Promise<void> {
    if (this.stopped) throw new ZaloActionStoppedError()
    if (!this.paused) return
    await new Promise<void>((resolve) => this.resumeWaiters.add(resolve))
    if (this.stopped) throw new ZaloActionStoppedError()
  }

  async checkpoint(): Promise<void> {
    await this.waitIfPaused()
    if (this.stopped) throw new ZaloActionStoppedError()
  }

  async sleep(delayMs: number): Promise<void> {
    const deadline = Date.now() + Math.max(0, delayMs)
    while (Date.now() < deadline) {
      await this.checkpoint()
      const remaining = deadline - Date.now()
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(250, Math.max(0, remaining))))
    }
    await this.checkpoint()
  }

  private flushResumeWaiters(): void {
    const waiters = [...this.resumeWaiters]
    this.resumeWaiters.clear()
    for (const resolve of waiters) resolve()
  }
}
