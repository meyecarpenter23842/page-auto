import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const wrapper = readFileSync(new URL('./PageBusinessWorkspace.tsx', import.meta.url), 'utf8')
const manager = readFileSync(new URL('./PageManagerModal.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./pageManager.css', import.meta.url), 'utf8')

describe('Page shared management UI regression', () => {
  it('places one Page Manager over the existing Page business workspace and remounts business panes after shared changes', () => {
    expect(wrapper).toContain('PageBusinessWorkspaceCore key={sharedRevision}')
    expect(wrapper).toContain('Quản lý Page')
    expect(wrapper).toContain('onChanged={sharedChanged}')
  })

  it('uses canonical PageTab and Account Manager APIs instead of a duplicate renderer store', () => {
    expect(manager).toContain('window.pageAuto.listPageTabs()')
    expect(manager).toContain('window.pageAuto.getPageTab')
    expect(manager).toContain('window.pageAuto.updatePageTab')
    expect(manager).toContain('window.pageAuto.listAccounts()')
    expect(manager).toContain('buildSharedPageSaveInput')
  })

  it('supports both app themes using the established dark tokens', () => {
    expect(css).toContain("html[data-theme='dark'] .page-manager-backdrop")
    expect(css).toContain('var(--pa-dark-surface)')
    expect(css).toContain('var(--pa-dark-green)')
  })
})
