/** Presentation-only formatting: persisted logs and retry policy stay in Electron Main. */
import type { ExecutionLogRecord } from '../../../shared/executionLogs'

export function parseLogDateRange(from: string, to: string):
  { fromTimestamp?: number; toTimestamp?: number; error?: string } {
  const fromValue = from ? new Date(from).getTime() : undefined
  const toValue = to ? new Date(to).getTime() : undefined
  if ((from && !Number.isFinite(fromValue)) || (to && !Number.isFinite(toValue)))
    return { error: 'Ngày hoặc giờ lọc không hợp lệ.' }
  if (fromValue !== undefined && toValue !== undefined && fromValue > toValue)
    return { error: 'Giờ bắt đầu phải trước giờ kết thúc.' }
  return { ...(fromValue === undefined ? {} : { fromTimestamp: fromValue }),
    ...(toValue === undefined ? {} : { toTimestamp: toValue }) }
}

/** Never copy full URLs, credentials, authorization headers or emails from diagnostic logs. */
export function sanitizedLogError(code: string | null, message: string | null): string {
  const raw = [code, message].filter(Boolean).join('\n') || 'Không có mã hoặc nội dung lỗi.'
  return raw
    .replace(/https?:\/\/[^\s"'<>]+/gi, (value) => {
      try { const url = new URL(value); return url.origin + url.pathname }
      catch { return '[URL đã ẩn]' }
    })
    .replace(/\b(cookie|set-cookie|authorization)\s*:\s*[^\r\n]*/gi, '$1: [ĐÃ ẨN]')
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/-]+/gi, '$1 [ĐÃ ẨN]')
    .replace(/\b(password|passwd|pwd|token|secret|api[_-]?key|otp|2fa|proxyPassword)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[ĐÃ ẨN]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email đã ẩn]')
}

export function filterLogsByAction(logs: readonly ExecutionLogRecord[], text: string): ExecutionLogRecord[] {
  const query = text.trim().toLocaleLowerCase('vi')
  return !query ? [...logs] : logs.filter((item) => item.action.toLocaleLowerCase('vi').includes(query))
}

export function formatLogEvidence(log: ExecutionLogRecord): Array<{ label: string; value: string }> {
  return [
    ...(log.screenshotPath ? [{ label: 'Ảnh chụp lỗi (đường dẫn trên máy)', value: log.screenshotPath }] : []),
    ...(log.publishedUrl ? [{ label: 'URL bài viết', value: log.publishedUrl }] : []),
    ...(log.imagePaths.length ? [{ label: 'File ảnh đã dùng', value: log.imagePaths.join('\n') }] : [])
  ]
}
