import { describe, expect, it } from 'vitest'
import { ScannerAdapterRegistry } from './scannerAdapterRegistry'

const scanTypes = ['group', 'page', 'user', 'group_members'] as const

describe('ScannerAdapterRegistry', () => {
  it('keeps each scanner business type behind its own adapter module', () => {
    const registry = new ScannerAdapterRegistry()
    const adapters = scanTypes.map((scanType) => registry.get(scanType))

    expect(adapters.map((adapter) => adapter.scanType)).toEqual(scanTypes)
    expect(new Set(adapters.map((adapter) => adapter.constructor.name)).size).toBe(scanTypes.length)
  })
})
