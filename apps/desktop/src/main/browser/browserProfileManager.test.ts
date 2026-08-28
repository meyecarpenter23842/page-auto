import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AccountRecord } from '../../shared/accounts'
import { accountProfileDirectory, BrowserProfileManager } from './browserProfileManager'

describe('accountProfileDirectory', () => {
  it('keeps every account in an isolated persistent profile folder', () => {
    expect(accountProfileDirectory('D:\\PageAutoData', 42)).toBe(
      join('D:\\PageAutoData', 'browser-profiles', 'account-42')
    )
  })

  it('blocks checkpoint 282 while the same account profile bootstrap is still in flight', async () => {
    const manager = new BrowserProfileManager('D:\\PageAutoData')
    const timer = setTimeout(() => undefined, 60_000)
    const workers = (manager as unknown as { workers: Map<number, unknown> }).workers
    workers.set(42, {
      process: {},
      pending: { resolve: () => undefined, timer, openStatus: 'started' },
      checkpoint282Pending: null,
      checkpoint282StaleResultCount: 0,
      closing: false,
      closePromise: null
    })

    try {
      const result = await manager.runCheckpoint282(
        { id: 42, uid: '123456' } as AccountRecord,
        { surface: 'mbasic', action: 'start', evidenceFolder: null }
      )
      expect(result.state).toBe('error')
      expect(result.message).toContain('đang khởi động')
    } finally {
      clearTimeout(timer)
    }
  })
})
