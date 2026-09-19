import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./ProxyBuilderWorkspace.tsx', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../../../preload/proxyBuilderBridge.ts', import.meta.url), 'utf8')
const textPreload = readFileSync(new URL('../../../preload/proxyBuilderTextBridge.ts', import.meta.url), 'utf8')
const ipc = readFileSync(new URL('../../../main/proxyBuilderIpc.ts', import.meta.url), 'utf8')
const checker = readFileSync(new URL('../../../main/proxyBuilder/checkerService.ts', import.meta.url), 'utf8')
const packagedSmoke = readFileSync(new URL('../../../../scripts/proxy-builder-packaged-ui-smoke.mjs', import.meta.url), 'utf8')

describe('Proxy Builder Batch 4 checker/export', () => {
  it('keeps Proxy Builder visible as a top-level route', () => {
    expect(app).toContain("id: 'proxy-builder', label: 'Proxy Builder'")
    expect(app).toContain("activeRoute === 'proxy-builder' ? <ProxyBuilderWorkspace />")
  })

  it('selects SSH key files through typed IPC without exposing file contents from Main', () => {
    expect(workspace).toContain('window.pageAutoProxyBuilder.pickPrivateKey')
    expect(workspace).toContain('Chọn file key')
    expect(workspace).toContain('Key Passphrase (nếu có)')
    expect(preload).toContain('pickPrivateKey: () => ipcRenderer.invoke')
    expect(ipc).toContain("dialog.showOpenDialog")
    expect(ipc).toContain("return { cancelled: false, path, fileName: basename(path) }")
  })

  it('exposes copyable SSH verbose diagnostics instead of collapsing native failures to one message', () => {
    expect(workspace).toContain('Chi tiết SSH')
    expect(workspace).toContain('Copy log SSH')
    expect(workspace).toContain('Key fingerprint:')
    expect(workspace).toContain('Offering:')
    expect(workspace).toContain('Server accepts:')
    expect(workspace).toContain('Exit code:')
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

  it('can generate random proxy credentials locally', () => {
    expect(workspace).toContain('Random User/Pass')
    expect(workspace).toContain('window.crypto.getRandomValues')
    expect(workspace).toContain("setProxyUser('pa_' + randomAuthToken(8))")
    expect(workspace).toContain('setProxyPassword(randomAuthToken(20))')
  })

  it('shows external reachability instead of hard-coding every created proxy as ready', () => {
    expect(workspace).toContain("'Không truy cập được'")
    expect(workspace).toContain("item.status === 'ready' ? 'LIVE'")
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

  it('keeps OCI API credentials in Main and requires a local config for Oracle VPS', () => {
    expect(workspace).toContain('Chọn OCI config')
    expect(workspace).toContain('window.pageAutoProxyBuilder.pickOciConfig')
    expect(workspace).toContain("cloudFirewall: { provider: 'oci' as const")
    expect(workspace).toContain('Oracle VPS: chọn OCI config')
    expect(preload).toContain('pickOciConfig: () => ipcRenderer.invoke')
    expect(ipc).toContain("title: 'Chọn OCI config'")
  })

})
