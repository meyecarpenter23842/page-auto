export interface TextInsertionResult {
  value: string
  cursor: number
}

export function ensureEditorVariants(variants: readonly string[]): string[] {
  return variants.length ? [...variants] : ['']
}

export function replaceEditorVariant(
  variants: readonly string[],
  index: number,
  value: string
): string[] {
  const next = ensureEditorVariants(variants)
  const target = Math.min(Math.max(0, index), next.length - 1)
  next[target] = value
  return next
}

export function insertTextAtSelection(
  source: string,
  snippet: string,
  selectionStart: number,
  selectionEnd: number
): TextInsertionResult {
  const start = Math.min(Math.max(0, selectionStart), source.length)
  const end = Math.min(Math.max(start, selectionEnd), source.length)
  return {
    value: `${source.slice(0, start)}${snippet}${source.slice(end)}`,
    cursor: start + snippet.length
  }
}
