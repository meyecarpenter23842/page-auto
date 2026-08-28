import { describe, expect, it } from 'vitest'
import { AccountExecutionCoordinator } from './accountExecutionCoordinator'

describe('AccountExecutionCoordinator', () => {
  it('allows different accounts in parallel but serializes the same account profile', async () => {
    const coordinator = new AccountExecutionCoordinator()
    const events: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })

    const first = coordinator.run(101, async () => {
      events.push('101:first:start')
      await firstGate
      events.push('101:first:end')
      return 1
    })
    const second = coordinator.run(101, async () => {
      events.push('101:second:start')
      return 2
    })
    const other = coordinator.run(202, async () => {
      events.push('202:start')
      return 3
    })

    await Promise.resolve()
    expect(events).toContain('101:first:start')
    expect(events).toContain('202:start')
    expect(events).not.toContain('101:second:start')

    releaseFirst()
    await Promise.all([first, second, other])
    expect(events.indexOf('101:second:start')).toBeGreaterThan(events.indexOf('101:first:end'))
  })

  it('holds a same-account lease across operator work while other accounts keep running', async () => {
    const coordinator = new AccountExecutionCoordinator()
    const lease = coordinator.tryAcquireLease(101)
    expect(lease).not.toBeNull()
    expect(coordinator.tryAcquireLease(101)).toBeNull()

    let sameAccountEntered = false
    let otherAccountEntered = false
    const sameAccount = coordinator.run(101, async () => {
      sameAccountEntered = true
      return 1
    })
    const otherAccount = coordinator.run(202, async () => {
      otherAccountEntered = true
      return 2
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(sameAccountEntered).toBe(false)
    expect(otherAccountEntered).toBe(true)

    lease?.release()
    await Promise.all([sameAccount, otherAccount])
    expect(sameAccountEntered).toBe(true)
    expect(coordinator.tryAcquireLease(101)).not.toBeNull()
  })
})
