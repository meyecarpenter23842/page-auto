import { describe, expect, it } from 'vitest'
import { BrowserLaunchGate } from './runtimeLaunchGate'

describe('BrowserLaunchGate', () => {
  it('spaces concurrent browser launches globally without serializing the work after launch', async () => {
    let now = 1_000
    const sleeps: number[] = []
    const starts: number[] = []
    const gate = new BrowserLaunchGate({
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      }
    })

    await Promise.all([
      gate.wait(2_000).then(() => starts.push(now)),
      gate.wait(2_000).then(() => starts.push(now)),
      gate.wait(2_000).then(() => starts.push(now))
    ])

    expect(starts).toEqual([1_000, 3_000, 5_000])
    expect(sleeps).toEqual([2_000, 2_000])
  })

  it('allows immediate launches when spacing is disabled', async () => {
    let now = 7_000
    const gate = new BrowserLaunchGate({ now: () => now, sleep: async (milliseconds) => { now += milliseconds } })
    await gate.wait(0)
    await gate.wait(0)
    expect(now).toBe(7_000)
  })
})
