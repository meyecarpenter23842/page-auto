import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountRecord } from '../../shared/accounts'
import type { FacebookCheckpoint282Result } from '../../shared/facebookCheckpoint'
import { checkpoint282CanonicalFolder, readCheckpoint282History } from '../browser/checkpoint282Assets'
import { Checkpoint282RunLifecycle } from './checkpoint282RunLifecycle'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'page-auto-cp282-run-'))
  roots.push(root)
  return root
}

function account(uid: string): AccountRecord {
  return { id: 1, uid } as AccountRecord
}

function resolved(uid: string): FacebookCheckpoint282Result {
  return {
    accountId: 1,
    uid,
    state: 'resolved',
    surface: 'mbasic',
    message: 'resolved'
  }
}

describe('Checkpoint282RunLifecycle', () => {
  it('promotes the confirmed source asset after a resolved numeric UID run', async () => {
    const root = tempRoot()
    const source = join(root, 'used.jpg')
    writeFileSync(source, 'used')
    const lifecycle = new Checkpoint282RunLifecycle(root)
    const result = await lifecycle.execute(account('123456'), {
      accountId: 1,
      surface: 'mbasic',
      action: 'recheck',
      asset: { path: source, origin: 'source', replaceCanonical: false, confirmedUsed: true }
    }, async () => resolved('123456'))

    expect(result.identityVerification).toBe('uid_match')
    expect(result.assetPromotion?.state).toBe('promoted')
    expect(readCheckpoint282History(root, '123456')[0]).toEqual(
      expect.objectContaining({ state: 'resolved', promotionState: 'promoted', assetConfirmedUsed: true })
    )
  })

  it('keeps a resolved nonnumeric account but skips canonical promotion', async () => {
    const root = tempRoot()
    const source = join(root, 'used.jpg')
    writeFileSync(source, 'used')
    const lifecycle = new Checkpoint282RunLifecycle(root)
    const result = await lifecycle.execute(account('login-name'), {
      accountId: 1,
      surface: 'mbasic',
      action: 'recheck',
      asset: { path: source, origin: 'source', replaceCanonical: false, confirmedUsed: true }
    }, async () => resolved('login-name'))

    expect(result.identityVerification).toBe('session_only')
    expect(result.assetPromotion?.state).toBe('skipped_unverified')
  })

  it('does not promote a source asset when resolved without operator confirmation', async () => {
    const root = tempRoot()
    const source = join(root, 'used.jpg')
    writeFileSync(source, 'used')
    const lifecycle = new Checkpoint282RunLifecycle(root)
    const result = await lifecycle.execute(account('123456'), {
      accountId: 1,
      surface: 'mbasic',
      action: 'start',
      asset: { path: source, origin: 'source', replaceCanonical: false, confirmedUsed: false }
    }, async () => resolved('123456'))

    expect(result.assetPromotion?.state).toBe('skipped_unconfirmed')
  })

  it('does not promote a confirmed source asset when the CP run fails', async () => {
    const root = tempRoot()
    const source = join(root, 'used.jpg')
    writeFileSync(source, 'used')
    const lifecycle = new Checkpoint282RunLifecycle(root)
    const result = await lifecycle.execute(account('123456'), {
      accountId: 1,
      surface: 'mbasic',
      action: 'recheck',
      asset: { path: source, origin: 'source', replaceCanonical: false, confirmedUsed: true }
    }, async () => ({
      accountId: 1,
      uid: '123456',
      state: 'error',
      surface: 'mbasic',
      message: 'failed'
    }))

    expect(result.state).toBe('error')
    expect(result.assetPromotion).toBeUndefined()
    expect(existsSync(join(checkpoint282CanonicalFolder(root), '123456.jpg'))).toBe(false)
  })

  it('normalizes an interrupted active run to stopped before promotion/history', async () => {
    const root = tempRoot()
    const source = join(root, 'used.jpg')
    writeFileSync(source, 'used')
    const lifecycle = new Checkpoint282RunLifecycle(root)
    const result = await lifecycle.execute(account('123456'), {
      accountId: 1,
      surface: 'mbasic',
      action: 'recheck',
      asset: { path: source, origin: 'source', replaceCanonical: false, confirmedUsed: true }
    }, async () => ({
      accountId: 1,
      uid: '123456',
      state: 'error',
      surface: 'mbasic',
      message: 'browser closed'
    }), {
      normalizeResult: (candidate) => ({ ...candidate, state: 'stopped', message: 'stopped by operator' })
    })

    expect(result.state).toBe('stopped')
    expect(result.assetPromotion).toBeUndefined()
    expect(readCheckpoint282History(root, '123456')[0]).toEqual(
      expect.objectContaining({ state: 'stopped', promotionState: null })
    )
  })

  it('records an explicit operator stop while no run promise is active', () => {
    const root = tempRoot()
    const lifecycle = new Checkpoint282RunLifecycle(root)
    const result = lifecycle.recordOperatorStop(account('123456'), 'mbasic')

    expect(result.state).toBe('stopped')
    expect(readCheckpoint282History(root, '123456')[0]).toEqual(
      expect.objectContaining({ state: 'stopped', action: 'stop' })
    )
  })

  it('rejects stale/missing selected assets before touching the browser runner', async () => {
    const root = tempRoot()
    const lifecycle = new Checkpoint282RunLifecycle(root)
    const run = vi.fn(async () => resolved('123456'))
    const result = await lifecycle.execute(account('123456'), {
      accountId: 1,
      surface: 'mbasic',
      action: 'start',
      asset: { path: join(root, 'missing.jpg'), origin: 'source', replaceCanonical: false, confirmedUsed: false }
    }, run)

    expect(result.state).toBe('error')
    expect(run).not.toHaveBeenCalled()
    expect(readCheckpoint282History(root, '123456')[0]?.state).toBe('error')
  })
})
