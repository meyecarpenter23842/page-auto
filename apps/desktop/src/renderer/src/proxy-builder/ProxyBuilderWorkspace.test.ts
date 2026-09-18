import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./ProxyBuilderWorkspace.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./proxyBuilder.css', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../mainWorkspaceLayout.css', import.meta.url), 'utf8')

describe('Proxy Builder Batch 1 foundation', () => {
  it('registers Proxy Builder as a top-level route', () => {
    expect(app).toContain("id: 'proxy-builder', label: 'Proxy Builder'")
    expect(app).toContain("import { ProxyBuilderWorkspace } from './proxy-builder/ProxyBuilderWorkspace'")
    expect(app).toContain("activeRoute === 'proxy-builder' ? <ProxyBuilderWorkspace />")
  })

  it('renders the two agreed sub-tabs and compact create form', () => {
    for (const label of [
      'Tạo Proxy',
      'Proxy Checker',
      'VPS IP / Host',
      'SSH User',
      'SSH Password',
      'SSH Private Key',
      'IPv4',
      'IPv6',
      'IPv4 + IPv6',
      'Số lượng',
      'Start Port',
      'Authentication',
      'Proxy User',
      'Proxy Password'
    ]) {
      expect(workspace).toContain(label)
    }
  })

  it('keeps real SSH, provision and checker actions disabled in Batch 1', () => {
    expect(workspace).toMatch(/disabled[^>]*>Kiểm tra SSH<\/button>/)
    expect(workspace).toMatch(/disabled[^>]*>Tạo Proxy<\/button>/)
    expect(workspace).toMatch(/disabled[^>]*>Test<\/button>/)
    expect(workspace).not.toContain('window.pageAuto')
  })

  it('provides result grids, progress UI and workspace-local scrolling', () => {
    expect(workspace).toContain('Tiến trình')
    expect(workspace).toContain('Danh sách Proxy')
    expect(workspace).toContain('Outbound IP')
    expect(workspace).toContain('Latency')
    expect(css).toContain('.proxy-builder-results-panel')
    expect(css).toContain("html[data-theme='dark']")
    expect(layout).toContain('.workspace > .proxy-builder-shell')
  })
})
