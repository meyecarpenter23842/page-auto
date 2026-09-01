import {
  ACTION_REGISTRY,
  type ActionConfig,
  type ActionConfigFieldDefinition,
  type ActionConfigSchema,
  type ActionDefinition
} from './actionRegistry'

export interface K431FieldUiMeta {
  section: string
  multiline?: boolean
  rows?: number
  visibleWhen?: { key: string; equals: string | number | boolean }
  textFilePickerLabel?: string
}

const PACING: readonly ActionConfigFieldDefinition[] = [
  { key: 'itemDelayMinSeconds', label: 'Delay từ', kind: 'number', defaultValue: 200, min: 0, max: 3600, help: 'giây' },
  { key: 'itemDelayMaxSeconds', label: 'Delay đến', kind: 'number', defaultValue: 300, min: 0, max: 3600, help: 'giây' },
  { key: 'pauseAfterCount', label: 'Sau khi chạy', kind: 'number', defaultValue: 30, min: 0, max: 10000, help: 'lượt' },
  { key: 'pauseMinutes', label: 'Tạm dừng', kind: 'number', defaultValue: 15, min: 0, max: 1440, help: 'phút' },
  {
    key: 'errorPauseMinutes',
    label: 'Tạm nghỉ khi lượt join lỗi',
    kind: 'number',
    defaultValue: 0,
    min: 0,
    max: 1440,
    help: 'phút; cộng thêm sau kết quả không verify được'
  }
]

const JOIN_GROUP_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    {
      key: 'sourceMode',
      label: 'Nguồn nhóm',
      kind: 'select',
      defaultValue: 'id_list',
      options: [
        { value: 'id_list', label: 'Theo Group ID / file ID' },
        { value: 'suggestions', label: 'Theo gợi ý' },
        { value: 'keyword', label: 'Theo từ khóa' }
      ]
    },
    {
      key: 'answerQuestions',
      label: 'Nội dung trả lời câu hỏi nhóm',
      kind: 'text',
      defaultValue: '',
      maxLength: 12000,
      placeholder: 'Mỗi dòng một câu trả lời; các ô câu hỏi dạng text được điền lần lượt',
      help: 'Nhóm cần duyệt: nếu có câu hỏi dạng text, action sẽ điền các dòng này rồi gửi yêu cầu tham gia.'
    },
    {
      key: 'sourceTargets',
      label: 'Group ID / URL',
      kind: 'text',
      defaultValue: '',
      maxLength: 50000,
      placeholder: 'Mỗi dòng một Group UID hoặc URL Facebook'
    },
    {
      key: 'keyword',
      label: 'Từ khóa',
      kind: 'text',
      defaultValue: '',
      maxLength: 1000,
      placeholder: 'Ví dụ: đồ gỗ, nội thất'
    },
    { key: 'joinMin', label: 'Số nhóm từ', kind: 'number', defaultValue: 100, min: 1, max: 5000 },
    { key: 'joinMax', label: 'Số nhóm đến', kind: 'number', defaultValue: 200, min: 1, max: 5000 },
    { key: 'memberFilterEnabled', label: 'Lọc theo số thành viên', kind: 'boolean', defaultValue: false },
    { key: 'memberMin', label: 'Thành viên tối thiểu', kind: 'number', defaultValue: 5000, min: 0, max: 1000000000 },
    {
      key: 'memberMax',
      label: 'Thành viên tối đa',
      kind: 'number',
      defaultValue: 0,
      min: 0,
      max: 1000000000,
      help: '0 = không giới hạn trên'
    },
    { key: 'privacyOpen', label: 'Công khai (OPEN)', kind: 'boolean', defaultValue: true },
    { key: 'privacyClosed', label: 'Riêng tư (CLOSED)', kind: 'boolean', defaultValue: true },
    {
      key: 'skipApprovalRequired',
      label: 'Bỏ qua nhóm phải duyệt',
      kind: 'boolean',
      defaultValue: false,
      help: 'Chỉ bỏ qua khi không có nội dung trả lời. Nếu đã cấu hình câu trả lời text, action vẫn gửi yêu cầu tham gia.'
    },
    { key: 'locationEnabled', label: 'Lọc location', kind: 'boolean', defaultValue: false },
    {
      key: 'locationKeyword',
      label: 'Location chứa',
      kind: 'text',
      defaultValue: '',
      maxLength: 300,
      placeholder: 'Ví dụ: Hồ Chí Minh'
    },
    { key: 'localeEnabled', label: 'Lọc locale', kind: 'boolean', defaultValue: false },
    {
      key: 'locale',
      label: 'Locale',
      kind: 'text',
      defaultValue: '',
      maxLength: 40,
      placeholder: 'Ví dụ: vi_VN'
    },
    ...PACING
  ]
}

