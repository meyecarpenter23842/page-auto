import { describe, expect, it } from 'vitest'
import { BrowserSlotPool } from './browserSlotPool'

describe('BrowserSlotPool', () => {
  it('keeps profile, posting and scenario owners on one account slot', () => {
    const pool = new BrowserSlotPool()

    expect(pool.claim(22, 'profile')).toMatchObject({ slotIndex: 0, status: 'allocated' })
    expect(pool.claim(22, 'posting')).toMatchObject({ slotIndex: 0, status: 'shared' })
    expect(pool.claim(22, 'scenario')).toMatchObject({ slotIndex: 0, status: 'shared' })
    expect(pool.claim(22, 'posting')).toMatchObject({ slotIndex: 0, status: 'existing' })
    expect(pool.activeCount()).toBe(1)
    expect(pool.snapshot()).toEqual([
      { accountId: 22, slotIndex: 0, owners: ['posting', 'profile', 'scenario'] }
    ])
  })

  it('retains the slot until the final owner releases it', () => {
    const pool = new BrowserSlotPool()
    pool.claim(7, 'profile')
    pool.claim(7, 'posting')
    pool.claim(7, 'scenario')

    expect(pool.release(7, 'scenario')).toMatchObject({ slotIndex: 0, status: 'retained' })
    expect(pool.release(7, 'posting')).toMatchObject({ slotIndex: 0, status: 'retained' })
    expect(pool.slotFor(7)).toBe(0)
    expect(pool.release(7, 'profile')).toMatchObject({ slotIndex: 0, status: 'freed' })
    expect(pool.slotFor(7)).toBeNull()
    expect(pool.activeCount()).toBe(0)
  })

  it('reuses the lowest free slot without moving unrelated active accounts', () => {
    const pool = new BrowserSlotPool()
    pool.claim(1, 'profile')
    pool.claim(2, 'profile')
    pool.claim(3, 'profile')

    pool.release(2, 'profile')
    expect(pool.slotFor(1)).toBe(0)
    expect(pool.slotFor(3)).toBe(2)

    expect(pool.claim(4, 'profile')).toMatchObject({ slotIndex: 1, status: 'allocated' })
    expect(pool.slotFor(1)).toBe(0)
    expect(pool.slotFor(3)).toBe(2)
  })

  it('keeps dozens of account slots unique and deterministically reuses holes', () => {
    const pool = new BrowserSlotPool()
    const accountIds = Array.from({ length: 36 }, (_, index) => index + 1)
    for (const accountId of accountIds) pool.claim(accountId, 'posting')

    const initialSlots = pool.snapshot().map((entry) => entry.slotIndex)
    expect(new Set(initialSlots).size).toBe(36)
    expect(initialSlots).toEqual(Array.from({ length: 36 }, (_, index) => index))

    const released = [3, 8, 13, 18, 23, 28, 33]
    const releasedSlots = released.map((accountId) => pool.slotFor(accountId))
    for (const accountId of released) pool.release(accountId, 'posting')

    const replacements = [101, 102, 103, 104, 105, 106, 107]
    const replacementSlots = replacements.map((accountId) => pool.claim(accountId, 'posting').slotIndex)
    expect(replacementSlots).toEqual(releasedSlots)

    const finalSlots = pool.snapshot().map((entry) => entry.slotIndex)
    expect(new Set(finalSlots).size).toBe(finalSlots.length)
    expect(pool.activeCount()).toBe(36)
  })

  it('releases a crash-style final owner and makes its slot immediately reusable', () => {
    const pool = new BrowserSlotPool()
    pool.claim(41, 'posting')
    pool.claim(42, 'posting')

    expect(pool.release(41, 'posting')).toMatchObject({ slotIndex: 0, status: 'freed' })
    expect(pool.claim(99, 'profile')).toMatchObject({ slotIndex: 0, status: 'allocated' })
    expect(pool.slotFor(42)).toBe(1)
  })

  it('compacts only when explicitly requested', () => {
    const pool = new BrowserSlotPool()
    pool.claim(10, 'profile')
    pool.claim(20, 'profile')
    pool.claim(30, 'profile')
    pool.release(20, 'profile')

    expect(pool.slotFor(30)).toBe(2)
    expect(pool.compact()).toBe(1)
    expect(pool.slotFor(10)).toBe(0)
    expect(pool.slotFor(30)).toBe(1)
    expect(pool.claim(40, 'profile')).toMatchObject({ slotIndex: 2, status: 'allocated' })
  })

  it('treats duplicate and missing releases as idempotent no-ops', () => {
    const pool = new BrowserSlotPool()
    pool.claim(5, 'profile')

    expect(pool.release(5, 'posting').status).toBe('owner_missing')
    expect(pool.slotFor(5)).toBe(0)
    expect(pool.release(999, 'profile').status).toBe('missing')
    expect(pool.slotFor(5)).toBe(0)
  })
})
