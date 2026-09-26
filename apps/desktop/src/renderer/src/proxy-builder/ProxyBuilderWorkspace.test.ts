import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./ProxyBuilderWorkspace.tsx', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../../../preload/proxyBuilderBridge.ts', import.meta.url), 'utf8')
const textPreload = readFileSync(new URL('../../../preload/proxyBuilderTextBridge.ts', import.meta.url), 'utf8')
const ipc = readFileSync(new URL('../../../main/proxyBuilderIpc.ts', import.meta.url), 'utf8')
const checker = readFileSync(new URL('../../../main/proxyBuilder/checkerService.ts', import.meta.url), 'utf8')
const packagedSmoke = readFileSync(new URL('../../../../scripts/proxy-builder-packaged-ui-smoke.mjs', import.meta.url), 'utf8')
const inventoryPanel = readFileSync(new URL('./ProxyInventoryPanel.tsx', import.meta.url), 'utf8')
const bindingPanel = readFileSync(new URL('./ProxyAccountBindingPanel.tsx', import.meta.url), 'utf8')

describe('Proxy Center inventory/binding + checker/export', () => {
  it('keeps Proxy Center visible as a top-level route', () => {
    expect(app).toContain("id: 'proxy-builder', label: 'Proxy Center'")
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

  it('adds a packaged UI smoke that opens Proxy Center and exercises a deterministic DEAD proxy', () => {
    expect(packagedSmoke).toContain("name: 'Proxy Center'")
    expect(packagedSmoke).toContain("name: 'Proxy Checker'")
    expect(packagedSmoke).toContain("server.listen(0, '127.0.0.1'")
    expect(packagedSmoke).toContain("hasText: 'DEAD'")
    expect(packagedSmoke).toContain('407 Proxy Authentication Required')
  })

  it('adds persistent inventory and canonical Account proxy binding surfaces', () => {
    expect(workspace).toContain('Kho Proxy')
    expect(workspace).toContain('Gán Account')
    expect(workspace).toContain('Lưu vào Kho')
    expect(inventoryPanel).toContain('window.pageAutoProxyBuilder.upsertInventory')
    expect(inventoryPanel).toContain('window.pageAutoProxyBuilder.checkInventory')
    expect(bindingPanel).toContain('window.pageAutoProxyBuilder.assignInventoryProxy')
    expect(bindingPanel).toContain('window.pageAutoProxyBuilder.clearAccountProxy')
    expect(bindingPanel).toContain('proxy fields của Account Manager')
  })

  it('requires the manual Oracle CIDR when OCI IMDS omits ipv6AddressCidrs', () => {
    expect(workspace).toContain('IPv6 CIDR đã cấp trên Oracle')
    expect(workspace).toContain('requiresManualOciIpv6Cidr')
    expect(workspace).toContain('...(manualIpv6Cidr ? { ipv6Cidr: manualIpv6Cidr } : {})')
    expect(workspace).toContain('Cần nhập CIDR IPv6 đã cấp trên Oracle trước khi tạo proxy.')
    expect(workspace).toContain('Page-Auto sẽ không gọi CreateIpv6.')
  })

  it('keeps OCI ingress support without exposing OCI profile/config UI', () => {
    expect(workspace).not.toContain('OCI Profile')
    expect(workspace).not.toContain('cloudFirewallReady')
    expect(workspace).toContain("cloudFirewallAction?.provider === 'oci'")
    expect(workspace).not.toContain('Cấu hình OCI')
    expect(workspace).not.toContain('pickOciConfigFile')
    expect(workspace).toContain('capability.ociIpv6Cidrs ?? []')
    expect(workspace).toContain('OCI CIDR sẵn')
    expect(workspace).toContain('disabled={!capability || !selectedModeReady || provisionRunning || sshChecking}')
    expect(workspace).toContain('startProvisionRequest()')
    expect(preload).toContain('pickOciConfig: () => ipcRenderer.invoke')
    expect(ipc).toContain("title: 'Chọn OCI config'")
  })

  it('adds proxy folders, usage badges and quick selection without changing proxy runtime', () => {
    for (const label of ['Thư mục Proxy', 'Chọn chưa dùng', 'Chọn đã dùng', 'Chuyển thư mục', 'ĐÃ DÙNG', 'CHƯA DÙNG']) {
      expect(inventoryPanel).toContain(label)
    }
    expect(inventoryPanel).toContain('listProxyFolders')
    expect(inventoryPanel).toContain('assignProxyFolder')
    expect(preload).toContain('createProxyFolder')
    expect(preload).toContain('renameProxyFolder')
    expect(preload).toContain('deleteProxyFolder')
    expect(ipc).toContain('inventory.assignFolder')
  })

  it('keeps folder editing Electron-safe and mirrors Account Manager range selection', () => {
    expect(inventoryPanel).not.toContain('window.prompt(')
    expect(inventoryPanel).toContain('Tên thư mục proxy')
    expect(inventoryPanel).toContain('useExcelRowRange(filtered.map')
    expect(inventoryPanel).toContain('AccountSelectionMenu')
    expect(inventoryPanel).toContain("ranged ? 'range-row' : ''")
    expect(inventoryPanel).toContain('const checked = event.target.checked')
    expect(inventoryPanel).not.toContain('event.currentTarget.checked')
    expect(packagedSmoke).toContain("name: 'Kho Proxy'")
    expect(packagedSmoke).toContain("getByLabel('Tên thư mục proxy')")
    expect(packagedSmoke).toContain("getByLabel('Chọn tất cả proxy đang lọc')")
    expect(packagedSmoke).toContain("tbody tr.range-row")
  })

  it('copies full proxy credentials from either the paint range or checked rows without exposing secrets to React', () => {
    expect(inventoryPanel).toContain('Copy Proxy phần phủ khối')
    expect(inventoryPanel).toContain('Copy Proxy đã tích')
    expect(inventoryPanel).toContain('window.pageAutoProxyBuilder.copyInventoryProxies')
    expect(preload).toContain('copyInventoryProxies: (input) => ipcRenderer.invoke')
    expect(ipc).toContain('clipboard.writeText')
    expect(ipc).toContain("secrets.map((item) => item.rawProxy).join('\\n')")
    expect(ipc).toContain('return { count: secrets.length }')
    expect(packagedSmoke).toContain('clipboard.readText()')
    expect(packagedSmoke).toContain('Copy Proxy phần phủ khối (2)')
    expect(packagedSmoke).toContain('Copy Proxy đã tích (2)')
  })

})
