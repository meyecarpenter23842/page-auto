import { describe, expect, it } from 'vitest'
import {
  CHANGE_INFO_CATALOG,
  createDefaultChangeInfoWorkspaceDraft,
  parseChangeInfoWorkspaceDraft,
  resolveChangeInfoDataSource,
  serializeChangeInfoWorkspaceDraft,
  validateChangeInfoWorkspaceDraft
} from './changeInfoWorkspace'

describe('changeInfoWorkspace', () => {
  it('starts with catalog-only audit gates and no enabled mutation', () => {
    const draft = createDefaultChangeInfoWorkspaceDraft()
    expect(draft.accountConcurrency).toBe(1)
    expect(draft.verifyAfterChange).toBe(true)
    expect(draft.actionOrder).toHaveLength(CHANGE_INFO_CATALOG.length)
    expect(Object.values(draft.actions).every((item) => !item.enabled)).toBe(true)
    expect(CHANGE_INFO_CATALOG.every((item) => item.supportStatus === 'audit_required' && item.actionType === null)).toBe(true)
  })

  it('round-trips config and clamps concurrency without enabling unknown actions', () => {
    const parsed = parseChangeInfoWorkspaceDraft(JSON.stringify({
      version: 1,
      accountConcurrency: 999,
      verifyAfterChange: false,
      actionOrder: ['bio', 'unknown'],
      actions: {
        bio: { enabled: true, source: { type: 'fixed', value: 'hello' } },
        unknown: { enabled: true, source: { type: 'fixed', value: 'bad' } }
      }
    }))
    expect(parsed.accountConcurrency).toBe(20)
    expect(parsed.verifyAfterChange).toBe(true)
    expect(parsed.actionOrder[0]).toBe('bio')
    expect(parsed.actions.bio?.enabled).toBe(true)
    expect(parsed.actions.unknown).toBeUndefined()
    expect(parseChangeInfoWorkspaceDraft(serializeChangeInfoWorkspaceDraft(parsed))).toEqual(parsed)
    expect(validateChangeInfoWorkspaceDraft(parsed)[0]).toContain('Tiểu sử')
  })

  it('resolves sequential and random list assignments deterministically', () => {
    const sequential = { type: 'sequential_from_list' as const, values: ['A', 'B', 'C'] }
    expect(resolveChangeInfoDataSource(sequential, { accountId: 10, accountIndex: 4, runSeed: 'run-1' })).toEqual({ status: 'resolved', value: 'B', index: 1 })

    const random = { type: 'random_from_list' as const, values: ['A', 'B', 'C'] }
    const first = resolveChangeInfoDataSource(random, { accountId: 10, accountIndex: 0, runSeed: 'run-1' })
    const second = resolveChangeInfoDataSource(random, { accountId: 10, accountIndex: 0, runSeed: 'run-1' })
    expect(second).toEqual(first)
  })

  it('keeps file/folder snapshot assignment deterministic for sequential and random modes', () => {
    const values = ['a.jpg', 'b.jpg', 'c.jpg']
    const sequential = resolveChangeInfoDataSource(
      { type: 'folder', path: 'D:/media', selectionMode: 'sequential' },
      { accountId: 10, accountIndex: 4, runSeed: 'run-1', snapshotValues: values }
    )
    const firstRandom = resolveChangeInfoDataSource(
      { type: 'folder', path: 'D:/media', selectionMode: 'random' },
      { accountId: 10, accountIndex: 4, runSeed: 'run-1', snapshotValues: values }
    )
    const secondRandom = resolveChangeInfoDataSource(
      { type: 'folder', path: 'D:/media', selectionMode: 'random' },
      { accountId: 10, accountIndex: 99, runSeed: 'run-1', snapshotValues: values }
    )
    expect(sequential).toMatchObject({ status: 'resolved', value: 'b.jpg', index: 1 })
    expect(secondRandom).toEqual(firstRandom)
  })

  it('keeps new password and 2FA items out of persisted data-source inputs', () => {
    expect(CHANGE_INFO_CATALOG.find((item) => item.key === 'change_password')?.allowedSources).toEqual([])
    expect(CHANGE_INFO_CATALOG.find((item) => item.key === 'enable_2fa')?.allowedSources).toEqual([])
  })
})
