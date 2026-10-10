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

  it('spins one basic brace group', () => {
    expect(spinContent('{A|B|C}', { random: () => 0.99 })).toBe('C')
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

  it('spins nested groups recursively and chooses each parent before its selected child', () => {
    const values = [0.5, 0.99]
    let index = 0
    expect(spinContent('{A|B{X|Y}|C}', { random: () => values[index++] ?? 0 })).toBe('BY')
    expect(index).toBe(2)
  })

  it('supports deeper recursive groups without consuming random values from unchosen siblings', () => {
    const values = [0.5, 0.99, 0]
    let index = 0
    const result = spinContent('{A|B{X|Y{1|2}}|C}', { random: () => values[index++] ?? 0 })

    expect(result).toBe('BY1')
    expect(index).toBe(3)
  })

  it('spins a multiline outer article, then its nested group, then an independent hashtag sibling', () => {
    const source = [
      '{',
      '[r2] [g] [f] đang xem ưu đãi {A|B|C}',
      'Mã: [n] - Ngày [d] - Giờ [t]',
      '|',
      '[r5] [u] có hàng mới {X|Y|Z}',
      'Mã chữ: [w][w][w] - Inbox ngay',
      '|',
      '[r8] Giá tốt hôm nay {10%|20%|30%}',
      'Liên hệ {Hotline|Zalo|Inbox} ngay',
      '}',
      '{#MyTho|#HungPhat|#NguonHang}'
    ].join('\n')
    const values = [0.5, 0.5, 0.5, 0, 0, 0, 0]
    let index = 0

    const result = spinContent(source, {
      random: () => values[index++] ?? 0,
      now: new Date(2026, 8, 4, 12, 3, 58)
    })

    expect(result).toContain('[u] có hàng mới Y')
    expect(result).toContain('Mã chữ: aaa - Inbox ngay')
    expect(result).toContain('#HungPhat')
    expect(result).not.toContain('Giá tốt hôm nay')
    expect(source).toContain('{X|Y|Z}')
  })

  it('spins a multiline full-post brace and hashtag brace like the real editor case', () => {
    const source = [
      '{',
      '[f]Bài số 1',
      '',
      'Nội dung một',
      '|',
      '[f]Bài số 2',
      '',
      'Nội dung hai',
      '|',
      '[f]Bài số 3',
      '',
      'Nội dung ba',
      '}',
      '{#tag-a|#tag-b|#tag-c}'
    ].join('\n')
    const values = [0.5, 0.99]
    let index = 0

    const result = spinContent(source, { random: () => values[index++] ?? 0 })

    expect(result).toBe('[f]Bài số 2\n\nNội dung hai\n#tag-c')
    expect(source).toContain('[f]Bài số 1')
    expect(source).toContain('#tag-a')
  })

  it('chooses the top-level branch before recursively spinning groups inside that branch', () => {
    const values = [0.4, 0.99, 0.99, 0]
    let index = 0
    const result = spinContent(
      'Bài 1|🔥 {Giá tốt|Hàng {mới|hot}} - {Inbox|Liên hệ}|Bài 3',
      { random: () => values[index++] ?? 0 }
    )

    expect(result).toBe('🔥 Hàng hot - Inbox')
    expect(index).toBe(4)
  })

  it('leaves malformed brace structure untouched instead of partially spinning it', () => {
    const source = 'Giữ {A|B{X|Y} nguyên'
    expect(spinContent(source, { random: () => 0.99 })).toBe(source)
    expect(spinContent('{A|B{X|Y}', { random: () => 0.99 })).toBe('{A|B{X|Y}')
  })

  it('keeps unknown and unavailable context tokens literal after recursive structural spin', () => {
    expect(spinContent('{[u] [unknown]|[f]}', { random: () => 0 })).toBe('[u] [unknown]')
  })

  it('does not mutate canonical source and each invocation performs a fresh single structural spin', () => {
    const source = '{A{1|2}|B{3|4}}'
    expect(spinContent(source, { random: () => 0 })).toBe('A1')
    expect(spinContent(source, { random: () => 0.99 })).toBe('B4')
    expect(source).toBe('{A{1|2}|B{3|4}}')
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
