import { describe, expect, it } from 'vitest'
import { formatContentVariantText, parseContentVariantText } from './contentLibrary'

describe('contentLibrary variant text', () => {
  it('uses only a standalone pipe line as the Post Library variant separator', () => {
    expect(parseContentVariantText('Bài A\n|\nBài B')).toEqual(['Bài A', 'Bài B'])
    expect(parseContentVariantText('A|B|C')).toEqual(['A|B|C'])
    expect(parseContentVariantText('{A|B|C}')).toEqual(['{A|B|C}'])
  })

  it('keeps the legacy escaped pipe syntax compatible without turning it into a separator', () => {
    expect(parseContentVariantText('A\\|B')).toEqual(['A|B'])
    expect(parseContentVariantText('Dòng 1\n\\|\nDòng 2')).toEqual(['Dòng 1\n|\nDòng 2'])
  })

  it('formats runtime Spin pipes literally while keeping library variants visually separated', () => {
    expect(formatContentVariantText(['A|B|C', '{A|B|C}'])).toBe('A|B|C\n|\n{A|B|C}')
  })

  it('round-trips canonical text including runtime Spin and a literal standalone pipe line', () => {
    const variants = ['Mở đầu {A|B}\n|\nKết thúc A|B|C', 'Dùng \\ ký tự']
    const formatted = formatContentVariantText(variants)

    expect(formatted).toContain('\\|')
    expect(parseContentVariantText(formatted)).toEqual(variants)
  })
})
