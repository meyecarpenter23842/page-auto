import { spinContent, type ContentSpinContext } from './contentSpin'

export function ensurePageWallHashtagPeriod(value: string): string {
  const normalized = value.trim()
  if (!normalized) return ''
  return normalized.endsWith('.') ? normalized : `${normalized}.`
}

/**
 * Page Wall owns the composition only at worker runtime:
 * content spin -> hashtag spin -> terminal period -> append.
 * The canonical library keeps both sources separate.
 */
export function composePageWallRuntimeContent(
  contentSource: string,
  hashtagSource: string,
  context: ContentSpinContext = {}
): string {
  const content = spinContent(contentSource, context).trim()
  const hashtags = ensurePageWallHashtagPeriod(spinContent(hashtagSource, context))
  if (!hashtags) return content
  return content ? `${content}\n\n${hashtags}` : hashtags
}
