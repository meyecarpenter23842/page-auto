import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./globalBrowserDock.css', import.meta.url), 'utf8')
const ipcSource = readFileSync(new URL('../../main/ipc.ts', import.meta.url), 'utf8')
const dockManagerSource = readFileSync(new URL('../../main/browser/accountBrowserDockManager.ts', import.meta.url), 'utf8')
const slotPoolSource = readFileSync(new URL('../../main/browser/browserSlotPool.ts', import.meta.url), 'utf8')

describe('global Chrome workspace entry point', () => {
  it('keeps Cửa sổ Chrome in the app topbar for every route', () => {
    expect(appSource).toContain('await window.pageAuto.openAccountBrowserDock()')
    expect(appSource).toContain('className="button secondary global-browser-dock-button"')
    expect(appSource).toContain("browserDockOpening ? 'Đang mở…' : 'Cửa sổ Chrome'")
    expect(css).toContain('.topbar-actions')
  })

  it('removes the obsolete account-selection-only duplicate button from the visible Account toolbar', () => {
    expect(css).toContain('.account-manager .account-toolbar > .toolbar-group:nth-child(2) > .button:first-child')
    expect(css).toContain('display: none;')
  })

  it('feeds the native dock from the shared slot pool without filtering to profile owner', () => {
    expect(slotPoolSource).toContain("'profile' | 'posting' | 'scenario'")
    expect(ipcSource).toContain('const accountIds = display?.slotRuntime.assignments')
    expect(ipcSource).toContain('.map((assignment) => assignment.accountId) ?? []')
    expect(ipcSource).not.toContain(".filter((assignment) => assignment.owners.includes('profile'))")
  })

  it('auto-syncs profiles into an independent top-level workspace regardless of open order', () => {
    expect(dockManagerSource).toContain('async open(owner: BrowserWindow | null): Promise<AccountBrowserDockOpenResult>')
    expect(dockManagerSource).toContain('return this.openExplicit(owner)')
    expect(dockManagerSource).toContain('async sync(): Promise<void>')
    expect(dockManagerSource).toContain('await this.enqueueSync()')
    expect(dockManagerSource).toContain('const DISCOVER_POLL_MS = 700')
    expect(dockManagerSource).toContain('void this.enqueueSync().finally(() => this.scheduleDiscover())')
    expect(dockManagerSource).not.toContain("{ parent: owner }")
    expect(dockManagerSource).toContain("owner.once('closed'")
  })
})
