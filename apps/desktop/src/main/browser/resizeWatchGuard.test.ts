import { describe, expect, it, vi } from 'vitest'
import { runWithResizeWatcherPaused } from './resizeWatchGuard'

describe('runWithResizeWatcherPaused', () => {
  it('stops the old watcher before retile and arms a new watcher only after apply finishes', async () => {
    const events: string[] = []
    let releaseApply: () => void = () => undefined
    const applyGate = new Promise<void>((resolve) => { releaseApply = resolve })
    const stopWatching = vi.fn(() => { events.push('stop') })
    const armWatching = vi.fn(() => { events.push('arm') })

    const pending = runWithResizeWatcherPaused(
      stopWatching,
      async () => {
        events.push('apply:start')
        await applyGate
        events.push('apply:end')
      },
      armWatching
    )

    expect(events).toEqual(['stop', 'apply:start'])
    expect(armWatching).not.toHaveBeenCalled()

    releaseApply()
    await pending

    expect(events).toEqual(['stop', 'apply:start', 'apply:end', 'arm'])
    expect(stopWatching).toHaveBeenCalledTimes(1)
    expect(armWatching).toHaveBeenCalledTimes(1)
  })

  it('re-arms the watcher even if the programmatic placement fails', async () => {
    const stopWatching = vi.fn()
    const armWatching = vi.fn()

    await expect(runWithResizeWatcherPaused(
      stopWatching,
      async () => { throw new Error('retile failed') },
      armWatching
    )).rejects.toThrow('retile failed')

    expect(stopWatching).toHaveBeenCalledTimes(1)
    expect(armWatching).toHaveBeenCalledTimes(1)
  })
})
