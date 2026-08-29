import {
  ACTION_REGISTRY,
  type ActionConfig,
  type ActionConfigFieldDefinition,
  type ActionConfigSchema,
  type ActionDefinition
} from './actionRegistry'
import { parsePostVariantText } from './pageTabs'

export interface K435FieldUiMeta {
  section: string
  multiline?: boolean
  rows?: number
  visibleWhen?: { key: string; equals: string | number | boolean }
  textFilePickerLabel?: string
  folderPickerLabel?: string
}

const GROUP_POST_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    {
      key: 'sourceTargets',
      label: 'Group ID / URL',
      kind: 'text',
      required: true,
      defaultValue: '',
      maxLength: 50000,
      placeholder: 'Mỗi dòng một Group UID hoặc URL Facebook'
    },
    {
      key: 'content',
      label: 'Nội dung bài viết',
      kind: 'text',
      required: true,
      defaultValue: '',
      maxLength: 100000,
      placeholder: 'Nhập nội dung. Dùng dấu | để tách các biến thể bài viết.',
      help: 'Các biến thể được tách bằng dấu |; dùng \\| nếu cần ký tự | trong nội dung.'
    },
    {
      key: 'postMode',
      label: 'Chọn nội dung',
      kind: 'select',
      defaultValue: 'sequential',
      options: [
        { value: 'sequential', label: 'Tuần tự' },
        { value: 'random', label: 'Ngẫu nhiên' }
      ]
    },
    { key: 'postsPerAccount', label: 'Số bài mỗi tài khoản', kind: 'number', defaultValue: 1, min: 1, max: 1000 },
    { key: 'postDelayMinSeconds', label: 'Delay bài từ', kind: 'number', defaultValue: 200, min: 0, max: 3600, help: 'giây' },
    { key: 'postDelayMaxSeconds', label: 'Delay bài đến', kind: 'number', defaultValue: 300, min: 0, max: 3600, help: 'giây' },
    {
      key: 'imageFolderPath',
      label: 'Folder ảnh',
      kind: 'text',
      defaultValue: '',
      maxLength: 2000,
      placeholder: 'Để trống nếu chỉ đăng text'
    },
    {
      key: 'imageMode',
      label: 'Chọn ảnh',
      kind: 'select',
      defaultValue: 'sequential',
      options: [
        { value: 'sequential', label: 'Tuần tự' },
        { value: 'random', label: 'Ngẫu nhiên' },
        { value: 'filename_match', label: 'Tên file chứa Group UID' }
      ]
    },
    { key: 'imagesPerPost', label: 'Số ảnh mỗi bài', kind: 'number', defaultValue: 1, min: 1, max: 20 },
    {
      key: 'missingPolicy',
      label: 'Khi thiếu ảnh',
      kind: 'select',
      defaultValue: 'text_only',
      options: [
        { value: 'text_only', label: 'Vẫn đăng text' },
        { value: 'skip', label: 'Bỏ qua Group trong phiên hiện tại' }
      ]
    }
  ]
}

const UI: Record<string, K435FieldUiMeta> = {
  sourceTargets: { section: 'Nguồn nhóm', multiline: true, rows: 6, textFilePickerLabel: 'Mở file ID' },
  content: { section: 'Bài viết', multiline: true, rows: 8 },
  postMode: { section: 'Bài viết' },
  postsPerAccount: { section: 'Số lượng & thời gian' },
  postDelayMinSeconds: { section: 'Số lượng & thời gian' },
  postDelayMaxSeconds: { section: 'Số lượng & thời gian' },
  imageFolderPath: { section: 'Ảnh', folderPickerLabel: 'Chọn folder' },
  imageMode: { section: 'Ảnh' },
  imagesPerPost: { section: 'Ảnh' },
  missingPolicy: { section: 'Ảnh' }
}

let applied = false

export function applyK435GroupPostActionOverrides(): void {
  if (applied) return
  const definition: ActionDefinition | undefined = ACTION_REGISTRY.find((item) => item.id === 'group_post')
  if (definition) {
    definition.description = 'Đăng bài vào Group bằng posting module thật; Scenario profile không switch Page và dùng snapshot Group chống trùng theo phiên.'
    definition.runtimeStatus = 'ready'
    definition.configSchema = GROUP_POST_SCHEMA
  }
  applied = true
}

export function getK435FieldUiMeta(actionType: string, fieldKey: string): K435FieldUiMeta | undefined {
  if (actionType !== 'group_post') return undefined
  return UI[fieldKey]
}

export function getK435ValidationErrors(actionType: string, config: ActionConfig): string[] {
  if (actionType !== 'group_post') return []
  const number = (key: string) => typeof config[key] === 'number' ? config[key] as number : 0
  const text = (key: string) => typeof config[key] === 'string' ? config[key] as string : ''
  const errors: string[] = []

  if (!text('sourceTargets').split(/\r?\n/).some((value) => value.trim())) {
    errors.push('Group ID / URL: cần nhập ít nhất một Group.')
  }
  if (parsePostVariantText(text('content')).length === 0) {
    errors.push('Nội dung bài viết: cần ít nhất một nội dung hợp lệ.')
  }
  if (number('postDelayMinSeconds') > number('postDelayMaxSeconds')) {
    errors.push('Delay bài: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  }

  return errors
}
