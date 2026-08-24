export interface LaunchGateClock {
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
}

const defaultClock: LaunchGateClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export type BrowserLaunchScope = string | number

export class BrowserLaunchGate {
  private tail = Promise.resolve()
  private lastLaunchAt: number | null = null
  private readonly launchedScopes = new Set<BrowserLaunchScope>()

  constructor(private readonly clock: LaunchGateClock = defaultClock) {}

  /**
   * When scopeId is provided, only the first Chrome launch in that Page Tab run is
   * staggered. Later account rotations in the same run rely on the Page Tab's own
   * account-switch delay instead of stacking both delays.
   */
  async wait(spacingMs: number, scopeId?: BrowserLaunchScope): Promise<void> {
    if (scopeId !== undefined) {
      if (this.launchedScopes.has(scopeId)) return
      this.launchedScopes.add(scopeId)
    }

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
