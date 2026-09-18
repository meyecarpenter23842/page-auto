import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneDefaultZaloBrowserSettings, maskZaloPassword, normalizeZaloPhone } from '../../shared/zalo'
import { applyZaloMigration } from '../database/zaloMigration'
import { ZaloAccountRepository } from '../database/zaloRepository'
import { ZaloExecutionCoordinator } from './zaloExecutionCoordinator'
import { appManagedZaloProfileRoot, resolveZaloProfileDirectory, ZaloProfileResolutionError } from './zaloProfileResolver'
import { classifyZaloSessionEvidence, waitForZaloSessionState } from './zaloSessionEvidence'

const roots: string[] = []
function tempRoot(): string { const root = mkdtempSync(join(tmpdir(), 'page-auto-zalo-')); roots.push(root); return root }
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }) })

function openDb(file: string): Database.Database {
  const db = new Database(file)
  db.exec('CREATE TABLE IF NOT EXISTS __page_auto_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
  applyZaloMigration(db)
  return db
}

describe('Zalo Batch 1 foundation', () => {
  it('persists CRUD across database restart and canonicalizes phone', () => {
    const file = join(tempRoot(), 'page-auto.sqlite')
    let db = openDb(file)
    let repo = new ZaloAccountRepository(db)
    const created = repo.create({ phone: '+84 912 345 678', password: 'secret-value', displayName: 'Zalo A' })
    expect(created.phone).toBe('0912345678')
    expect(normalizeZaloPhone(created.phone)).toBe(created.phone)
    db.close()

    db = openDb(file)
    repo = new ZaloAccountRepository(db)
    expect(repo.list()).toMatchObject([{ id: created.id, phone: '0912345678', displayName: 'Zalo A' }])
    expect(repo.update({ id: created.id, patch: { note: 'persistent' } }).note).toBe('persistent')
    expect(repo.delete(created.id)).toBe(true)
    expect(repo.list()).toHaveLength(0)
    db.close()
  })

  it('masks password for renderer surfaces', () => {
    expect(maskZaloPassword('plain-secret')).toBe('••••••••')
    expect(maskZaloPassword(null)).toBe('')
  })

  it('keeps Zalo profile root independent and rejects invalid external root without fallback', () => {
    const data = tempRoot()
    const defaults = cloneDefaultZaloBrowserSettings()
    const managed = resolveZaloProfileDirectory(data, { id: 1 }, defaults)
    expect(managed.profileRoot).toBe(appManagedZaloProfileRoot(data))
    expect(managed.profileRoot).toContain('zalo-browser-profiles')

    const external = join(data, 'external-zalo')
    mkdirSync(external)
    const explicit = resolveZaloProfileDirectory(data, { id: 1 }, { ...defaults, profileRoot: external })
    expect(explicit.profileRoot).toBe(external)

    expect(() => resolveZaloProfileDirectory(data, { id: 1 }, { ...defaults, profileRoot: join(data, 'missing-root') }))
      .toThrow(ZaloProfileResolutionError)
  })

  it('never treats logged-out/QR/unknown evidence as ready', () => {
    expect(classifyZaloSessionEvidence({ authenticatedShell: false, loginSurface: true, qrSurface: false, attentionSurface: false })).toBe('login_required')
    expect(classifyZaloSessionEvidence({ authenticatedShell: false, loginSurface: true, qrSurface: true, attentionSurface: false })).toBe('qr_waiting')
    expect(classifyZaloSessionEvidence({ authenticatedShell: false, loginSurface: false, qrSurface: false, attentionSurface: false })).toBe('needs_attention')
    expect(classifyZaloSessionEvidence({ authenticatedShell: true, loginSurface: false, qrSurface: false, attentionSurface: false })).toBe('ready')
  })

  it('accepts visible authenticated chat surfaces while real challenge evidence still wins', () => {
    expect(classifyZaloSessionEvidence({
      authenticatedShell: false,
      loginSurface: false,
      qrSurface: false,
      attentionSurface: false,
      chatSearchSurface: true,
      composerSurface: false
    })).toBe('ready')

    expect(classifyZaloSessionEvidence({
      authenticatedShell: false,
      loginSurface: false,
      qrSurface: false,
      attentionSurface: true,
      chatSearchSurface: true,
      composerSurface: true
    })).toBe('needs_attention')

    expect(classifyZaloSessionEvidence({
      authenticatedShell: false,
      loginSurface: true,
      qrSurface: false,
      attentionSurface: false,
      chatSearchSurface: true,
      composerSurface: false
    })).toBe('ready')

    expect(classifyZaloSessionEvidence({
      authenticatedShell: false,
      loginSurface: false,
      qrSurface: true,
      attentionSurface: false,
      chatSearchSurface: true,
      composerSurface: false
    })).toBe('ready')
  })

  it('waits through a transient unknown DOM until authenticated chat evidence appears', async () => {
    let calls = 0
    const status = await waitForZaloSessionState(async () => {
      calls += 1
      if (calls === 1) {
        return { authenticatedShell: false, loginSurface: false, qrSurface: false, attentionSurface: false }
      }
      return {
        authenticatedShell: false,
        loginSurface: false,
        qrSurface: false,
        attentionSurface: false,
        chatSearchSurface: true
      }
    }, { timeoutMs: 100, pollIntervalMs: 0, sleep: async () => undefined })

    expect(status).toBe('ready')
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('owns a separate Zalo lease namespace so numeric Facebook IDs cannot collide', () => {
    const zalo = new ZaloExecutionCoordinator()
    const first = zalo.tryAcquire(1)
    expect(first).not.toBeNull()
    expect(zalo.tryAcquire(1)).toBeNull()
    first?.release()
    expect(zalo.tryAcquire(1)).not.toBeNull()
  })

  it('keeps renderer free from direct Playwright, SQLite, filesystem and Zalo post-store imports', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/src/zalo/ZaloWorkspace.tsx'), 'utf8')
    expect(source).not.toMatch(/playwright|better-sqlite3|node:fs|node:path|articleManager|zalo.*post.*store/i)
    expect(source).toContain('window.pageAutoZalo')
  })

  it('separates account/session management from the Zalo automation tab', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/src/zalo/ZaloWorkspace.tsx'), 'utf8')
    expect(source).toContain("type ZaloSubTab = 'accounts' | 'automation'")
    expect(source).toContain('Tài khoản Zalo')
    expect(source).toContain('Gửi tin / Kết bạn')
    expect(source).toContain("activeTab === 'automation' ? <ZaloBatchPanel")
    expect(source).toContain('accounts={accounts}')
    expect(source).toContain('onAccountsChanged={loadAccounts}')
    expect(source).toContain("activeTab === 'accounts' ? (")
    expect(source).not.toContain('Batch hiện tại chạy một account + một target')
  })
})
