import {
  ACTION_REGISTRY,
  type ActionConfig,
  type ActionConfigFieldDefinition,
  type ActionConfigSchema,
  type ActionDefinition
} from './actionRegistry'

export interface K434FieldUiMeta {
  section: string
  multiline?: boolean
  rows?: number
  visibleWhen?: { key: string; equals: string | number | boolean }
  textFilePickerLabel?: string
}

const PACING: readonly ActionConfigFieldDefinition[] = [
  { key: 'itemDelayMinSeconds', label: 'Delay từ', kind: 'number', defaultValue: 60, min: 0, max: 3600, help: 'giây' },
  { key: 'itemDelayMaxSeconds', label: 'Delay đến', kind: 'number', defaultValue: 180, min: 0, max: 3600, help: 'giây' },
  { key: 'pauseAfterCount', label: 'Sau khi chạy', kind: 'number', defaultValue: 20, min: 0, max: 10000, help: 'lượt' },
  { key: 'pauseMinutes', label: 'Tạm dừng', kind: 'number', defaultValue: 15, min: 0, max: 1440, help: 'phút' }
]

const LEAVE_GROUP_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    {
      key: 'sourceMode',
      label: 'Nguồn nhóm',
      kind: 'select',
      defaultValue: 'id_list',
      options: [
        { value: 'joined_groups', label: 'Nhóm đã tham gia' },
        { value: 'id_list', label: 'Theo Group ID / file ID' }
      ]
    },
    {
      key: 'sourceTargets',
      label: 'Group ID / URL',
      kind: 'text',
      defaultValue: '',
      maxLength: 50000,
      placeholder: 'Mỗi dòng một Group UID hoặc URL Facebook'
    },
    { key: 'leaveMin', label: 'Số nhóm từ', kind: 'number', defaultValue: 1, min: 1, max: 5000 },
    { key: 'leaveMax', label: 'Số nhóm đến', kind: 'number', defaultValue: 3, min: 1, max: 5000 },
    ...PACING
  ]
}

const UI: Record<string, K434FieldUiMeta> = {
  sourceMode: { section: 'Nguồn nhóm' },
  sourceTargets: {
    section: 'Nguồn nhóm',
    multiline: true,
    rows: 5,
    visibleWhen: { key: 'sourceMode', equals: 'id_list' },
    textFilePickerLabel: 'Mở file ID'
  },
  leaveMin: { section: 'Số lượng' },
  leaveMax: { section: 'Số lượng' },
  itemDelayMinSeconds: { section: 'Thiết lập' },
  itemDelayMaxSeconds: { section: 'Thiết lập' },
  pauseAfterCount: { section: 'Thiết lập' },
  pauseMinutes: { section: 'Thiết lập' }
}

let applied = false

export function applyK434LeaveGroupActionOverrides(): void {
  if (applied) return
  const definition: ActionDefinition | undefined = ACTION_REGISTRY.find((item) => item.id === 'leave_group')
  if (definition) {
    definition.description = 'Rời nhóm theo danh sách nhóm đã tham gia hoặc Group ID/file ID; dùng Common Runtime và pacing chung.'
    definition.runtimeStatus = 'ready'
    definition.configSchema = LEAVE_GROUP_SCHEMA
  }
  applied = true
}

export function getK434FieldUiMeta(actionType: string, fieldKey: string): K434FieldUiMeta | undefined {
  if (actionType !== 'leave_group') return undefined
  return UI[fieldKey]
}

export function getK434ValidationErrors(actionType: string, config: ActionConfig): string[] {
  if (actionType !== 'leave_group') return []

  const number = (key: string) => typeof config[key] === 'number' ? config[key] as number : 0
  const text = (key: string) => typeof config[key] === 'string' ? config[key] as string : ''
  const errors: string[] = []

  if (number('leaveMin') > number('leaveMax')) {
    errors.push('Số nhóm muốn rời: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  }
  if (number('itemDelayMinSeconds') > number('itemDelayMaxSeconds')) {
    errors.push('Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  }
  if (text('sourceMode') === 'id_list' && !text('sourceTargets').trim()) {
    errors.push('Group ID / URL: cần nhập danh sách hoặc nạp file ID.')
  }

  return errors
}
