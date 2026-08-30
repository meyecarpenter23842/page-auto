import { describe, expect, it } from 'vitest'
import {
  AI_POST_SEPARATOR,
  formatAiPostOutput,
  parseAiPostOutput,
  validateAiPostOutput
} from './aiPostOutputFormat'

describe('aiPostOutputFormat', () => {
  it('formats every post with the canonical pipe separator', () => {
    expect(formatAiPostOutput(['Bài 1', 'Bài 2', 'Bài 3'])).toBe(
      ['Bài 1', 'Bài 2', 'Bài 3'].join(AI_POST_SEPARATOR)
    )
  })

  it('parses AI output with the same pipe contract as the content library', () => {
    expect(parseAiPostOutput('Bài 1\n|\nBài 2\n|\nBài 3')).toEqual(['Bài 1', 'Bài 2', 'Bài 3'])
  })

  it('validates the exact requested post count before a future save', () => {
    expect(validateAiPostOutput('A\n|\nB\n|\nC', 3)).toMatchObject({ valid: true, actualCount: 3, expectedCount: 3 })
    expect(validateAiPostOutput('A\n|\nB', 3)).toMatchObject({ valid: false, actualCount: 2, expectedCount: 3 })
  })

  it('keeps an escaped pipe inside one post without treating it as a separator', () => {
    const formatted = formatAiPostOutput(['Giá A | Giá B', 'Bài khác'])
    expect(parseAiPostOutput(formatted)).toEqual(['Giá A | Giá B', 'Bài khác'])
  })
})
