import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./PageBusinessBindingScope.tsx', import.meta.url), 'utf8')

describe('Page business load isolation', () => {
  it('commits canonical Page inventory before loading Action Workspace bindings', () => {
    const pageLoad = source.indexOf('const nextPages = await window.pageAuto.listPageTabs()')
    const pageCommit = source.indexOf('setPages(nextPages)')
    const workspaceLoad = source.indexOf('const workspaces = await window.pageAuto.listActionWorkspaces()')

    expect(pageLoad).toBeGreaterThanOrEqual(0)
    expect(pageCommit).toBeGreaterThan(pageLoad)
    expect(workspaceLoad).toBeGreaterThan(pageCommit)
    expect(source).not.toContain('Promise.all([window.pageAuto.listPageTabs(), window.pageAuto.listActionWorkspaces()])')
  })
})
