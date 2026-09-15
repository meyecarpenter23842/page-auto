import { describe, expect, it } from 'vitest'
import type { ScanDatasetDetails } from '../../shared/scanner'
import { scannerDatasetCsv } from './datasetCsv'

describe('Scanner Dataset CSV', () => {
  it('exports canonical Group Dataset columns with UTF-8 BOM and CSV escaping', () => {
    const dataset: ScanDatasetDetails = {
      id: 1,
      type: 'group',
      name: 'Nhóm',
      recordCount: 1,
      sourceJobId: 9,
      createdAt: 1,
      updatedAt: 1,
      items: [{
        id: 1,
        datasetId: 1,
        entityId: '123',
        displayName: 'Nhóm "Mỹ phẩm"',
        url: 'https://www.facebook.com/groups/123/',
        data: { members: 1200, privacy: 'Public', location: null },
        sourceJobId: 9,
        createdAt: 1
      }]
    }
    const csv = scannerDatasetCsv(dataset)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"entityId","displayName","url","location","members","privacy"')
    expect(csv).toContain('"Nhóm ""Mỹ phẩm"""')
    expect(csv).toContain('"1200"')
  })
})
