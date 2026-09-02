export interface LaunchGateClock {
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
}

const defaultClock: LaunchGateClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class BrowserLaunchGate {
  private tail = Promise.resolve()
  private lastLaunchAt: number | null = null

  constructor(private readonly clock: LaunchGateClock = defaultClock) {}

  /** Every actual new Chrome launch shares one serialized spacing timeline. */
  async wait(spacingMs: number): Promise<void> {
    let release!: () => void
    const previous = this.tail
    const gate = new Promise<void>((resolve) => { release = resolve })
    this.tail = previous.then(() => gate)

    await previous
    try {
      const normalizedSpacing = Math.max(0, Math.round(spacingMs))
      if (this.lastLaunchAt !== null && normalizedSpacing > 0) {
        const remaining = this.lastLaunchAt + normalizedSpacing - this.clock.now()
        if (remaining > 0) await this.clock.sleep(remaining)
      }
      this.lastLaunchAt = this.clock.now()
    } finally {
      release()
    }
  }
}

/** Electron Main owns exactly one launch timeline for the whole app process. */
export const globalBrowserLaunchGate = new BrowserLaunchGate()
