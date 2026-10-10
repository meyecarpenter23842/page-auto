import { describe, expect, it } from 'vitest'
import { BrowserLaunchGate, type LaunchGateClock } from './runtimeLaunchGate'

describe('BrowserLaunchGate', () => {
  it('serializes concurrent launch slots using one shared spacing timeline', async () => {
    let now = 1_000
    const sleeps: number[] = []
    const clock: LaunchGateClock = {
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      }
    }
    const gate = new BrowserLaunchGate(clock)

    await Promise.all([gate.wait(2_000), gate.wait(2_000), gate.wait(2_000)])

    expect(sleeps).toEqual([2_000, 2_000])
    expect(now).toBe(5_000)
  })

  it('never bypasses spacing for repeated launches from the same logical run', async () => {
    let now = 10_000
    const sleeps: number[] = []
    const clock: LaunchGateClock = {
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      }
    }
    const gate = new BrowserLaunchGate(clock)

    await gate.wait(3_000)
    await gate.wait(3_000)
    await gate.wait(3_000)

    expect(sleeps).toEqual([3_000, 3_000])
    expect(now).toBe(16_000)
  })

  it('uses the spacing requested for each next actual launch', async () => {
    let now = 20_000
    const sleeps: number[] = []
    const clock: LaunchGateClock = {
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      }
    }
    const gate = new BrowserLaunchGate(clock)

    await gate.wait(1_000)
    await gate.wait(4_000)
    await gate.wait(2_000)

    expect(sleeps).toEqual([4_000, 2_000])
    expect(now).toBe(26_000)
  })
})
