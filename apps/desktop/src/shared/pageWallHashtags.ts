import { spinContent, type ContentSpinContext } from './contentSpin'

export function ensurePageWallHashtagPeriod(value: string): string {
  const normalized = value.trim()
  if (!normalized) return ''
  return normalized.endsWith('.') ? normalized : `${normalized}.`
}

/**
 * Page Wall owns this composition order:
 * 1) spin content source once;
 * 2) spin hashtag source separately once;
 * 3) add a terminal period to the resolved hashtag block;
 * 4) append hashtags after the resolved content.
 *
 * Other consumers keep using canonical variants unchanged.
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