const UI: Record<string, K431FieldUiMeta> = {
  sourceMode: { section: 'Nguồn nhóm' },
  answerQuestions: { section: 'Câu hỏi nhóm kín / cần duyệt', multiline: true, rows: 4 },
  sourceTargets: {
    section: 'Nguồn nhóm',
    multiline: true,
    rows: 5,
    visibleWhen: { key: 'sourceMode', equals: 'id_list' },
    textFilePickerLabel: 'Mở file ID'
  },
  keyword: { section: 'Nguồn nhóm', visibleWhen: { key: 'sourceMode', equals: 'keyword' } },
  joinMin: { section: 'Số lượng' },
  joinMax: { section: 'Số lượng' },
  memberFilterEnabled: { section: 'Điều kiện' },
  memberMin: { section: 'Điều kiện', visibleWhen: { key: 'memberFilterEnabled', equals: true } },
  memberMax: { section: 'Điều kiện', visibleWhen: { key: 'memberFilterEnabled', equals: true } },
  privacyOpen: { section: 'Điều kiện' },
  privacyClosed: { section: 'Điều kiện' },
  skipApprovalRequired: { section: 'Câu hỏi nhóm kín / cần duyệt' },
  locationEnabled: { section: 'Điều kiện' },
  locationKeyword: { section: 'Điều kiện', visibleWhen: { key: 'locationEnabled', equals: true } },
  localeEnabled: { section: 'Điều kiện' },
  locale: { section: 'Điều kiện', visibleWhen: { key: 'localeEnabled', equals: true } },
  itemDelayMinSeconds: { section: 'Thiết lập' },
  itemDelayMaxSeconds: { section: 'Thiết lập' },
  pauseAfterCount: { section: 'Thiết lập' },
  pauseMinutes: { section: 'Thiết lập' },
  errorPauseMinutes: { section: 'Thiết lập' }
}

let applied = false

export function applyK431JoinGroupActionOverrides(): void {
  if (applied) return
  const definition: ActionDefinition | undefined = ACTION_REGISTRY.find((item) => item.id === 'join_group')
  if (definition) {
    definition.description = 'Tham gia nhóm theo Group ID/file ID, gợi ý hoặc từ khóa; hỗ trợ câu hỏi nhóm kín, bộ lọc và pacing.'
    definition.runtimeStatus = 'ready'
    definition.configSchema = JOIN_GROUP_SCHEMA
  }
  applied = true
}

export function getK431FieldUiMeta(actionType: string, fieldKey: string): K431FieldUiMeta | undefined {
  if (actionType !== 'join_group') return undefined
  return UI[fieldKey]
}

export function getK431ValidationErrors(actionType: string, config: ActionConfig): string[] {
  if (actionType !== 'join_group') return []

  const number = (key: string) => typeof config[key] === 'number' ? config[key] as number : 0
  const text = (key: string) => typeof config[key] === 'string' ? config[key] as string : ''
  const bool = (key: string) => config[key] === true
  const errors: string[] = []

  if (number('joinMin') > number('joinMax')) {
    errors.push('Số nhóm muốn gia nhập: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  }
  if (number('itemDelayMinSeconds') > number('itemDelayMaxSeconds')) {
    errors.push('Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  }
  if (bool('memberFilterEnabled') && number('memberMax') > 0 && number('memberMin') > number('memberMax')) {
    errors.push('Số thành viên: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  }

  const mode = text('sourceMode')
  if (mode === 'id_list' && !text('sourceTargets').trim()) {
    errors.push('Group ID / URL: cần nhập danh sách hoặc nạp file ID.')
  }
  if (mode === 'keyword' && !text('keyword').trim()) {
    errors.push('Từ khóa: không được để trống khi chọn nguồn theo từ khóa.')
  }
  if (!bool('privacyOpen') && !bool('privacyClosed')) {
    errors.push('Privacy: cần chọn ít nhất OPEN hoặc CLOSED.')
  }
  if (bool('locationEnabled') && !text('locationKeyword').trim()) {
    errors.push('Location: cần nhập giá trị khi bật lọc location.')
  }
  if (bool('localeEnabled') && !text('locale').trim()) {
    errors.push('Locale: cần nhập mã locale khi bật lọc locale.')
  }

  return errors
}
