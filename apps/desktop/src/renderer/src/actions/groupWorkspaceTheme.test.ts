import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const groupWorkspaceCss = readFileSync(
  fileURLToPath(new URL('./groupWorkspace.css', import.meta.url)),
  'utf8'
)

describe('group workspace theme/layout contract', () => {
  it('uses the Page-Auto light palette instead of a separate workspace palette', () => {
    expect(groupWorkspaceCss).toContain('--gw-canvas: #f4f7fb;')
    expect(groupWorkspaceCss).toContain('--gw-panel: #ffffff;')
    expect(groupWorkspaceCss).toContain('--gw-accent: #2563eb;')
  })

  it('maps dark mode to the shared Page-Auto dark theme tokens', () => {
    expect(groupWorkspaceCss).toContain("html[data-theme='dark'] .group-workspace")
    expect(groupWorkspaceCss).toContain('--gw-panel: var(--pa-dark-surface);')
    expect(groupWorkspaceCss).toContain('--gw-panel-soft: var(--pa-dark-surface-2);')
    expect(groupWorkspaceCss).toContain('--gw-border: var(--pa-dark-border);')
    expect(groupWorkspaceCss).toContain('--gw-text: var(--pa-dark-text);')
    expect(groupWorkspaceCss).toContain('--gw-accent: var(--pa-dark-green);')
  })

  it('keeps dense desktop controls from wrapping out of their panels', () => {
    expect(groupWorkspaceCss).toContain('.group-account-toolbar > div')
    expect(groupWorkspaceCss).toContain('white-space: nowrap;')
    expect(groupWorkspaceCss).toContain('text-overflow: ellipsis;')
    expect(groupWorkspaceCss).toContain('grid-template-columns:')
  })
})
