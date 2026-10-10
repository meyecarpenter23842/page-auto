import { describe, expect, it } from 'vitest'
import { formatContentVariantText, parseContentVariantText } from './contentLibrary'

describe('contentLibrary variant text', () => {
  it('uses only a top-level standalone pipe line as the legacy Post Library separator', () => {
    expect(parseContentVariantText('Bài A\n|\nBài B')).toEqual(['Bài A', 'Bài B'])
    expect(parseContentVariantText('A|B|C')).toEqual(['A|B|C'])
    expect(parseContentVariantText('{A|B|C}')).toEqual(['{A|B|C}'])
  })

  it('keeps multiline standalone pipes inside Runtime Spin braces as one canonical post', () => {
    const source = [
      '{',
      '[f]Bài số 1',
      '|',
      '[f]Bài số 2',
      '|',
      '[f]Bài số 3',
      '}',
      '{#tag-a|#tag-b|#tag-c}'
    ].join('\n')

    expect(parseContentVariantText(source)).toEqual([source])
    expect(parseContentVariantText(`${source}\n|\nBài thư viện thứ hai`)).toEqual([
      source,
      'Bài thư viện thứ hai'
    ])
  })

  it('keeps the legacy escaped pipe syntax compatible without turning it into a separator', () => {
    expect(parseContentVariantText('A\\|B')).toEqual(['A|B'])
    expect(parseContentVariantText('Dòng 1\n\\|\nDòng 2')).toEqual(['Dòng 1\n|\nDòng 2'])
  })

  it('formats runtime Spin pipes literally while keeping library variants visually separated', () => {
    expect(formatContentVariantText(['A|B|C', '{A|B|C}'])).toBe('A|B|C\n|\n{A|B|C}')
  })

  it('round-trips canonical text including multiline brace Spin and a literal top-level pipe line', () => {
    const variants = [
      '{Mở đầu\n|\nKết thúc} A|B|C',
      'Dòng 1\n|\nDòng 2',
      'Dùng \\ ký tự'
    ]
    const formatted = formatContentVariantText(variants)

    expect(formatted).toContain('{Mở đầu\n|\nKết thúc}')
    expect(formatted).toContain('Dòng 1\n\\|\nDòng 2')
    expect(parseContentVariantText(formatted)).toEqual(variants)
  })
})
