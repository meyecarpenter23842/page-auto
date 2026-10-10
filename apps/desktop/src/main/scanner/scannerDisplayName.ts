export function chooseFacebookDisplayName(candidates: Array<string | null | undefined>, fallback: string): string {
  const normalizedFallback = fallback.replace(/\s+/g, ' ').trim()
  for (const candidate of candidates) {
    const normalized = (candidate ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\s*(?:\||-|·)\s*Facebook\s*$/i, '')
      .trim()
    if (!normalized || /^Facebook$/i.test(normalized)) continue
    if (normalizedFallback && normalized === normalizedFallback) continue
    return normalized
  }
  return normalizedFallback
}
