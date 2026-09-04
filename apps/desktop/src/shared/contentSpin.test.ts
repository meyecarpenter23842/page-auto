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

  it('resolves every icon token from its own configured pool', () => {
    for (const option of CONTENT_SPIN_ICON_OPTIONS) {
      const first = spinContent(option.token, { random: () => 0 })
      const last = spinContent(option.token, { random: () => 0.999999 })
      expect(option.pool).toContain(first)
      expect(option.pool).toContain(last)
    }
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
