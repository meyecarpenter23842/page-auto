import type { AccountImportField } from '../../../shared/accounts'

const PRIVATE_FIELDS = new Set<AccountImportField>(['password', 'cookie', 'twoFactorSecret', 'emailPassword', 'proxyPassword', 'proxy'])

/** Sanitizes preview only. Imported rawText and field mapping must remain unchanged. */
export function formatImportPreviewCell(field: AccountImportField | 'ignore', value: string, exists: boolean): string {
  if (!exists) return '[Không có cột]'
  if (field === 'ignore') return '[Bỏ qua]'
  if (value === '') return '[Trống]'
  if (PRIVATE_FIELDS.has(field)) return '•••••• (đã ẩn)'
  return value
}
