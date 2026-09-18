import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./ProxyBuilderWorkspace.tsx', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../../../preload/proxyBuilderBridge.ts', import.meta.url), 'utf8')
const ipc = readFileSync(new URL('../../../main/proxyBuilderIpc.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('./proxyBuilder.css', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../mainWorkspaceLayout.css', import.meta.url), 'utf8')

describe('Proxy Builder Batch 2 SSH discovery', () => {
  it('keeps Proxy Builder as a top-level route', () => {
    expect(app).toContain("id: 'proxy-builder', label: 'Proxy Builder'")
    expect(app).toContain("activeRoute === 'proxy-builder' ? <ProxyBuilderWorkspace />")
  })

  it('wires SSH audit through typed preload/Main IPC instead of running SSH in React', () => {
    expect(workspace).toContain('window.pageAutoProxyBuilder.auditVps')
    expect(workspace).not.toContain("from 'ssh2'")
    expect(preload).toContain("contextBridge.exposeInMainWorld('pageAutoProxyBuilder', api)")
    expect(ipc).toContain('auditProxyBuilderVps(input)')
  })

  it('enables only SSH check while later batch actions remain disabled', () => {
    expect(workspace).toContain('onClick={() => void checkSsh()}>Kiểm tra SSH</button>')
    expect(workspace).toMatch(/disabled[^>]*>Tạo Proxy<\/button>/)
    expect(workspace).toMatch(/disabled[^>]*>Test<\/button>/)
  })

  it('renders discovered capability in the existing progress surface', () => {
    for (const label of ['Public IPv4', 'Start Port', 'Outbound OK', 'Chưa đạt probe']) {
      expect(workspace).toContain(label)
    }
    expect(css).toContain('.proxy-builder-capability-summary')
    expect(layout).toContain('.workspace > .proxy-builder-shell')
  })
})
