import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workspace = readFileSync(new URL('./ProxyBuilderWorkspace.tsx', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../../../preload/proxyBuilderBridge.ts', import.meta.url), 'utf8')
const ipc = readFileSync(new URL('../../../main/proxyBuilderIpc.ts', import.meta.url), 'utf8')
const service = readFileSync(new URL('../../../main/proxyBuilder/provisionService.ts', import.meta.url), 'utf8')
const assets = readFileSync(new URL('../../../main/proxyBuilder/remoteAssets.ts', import.meta.url), 'utf8')

describe('Proxy Builder Batch 3 provision engine', () => {
  it('keeps SSH and provisioning outside React behind typed IPC', () => {
    expect(workspace).toContain('window.pageAutoProxyBuilder.startProvision')
    expect(workspace).toContain('window.pageAutoProxyBuilder.getProvisionStatus')
    expect(workspace).not.toContain("from 'ssh2'")
    expect(preload).toContain('startProvision: (input) => ipcRenderer.invoke')
    expect(ipc).toContain('new ProxyBuilderProvisionService()')
  })

  it('enables Create/Stop and runtime service controls while checker stays Batch 4', () => {
    expect(workspace).toContain('onClick={() => void createProxy()}>Tạo Proxy</button>')
    expect(workspace).toContain('onClick={() => void cancelProvision()}>Dừng</button>')
    expect(workspace).toContain("controlRuntime('start')")
    expect(workspace).toContain("controlRuntime('stop')")
    expect(workspace).toContain("controlRuntime('restart')")
    expect(workspace).toMatch(/disabled[^>]*title="Proxy Checker network runtime được triển khai ở Batch 4\."[^>]*>Test<\/button>/)
  })

  it('provisions only source-probed IPs and persists the managed IPv6 pool', () => {
    expect(assets).toContain('source_probe(address, family)')
    expect(assets).toContain("ip', '-6', 'addr', 'add'")
    expect(assets).toContain("'managed_ipv6': ipv6_cidrs")
    expect(assets).toContain('ExecStartPre=/usr/bin/python3 /usr/local/lib/page-auto-proxy/restore.py')
    expect(assets).toContain('Restart=always')
    expect(assets).not.toContain('ens3')
  })

  it('self-tests every listener and rolls back only resources managed by Page-Auto', () => {
    expect(assets).toContain('self_test(mapping, auth)')
    expect(assets).toContain("progress('rollback'")
    expect(assets).toContain('for cidr in list(newly_added)')
    expect(service).toContain('PA_RESULT_JSON=')
    expect(service).toContain("status: 'completed'")
  })
})
