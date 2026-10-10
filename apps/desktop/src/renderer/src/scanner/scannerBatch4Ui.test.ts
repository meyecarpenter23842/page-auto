import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const inventory = readFileSync(new URL('../proxy-builder/ProxyInventoryPanel.tsx', import.meta.url), 'utf8')
const scanner = readFileSync(new URL('./ScannerWorkspace.tsx', import.meta.url), 'utf8')
const packagedSmoke = readFileSync(new URL('../../../../scripts/proxy-builder-packaged-ui-smoke.mjs', import.meta.url), 'utf8')

describe('Batch 4 — Proxy Center and Scanner bulk UI scope', () => {
  it('keeps independent connection/usage filters and opens the import form on demand', () => {
    expect(inventory).toContain('aria-label="Lọc trạng thái kết nối Proxy"')
    expect(inventory).toContain('aria-label="Lọc trạng thái sử dụng Proxy"')
    expect(inventory).toContain('aria-expanded={importOpen}')
    expect(inventory).toContain('useUnsavedWorkspaceChanges')
    expect(inventory).toContain('window.pageAutoProxyBuilder.upsertInventory')
    expect(packagedSmoke).toContain("name: '+ Nhập Proxy vào kho'")
  })
  it('bulk actions consume the same checked proxy IDs as the selection toolbar', () => {
    expect(inventory).toContain("copyInventory([...selected], 'đang chọn')")
    expect(inventory).toContain("markUsage([...selected], true, 'đang chọn')")
    expect(inventory).toContain("markUsage([...selected], false, 'đang chọn')")
    expect(inventory).toContain('testInventory([...selected])')
    expect(inventory).toContain('assignProxyFolder({ ids: [...selected], folderId })')
    expect(inventory).toContain('deleteInventory({ ids: [...selected] })')
    expect(inventory).toContain('AccountSelectionMenu')
  })
  it('Scanner display filtering does not change saved IDs or the latest Dataset export', () => {
    expect(scanner).toContain('onlyMatchingGroups')
    expect(scanner).toContain('displayedResults.map')
    expect(scanner).toContain('resultIds: groupSelection')
    expect(scanner).toContain('selectedResultIds')
    expect(scanner).toContain('datasetId: lastDatasetId')
    expect(scanner).toContain('Chỉ hiện Group đạt lọc')
  })
})
