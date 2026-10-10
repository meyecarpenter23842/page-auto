/**
 * Advisory draft checks. Never mutate canonical posts or publishing runtime.
 */
export function normalizePostForComparison(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

function wordSet(value: string): Set<string> {
  return new Set(normalizePostForComparison(value).split(' ').filter(Boolean))
}

export function inspectSpinSyntax(value: string): string[] {
  const issues: string[] = []
  let depth = 0
  for (const character of value) {
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth < 0) break
    }
  }
  if (depth !== 0) issues.push('Ngoặc Spin { } không cân bằng; runtime sẽ giữ nguyên cú pháp thay vì chọn biến thể.')
  const unsupported = [...new Set(value.match(/\[r(?:\d+)\]/g) ?? [])]
    .filter((token) => !/^\[r[0-8]\]$/.test(token))
  if (unsupported.length) issues.push('Token icon không được hỗ trợ: ' + unsupported.join(', ') + '.')
  return issues
}

export function inspectContentVariants(variants: readonly string[]): string[] {
  const issues: string[] = []
  const normalized = variants.map(normalizePostForComparison)
  const sets = variants.map(wordSet)
  for (let index = 0; index < variants.length; index += 1) {
    const value = variants[index] ?? ''
    if (!value.trim()) continue
    for (const warning of inspectSpinSyntax(value)) {
      issues.push('Biến thể ' + (index + 1) + ': ' + warning)
    }
    for (let previous = 0; previous < index; previous += 1) {
      if (!normalized[index] || !normalized[previous]) continue
      if (normalized[index] === normalized[previous]) {
        issues.push('Biến thể ' + (index + 1) + ' trùng nội dung với biến thể ' + (previous + 1) + '.')
        break
      }
      const a = sets[index]!
      const b = sets[previous]!
      if (a.size < 10 || b.size < 10) continue
      const overlap = [...a].filter((word) => b.has(word)).length
      if (overlap / Math.max(a.size, b.size) >= 0.9) {
        issues.push('Biến thể ' + (index + 1) + ' rất giống biến thể ' + (previous + 1) + '; nên kiểm tra lại trước khi lưu.')
        break
      }
    }
  }
  return issues
}
