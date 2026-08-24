import { describe, expect, it } from 'vitest'
import { BrowserLaunchGate } from './runtimeLaunchGate'

describe('BrowserLaunchGate', () => {
  it('staggers the first Chrome launch of concurrent Page Tab runs without serializing work after launch', async () => {
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
      gate.wait(2_000, 'run-a').then(() => starts.push(now)),
      gate.wait(2_000, 'run-b').then(() => starts.push(now)),
      gate.wait(2_000, 'run-c').then(() => starts.push(now))
    ])

    expect(starts).toEqual([1_000, 3_000, 5_000])
    expect(sleeps).toEqual([2_000, 2_000])
  })

  it('does not add Page Tab launch spacing again when the same run switches account', async () => {
    let now = 10_000
    const sleeps: number[] = []
    const gate = new BrowserLaunchGate({
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      }
    })

    await gate.wait(2_000, 101)
    await gate.wait(2_000, 101)
    expect(now).toBe(10_000)
    expect(sleeps).toEqual([])

    await gate.wait(2_000, 202)
    expect(now).toBe(12_000)
    expect(sleeps).toEqual([2_000])
  })

  it('allows immediate launches when spacing is disabled', async () => {
    let now = 7_000
    const gate = new BrowserLaunchGate({ now: () => now, sleep: async (milliseconds) => { now += milliseconds } })
    await gate.wait(0, 'run-a')
    await gate.wait(0, 'run-b')
    expect(now).toBe(7_000)
  })
})
