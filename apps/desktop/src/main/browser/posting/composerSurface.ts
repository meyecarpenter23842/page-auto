export const COMPOSER_TITLE_PATTERN = /create\s+(?:a\s+)?post|tạo\s+(?:một\s+)?bài\s+viết/i
export const COMPOSER_TRIGGER_PATTERN = /write something|share something|what'?s on your mind|create\s+(?:a\s+)?post|create a public post|bạn viết gì|bạn đang nghĩ gì|viết gì đó|hãy viết|tạo\s+(?:một\s+)?bài\s+viết|tạo bài viết công khai/i
export const COMPOSER_MEDIA_PATTERN = /photo\s*\/?\s*video|photo|video|ảnh|hình/i

export interface ComposerDiagnostics {
  dialogCount: number
  textboxCount: number
  triggerCount: number
  publishButtonCount: number
  fileInputCount: number
  url: string
}

export function safeComposerUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'unknown'
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().slice(0, 384)
  } catch {
    return 'unknown'
  }
}

export function formatComposerDiagnostics(input: ComposerDiagnostics): string {
  return [
    `composer{dialogs=${input.dialogCount},textboxes=${input.textboxCount},triggers=${input.triggerCount},publish=${input.publishButtonCount},files=${input.fileInputCount}}`,
    `url=${safeComposerUrl(input.url)}`
  ].join(' ')
}
