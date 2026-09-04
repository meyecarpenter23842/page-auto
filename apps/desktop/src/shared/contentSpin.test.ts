import { describe, expect, it } from 'vitest'
import {
  CONTENT_SPIN_ICON_OPTIONS,
  addSpinTokenToAiLines,
  spinContent
} from './contentSpin'

describe('contentSpin', () => {
  it('spins the context, date, time, letter and number tokens without mutating missing context', () => {
    const source = '[u] [f] [g] [n] [d] [t] [w] [unknown]'
    const result = spinContent(source, {
      targetName: 'Hội Mua Bán Mỹ Tho',
      recipientName: 'Nguyễn Văn An',
      now: new Date(2026, 8, 4, 12, 3, 58),
      random: () => 0
    })

    expect(result).toBe('Hội Mua Bán Mỹ Tho Văn An anh 000000 04/09/2026 12:03:58 a [unknown]')
    expect(source).toBe('[u] [f] [g] [n] [d] [t] [w] [unknown]')
  })

  it('keeps context tokens when the real name is unavailable', () => {
    expect(spinContent('[u] / [f]', { random: () => 0 })).toBe('[u] / [f]')
  })

  it('never substitutes recipient data for an unresolved target [u]', () => {
    expect(spinContent('[u] / [f]', { recipientName: 'Nguyễn Văn An', random: () => 0 })).toBe('[u] / Văn An')
  })

  it('resolves every icon token from its own configured pool', () => {
    for (const option of CONTENT_SPIN_ICON_OPTIONS) {
      const first = spinContent(option.token, { random: () => 0 })
      const last = spinContent(option.token, { random: () => 0.999999 })
      expect(option.pool).toContain(first)
      expect(option.pool).toContain(last)
    }
  })

  it('randoms one whole branch when a pipe is outside braces', () => {
    expect(spinContent('Bài A|Bài B|Bài C', { random: () => 0.5 })).toBe('Bài B')
  })

  it('keeps text outside braces and spins each brace group independently', () => {
    const values = [0.5, 0.99]
    let index = 0
    const result = spinContent(
      '🔥 {Giá tốt|Hàng mới|Ưu đãi hôm nay} - nội dung cố định - {Inbox ngay|Liên hệ ngay|Xem thêm}',
      { random: () => values[index++] ?? 0 }
    )

    expect(result).toBe('🔥 Hàng mới - nội dung cố định - Xem thêm')
  })

  it('chooses the outer branch before spinning pipes inside braces', () => {
    const values = [0.4, 0.99, 0]
    let index = 0
    const result = spinContent(
      'Bài 1|🔥 {Giá tốt|Hàng mới} - {Inbox|Liên hệ}|Bài 3',
      { random: () => values[index++] ?? 0 }
    )

    expect(result).toBe('🔥 Hàng mới - Inbox')
  })

  it('leaves malformed or nested brace structure untouched instead of guessing', () => {
    expect(spinContent('Giữ {A|{B|C}} nguyên', { random: () => 0 })).toBe('Giữ {A|{B|C}} nguyên')
    expect(spinContent('Giữ {A|B nguyên', { random: () => 0 })).toBe('Giữ {A|B nguyên')
  })

  it('adds the selected literal icon token to AI lines without touching separators or hashtags', () => {
    const output = 'Mở bài\n\n- Ý chính\n#Hashtag\n|\nBài tiếp'
    expect(addSpinTokenToAiLines(output, '[r3]')).toBe(
      '[r3] Mở bài\n\n[r3] - Ý chính\n#Hashtag\n|\n[r3] Bài tiếp'
    )
  })

  it('does not duplicate a literal icon token already placed by the Agent', () => {
    expect(addSpinTokenToAiLines('[r7] Nội dung', '[r2]')).toBe('[r7] Nội dung')
  })
})
