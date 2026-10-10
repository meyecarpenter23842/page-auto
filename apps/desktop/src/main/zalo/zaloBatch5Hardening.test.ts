import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertValidZaloBrowserSettings,
  cloneDefaultZaloBrowserSettings,
  redactZaloSecretText
} from '../../shared/zalo'
import { ZaloSettingsRepository } from '../database/zaloSettingsRepository'
import { interruptedZaloActionResult } from './zaloRuntimeInterruption'
import { appManagedZaloProfileRoot, resolveZaloProfileDirectory, ZaloProfileResolutionError } from './zaloProfileResolver'

const roots: string[] = []
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'page-auto-zalo-b5-'))
  roots.push(root)
  return root
}
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function openSettingsDb(file: string): Database.Database {
  const db = new Database(file)
  db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)')
  return db
}

describe('Zalo Batch 5 Windows hardening matrix', () => {
  it('keeps managed profile roots portable across restored data directories and fails closed for stale external roots', () => {
    const dataA = tempRoot()
    const dataB = tempRoot()
    const defaults = cloneDefaultZaloBrowserSettings()

    const managedA = resolveZaloProfileDirectory(dataA, { id: 9 }, defaults)
    const managedB = resolveZaloProfileDirectory(dataB, { id: 9 }, defaults)
    expect(managedA.profileRoot).toBe(appManagedZaloProfileRoot(dataA))
    expect(managedB.profileRoot).toBe(appManagedZaloProfileRoot(dataB))
    expect(managedA.profileDirectory).not.toBe(managedB.profileDirectory)
    expect(managedA.profileDirectory.endsWith(join('zalo-browser-profiles', '9'))).toBe(true)

    const staleExternal = join(dataA, 'restored-on-another-machine')
    expect(() => resolveZaloProfileDirectory(dataB, { id: 9 }, { ...defaults, profileRoot: staleExternal }))
      .toThrow(ZaloProfileResolutionError)
  })

  it('round-trips Zalo browser settings through app_settings backup-style restore without touching Facebook settings', () => {
    const root = tempRoot()
    const external = join(root, 'zalo-profiles')
    mkdirSync(external)

    const dbA = openSettingsDb(join(root, 'a.sqlite'))
    const repoA = new ZaloSettingsRepository(dbA)
    const saved = repoA.save({
      ...cloneDefaultZaloBrowserSettings(),
      profileRoot: external,
      windowWidth: 1440,
      windowHeight: 900,
      layout: {
        ...cloneDefaultZaloBrowserSettings().layout,
        enabled: true,
        autoFit: true,
        tileCount: 6,
        gridColumns: 3
      }
    })
    const row = dbA.prepare('SELECT key, value, updated_at FROM app_settings').get() as { key: string; value: string; updated_at: number }
    dbA.close()

    const dbB = openSettingsDb(join(root, 'b.sqlite'))
    dbB.prepare('INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)').run(row.key, row.value, row.updated_at)
    const restored = new ZaloSettingsRepository(dbB).get()
    dbB.close()

    expect(restored).toEqual(saved)
    expect(row.key).toBe('settings.zalo-browser')
  })

  it('keeps legacy Zalo size/layout fields valid for backup compatibility', () => {
    const base = cloneDefaultZaloBrowserSettings()
    const sizes: Array<[number, number]> = [[800, 600], [1280, 800], [1600, 1000], [1920, 1080]]
    for (const [windowWidth, windowHeight] of sizes) {
      expect(() => assertValidZaloBrowserSettings({
        ...base,
        windowWidth,
        windowHeight,
        layout: { ...base.layout, enabled: true, autoFit: true }
      })).not.toThrow()
    }
  })

  it('uses the canonical Chrome layout/whole-window scale instead of a Zalo-only scale surface', () => {
    const root = process.cwd()
    const ipc = readFileSync(join(root, 'src/main/zaloIpc.ts'), 'utf8')
    const runtime = readFileSync(join(root, 'src/main/zalo/zaloBrowserRuntime.ts'), 'utf8')
    const worker = readFileSync(join(root, 'src/main/zalo/zalo-browser-worker.ts'), 'utf8')
    const workspace = readFileSync(join(root, 'src/renderer/src/zalo/ZaloWorkspace.tsx'), 'utf8')

    expect(ipc).toContain('new AppSettingsRepository(client)')
    expect(ipc).toContain('new BrowserWindowLayoutRepository(client)')
    expect(ipc).toContain('() => appSettings.get().browser')
    expect(ipc).toContain('() => browserWindowLayout.get()')
    expect(runtime).toContain('this.getWindowLayoutSettings()')
    expect(runtime).not.toContain('settings.layout, asBrowserSettings(settings)')
    expect(worker).toContain('--force-device-scale-factor=')
    expect(worker).toContain('sameWholeChromeScale')
    expect(workspace).toContain('kích thước theo Chrome chung')
    expect(workspace).not.toContain('<label>Rộng')
    expect(workspace).not.toContain('<label>Cao')
    expect(workspace).not.toContain('> Bật layout</label>')
    expect(workspace).not.toContain('> Auto Fit</label>')
  })

  it('redacts password material from diagnostic text', () => {
    const password = 'zalo-secret-123'
    const text = redactZaloSecretText(`login failed password=${password}; retry ${password}`, [password])
    expect(text).not.toContain(password)
    expect(text).toContain('[REDACTED]')
  })

  it('distinguishes operator stop from unexpected worker crash so rolling batches can recover', () => {
    const action = { type: 'send_message' as const, targetPhone: '0912345678', content: 'hello' }
    const stopped = interruptedZaloActionResult(1, action, 'operator_close', 'operator closed')
    expect(stopped.status).toBe('stopped')
    expect(stopped.code).toBe('stopped')

    const crashed = interruptedZaloActionResult(1, action, 'worker_crash', 'worker crashed')
    expect(crashed.status).toBe('failed')
    expect(crashed.code).toBe('executor_exception')
  })

  it('wires crash classification into runtime and only treats an actual stopped result as a batch stop', () => {
    const root = process.cwd()
    const runtime = readFileSync(join(root, 'src/main/zalo/zaloBrowserRuntime.ts'), 'utf8')
    const batch = readFileSync(join(root, 'src/main/zalo/zaloBatchRunner.ts'), 'utf8')
    const login = readFileSync(join(root, 'src/main/zalo/zaloLoginFlow.ts'), 'utf8')
    const actions = [
      readFileSync(join(root, 'src/main/zalo/actions/sendMessage.ts'), 'utf8'),
      readFileSync(join(root, 'src/main/zalo/actions/sendAttachment.ts'), 'utf8'),
      readFileSync(join(root, 'src/main/zalo/actions/addFriend.ts'), 'utf8')
    ].join('\n')

    expect(runtime).toContain("'worker_crash'")
    expect(runtime).toContain('interruptedZaloActionResult')
    expect(batch).toContain("result.status === 'stopped'")
    expect(login).toContain('runZaloPhonePasswordLogin')
    expect(login).toContain('runZaloQrLogin')
    expect(actions).toContain('sendZaloMessage')
    expect(actions).toContain('sendZaloAttachment')
    expect(actions).toContain('addZaloFriend')
  })
})
