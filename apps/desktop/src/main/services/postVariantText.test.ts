import { describe, expect, it } from 'vitest'
import { formatPostVariantText, parsePostVariantText } from '../../shared/pageTabs'

describe('post variant text', () => {
  it('splits variants on pipe and trims empty entries', () => {
    expect(parsePostVariantText(' Bài A \n|\n Bài B || Bài C ')).toEqual(['Bài A', 'Bài B', 'Bài C'])
  })

  it('supports a literal pipe with backslash escaping', () => {
    expect(parsePostVariantText('Giá A \\| Giá B | Nội dung 2')).toEqual(['Giá A | Giá B', 'Nội dung 2'])
  })

  it('formats and parses variants without losing literal pipes or backslashes', () => {
    const source = ['A | B', 'Đường dẫn C:\\Post\\Anh', 'Nội dung 3']
    expect(parsePostVariantText(formatPostVariantText(source))).toEqual(source)
  })
})
