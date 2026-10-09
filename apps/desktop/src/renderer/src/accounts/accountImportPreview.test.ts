import { describe, expect, it } from 'vitest'
import { formatImportPreviewCell } from './accountImportPreview'

describe('Account Import preview — private fields and missing columns', () => {
  it('hides credentials in the preview without changing the raw import payload', () => {
    for (const field of ['password', 'cookie', 'twoFactorSecret', 'emailPassword', 'proxyPassword', 'proxy'] as const) {
      expect(formatImportPreviewCell(field, 'PRIVATE-VALUE', true)).toBe('•••••• (đã ẩn)')
    }
  })
  it('distinguishes ignored, absent and deliberately empty fields', () => {
    expect(formatImportPreviewCell('ignore', 'PRIVATE-VALUE', true)).toBe('[Bỏ qua]')
    expect(formatImportPreviewCell('note', '', false)).toBe('[Không có cột]')
    expect(formatImportPreviewCell('note', '', true)).toBe('[Trống]')
    expect(formatImportPreviewCell('note', 'hello', true)).toBe('hello')
    expect(formatImportPreviewCell('password', '', true)).toBe('[Trống]')
  })
})
