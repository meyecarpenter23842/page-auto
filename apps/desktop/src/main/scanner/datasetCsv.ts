import type { ScanDatasetDetails } from '../../shared/scanner'

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export function scannerDatasetCsv(dataset: ScanDatasetDetails): string {
  const dataKeys = [...new Set(dataset.items.flatMap((item) => Object.keys(item.data)))].sort()
  const columns = ['entityId', 'displayName', 'url', ...dataKeys]
  const rows = [columns.map(csvCell).join(',')]
  for (const item of dataset.items) {
    rows.push([
      item.entityId,
      item.displayName,
      item.url,
      ...dataKeys.map((key) => item.data[key] ?? null)
    ].map(csvCell).join(','))
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`
}
