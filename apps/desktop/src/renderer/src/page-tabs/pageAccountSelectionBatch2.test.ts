import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tabs = readFileSync(new URL('./PageTabsManagerV2.tsx', import.meta.url), 'utf8')
const join = readFileSync(new URL('./PageJoinGroupWorkspace.tsx', import.meta.url), 'utf8')
const wall = readFileSync(new URL('./PageWallWorkspace.tsx', import.meta.url), 'utf8')
const scenario = readFileSync(new URL('./PageScenarioWorkspace.tsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./PageBusinessWorkspace.tsx', import.meta.url), 'utf8')

describe('Page account Excel selection batch 2', () => {
  it('removes the Page-scoped DOM selection controller', () => {
    expect(existsSync(new URL('./PageAccountSelectionController.tsx', import.meta.url))).toBe(false)
    expect(workspace).not.toContain('PageAccountSelectionController')
  })

  it('reuses shared range and context-menu primitives in each Page surface', () => {
    for (const source of [tabs, join, wall, scenario]) {
      expect(source).toContain('useExcelRowRange')
      expect(source).toContain('AccountSelectionMenu')
      expect(source).not.toContain('MutationObserver')
      expect(source).not.toContain('recordRowPaintSelection')
    }
  })

  it('removes hidden Page Tab selection while preserving Join bulk selection beside Bật', () => {
    expect(tabs).not.toContain('selectedAccountIds')
    expect(tabs).not.toContain('pt-account-select')
    expect(tabs).toContain('setPageAccountsEnabled')
    expect(join).toContain('selectedAccountIds')
    expect(join).toContain('togglePageAccount')
    expect(join).toContain('pageAccountRange')
  })

  it('keeps row highlight separate from checked state for Wall and Scenario', () => {
    expect(wall).toContain("range-row")
    expect(wall).not.toContain('onClick={() => { if (runnable && !busy) toggleAccount')
    expect(scenario).toContain("range-row")
    expect(scenario).not.toContain('onClick={() => { if (runnable && !busy) toggleAccount')
  })
})
