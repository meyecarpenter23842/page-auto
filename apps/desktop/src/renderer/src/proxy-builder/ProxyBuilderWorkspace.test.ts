import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./ProxyBuilderWorkspace.tsx', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../../../preload/proxyBuilderBridge.ts', import.meta.url), 'utf8')
const textPreload = readFileSync(new URL('../../../preload/proxyBuilderTextBridge.ts', import.meta.url), 'utf8')
const ipc = readFileSync(new URL('../../../main/proxyBuilderIpc.ts', import.meta.url), 'utf8')
const checker = readFileSync(new URL('../../../main/proxyBuilder/checkerService.ts', import.meta.url), 'utf8')
const packagedSmoke = readFileSync(new URL('../../../scripts/proxy-builder-packaged-ui-smoke.mjs', import.meta.url), 'utf8')

describe('Proxy Builder Batch 4 checker/export', () => {
  it('keeps Proxy Builder visible as a top-level route', () => {
    expect(app).toContain("id: 'proxy-builder', label: 'Proxy Builder'")
    expect(app).toContain("activeRoute === 'proxy-builder' ? <ProxyBuilderWorkspace />")
  })

  it('runs checker networking in Electron Main, not React', () => {
    expect(workspace).toContain('window.pageAutoProxyBuilder.startChecker')
    expect(workspace).toContain('window.pageAutoProxyBuilder.cancelChecker')
    expect(workspace).not.toContain("from 'node:net'")
    expect(workspace).not.toContain("from 'node:tls'")
    expect(ipc).toContain('new ProxyBuilderCheckerService()')
    expect(checker).toContain("connectTls({ socket: tunnel")
    expect(checker).toContain('CONNECT')
    expect(checker).toContain("TARGET_HOST = 'api64.ipify.org'")
    expect(preload).toContain('startChecker: (input) => ipcRenderer.invoke')
  })

  it('exposes selected/all test and LIVE copy/export without exposing credentials in checker snapshots', () => {
    for (const label of ['Test đã chọn', 'Test tất cả', 'Copy LIVE', 'Export LIVE']) expect(workspace).toContain(label)
    expect(workspace).toContain('maskedProxy')
    expect(textPreload).toContain("contextBridge.exposeInMainWorld('pageAutoProxyBuilderText', api)")
    expect(checker).toContain("maskedProxy:")
  })

  it('adds a packaged UI smoke that opens Proxy Builder and exercises a deterministic DEAD proxy', () => {
    expect(packagedSmoke).toContain("name: 'Proxy Builder'")
    expect(packagedSmoke).toContain("name: 'Proxy Checker'")
    expect(packagedSmoke).toContain("server.listen(0, '127.0.0.1'")
    expect(packagedSmoke).toContain("hasText: 'DEAD'")
    expect(packagedSmoke).toContain('407 Proxy Authentication Required')
  })
})
