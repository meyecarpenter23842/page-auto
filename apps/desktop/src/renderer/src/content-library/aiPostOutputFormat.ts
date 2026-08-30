import { formatContentVariantText, parseContentVariantText } from '../../../shared/contentLibrary'

export const AI_POST_DELIMITER = '|'
export const AI_POST_SEPARATOR = `\n${AI_POST_DELIMITER}\n`

export function parseAiPostOutput(value: string): string[] {
  return parseContentVariantText(value)
}

export function formatAiPostOutput(posts: readonly string[]): string {
  return formatContentVariantText(posts)
}

export interface AiPostOutputValidation {
  valid: boolean
  posts: string[]
  expectedCount: number
  actualCount: number
  message: string
}

export function validateAiPostOutput(value: string, expectedCount: number): AiPostOutputValidation {
  const normalizedExpectedCount = Math.max(1, Math.trunc(expectedCount) || 1)
  const posts = parseAiPostOutput(value)
  const actualCount = posts.length
  const valid = actualCount === normalizedExpectedCount

  return {
    valid,
    posts,
    expectedCount: normalizedExpectedCount,
    actualCount,
    message: valid
      ? `Đủ ${normalizedExpectedCount} bài.`
      : `Kết quả có ${actualCount}/${normalizedExpectedCount} bài; mỗi bài phải được phân cách bằng dấu ${AI_POST_DELIMITER}.`
  }
}
