import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkpoint282CanonicalFolder } from '../browser/checkpoint282Assets'
import { AccountRepository } from '../database/accountRepository'
import { initializeDatabase, type DatabaseRuntime } from '../database'
import { Checkpoint282WorkbenchService } from './checkpoint282WorkbenchService'

const roots: string[] = []
const runtimes: DatabaseRuntime[] = []

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'page-auto-cp282-workbench-'))
  roots.push(root)
  const runtime = initializeDatabase(join(root, 'page-auto.sqlite'))
  runtimes.push(runtime)
  return {
    root,
    accounts: new AccountRepository(runtime.client),
    service: new Checkpoint282WorkbenchService(runtime.client, root)
  }
}

describe('Checkpoint282WorkbenchService', () => {
  it('persists a non-secret preset and reports source fallback as warning', () => {
    const { root, accounts, service } = setup()
    const source = join(root, 'source')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'fresh.jpg'), 'image')
    const account = accounts.create({ uid: '10001', password: 'password' })

    service.savePreset({ surface: 'mbasic', locale: 'vi-VN', sourceImageFolder: source })
    const result = service.preflight({ accountIds: [account.id] })

    expect(result.preset).toEqual({ surface: 'mbasic', locale: 'vi-VN', sourceImageFolder: source })
    expect(result.rows[0]?.image.state).toBe('source')
    expect(result.rows[0]?.level).toBe('warning')
    expect(result.summary).toEqual({ ok: 0, warning: 1, blocked: 0 })
  })

  it('prefers Folder282 canonical image and marks the account ready', () => {
    const { root, accounts, service } = setup()
    const canonical = checkpoint282CanonicalFolder(root)
    mkdirSync(canonical, { recursive: true })
    writeFileSync(join(canonical, '10002.png'), 'canonical')
    const account = accounts.create({ uid: '10002', cookie: 'c_user=10002; xs=test' })

    const result = service.preflight({ accountIds: [account.id] })
    expect(result.rows[0]?.image.state).toBe('canonical')
    expect(result.rows[0]?.level).toBe('ok')
    expect(result.summary.ok).toBe(1)
  })

  it('blocks missing images and duplicate canonical assets', () => {
    const { root, accounts, service } = setup()
    const missing = accounts.create({ uid: '10003', cookie: 'c_user=10003; xs=test' })
    const duplicate = accounts.create({ uid: '10004', cookie: 'c_user=10004; xs=test' })
    const canonical = checkpoint282CanonicalFolder(root)
    mkdirSync(canonical, { recursive: true })
    writeFileSync(join(canonical, '10004.jpg'), 'a')
    writeFileSync(join(canonical, '10004.png'), 'b')

    const result = service.preflight({ accountIds: [missing.id, duplicate.id] })
    expect(result.rows.map((row) => row.image.state)).toEqual(['missing', 'duplicate'])
    expect(result.summary.blocked).toBe(2)
  })
})
