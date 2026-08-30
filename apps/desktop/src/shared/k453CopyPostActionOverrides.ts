import type { ActionConfig } from './actionRegistry'
import { getActionDefinition } from './actionRegistry'

export interface K453CopyPostFieldUiMeta {
  section: string
  multiline?: boolean
  rows?: number
  visibleWhen?: { key: string; equals: string | number | boolean }
  folderPickerLabel?: string
}

const UI_META: Record<string, K453CopyPostFieldUiMeta> = {
  sourcesText: { section: 'Nguồn quét', multiline: true, rows: 4 },
  fromDate: { section: 'Bộ lọc' },
  toDate: { section: 'Bộ lọc' },
  limit: { section: 'Bộ lọc' },
  randomCount: { section: 'Bộ lọc' },
  includeStatus: { section: 'Loại bài' },
  includePhoto: { section: 'Loại bài' },
  includeVideo: { section: 'Loại bài' },
  includeReel: { section: 'Loại bài' },
  includeLink: { section: 'Loại bài' },
  stripLinks: { section: 'Xử lý nội dung' },
  stripHashtags: { section: 'Xử lý nội dung' },
  ignoreContent: { section: 'Xử lý nội dung' },
  prefixText: { section: 'Xử lý nội dung', multiline: true, rows: 2 },
  suffixText: { section: 'Xử lý nội dung', multiline: true, rows: 2 },
  skipCopied: { section: 'Chống trùng' },
  mediaFolder: { section: 'Lưu media', folderPickerLabel: 'Chọn thư mục' }
}

export function applyK453CopyPostActionOverrides(): void {
  const definition = getActionDefinition('copy_post')
  if (!definition) return
  definition.label = 'Copy bài viết'
  definition.description = 'Nhập token tạm thời để quét bài nguồn, duyệt/sửa kết quả rồi lưu vào Thư viện bài viết chung.'
  definition.capabilities.actors = ['profile']
  definition.configSchema = {
    version: 1,
    fields: [
      {
        key: 'sourcesText',
        label: 'Profile / Page nguồn',
        kind: 'text',
        required: true,
        maxLength: 15_000,
        placeholder: 'Mỗi dòng một UID hoặc URL Facebook...'
      },
      { key: 'fromDate', label: 'Từ ngày', kind: 'text', defaultValue: '', maxLength: 10 },
      { key: 'toDate', label: 'Đến ngày', kind: 'text', defaultValue: '', maxLength: 10 },
      { key: 'limit', label: 'Giới hạn số bài', kind: 'number', defaultValue: 50, min: 1, max: 500 },
      { key: 'randomCount', label: 'Lấy ngẫu nhiên N bài', kind: 'number', defaultValue: 0, min: 0, max: 500 },
      { key: 'includeStatus', label: 'Status', kind: 'boolean', defaultValue: true },
      { key: 'includePhoto', label: 'Photo', kind: 'boolean', defaultValue: true },
      { key: 'includeVideo', label: 'Video', kind: 'boolean', defaultValue: true },
      { key: 'includeReel', label: 'Reel', kind: 'boolean', defaultValue: true },
      { key: 'includeLink', label: 'Link', kind: 'boolean', defaultValue: true },
      { key: 'stripLinks', label: 'Bỏ link trong nội dung', kind: 'boolean', defaultValue: false },
      { key: 'stripHashtags', label: 'Bỏ hashtag', kind: 'boolean', defaultValue: false },
      { key: 'ignoreContent', label: 'Không lấy nội dung chữ', kind: 'boolean', defaultValue: false },
      { key: 'prefixText', label: 'Thêm đầu bài', kind: 'text', defaultValue: '', maxLength: 5_000 },
      { key: 'suffixText', label: 'Thêm cuối bài', kind: 'text', defaultValue: '', maxLength: 5_000 },
      { key: 'skipCopied', label: 'Bỏ qua bài đã copy', kind: 'boolean', defaultValue: true },
      {
        key: 'mediaFolder',
        label: 'Thư mục lưu ảnh / video',
        kind: 'text',
        defaultValue: '',
        maxLength: 2_000,
        help: 'Bắt buộc trước khi lưu nếu bài đã chọn còn ảnh hoặc video.'
      }
    ]
  }
}

export function getK453CopyPostFieldUiMeta(actionType: string, fieldKey: string): K453CopyPostFieldUiMeta | undefined {
  return actionType === 'copy_post' ? UI_META[fieldKey] : undefined
}

function stringValue(config: ActionConfig, key: string): string {
  const value = config[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function getK453CopyPostValidationErrors(actionType: string, config: ActionConfig): string[] {
  if (actionType !== 'copy_post') return []
  const errors: string[] = []
  if (!stringValue(config, 'sourcesText')) errors.push('Profile / Page nguồn: cần ít nhất một UID hoặc URL.')
  if (![config.includeStatus, config.includePhoto, config.includeVideo, config.includeReel, config.includeLink].some(Boolean)) {
    errors.push('Loại bài: cần chọn ít nhất một loại bài.')
  }
  const fromDate = stringValue(config, 'fromDate')
  const toDate = stringValue(config, 'toDate')
  if (fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) errors.push('Từ ngày: dùng định dạng YYYY-MM-DD.')
  if (toDate && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) errors.push('Đến ngày: dùng định dạng YYYY-MM-DD.')
  if (fromDate && toDate && fromDate > toDate) errors.push('Khoảng ngày: Từ ngày phải nhỏ hơn hoặc bằng Đến ngày.')
  return errors
}
