import {
  ACTION_REGISTRY,
  type ActionConfig,
  type ActionConfigFieldDefinition,
  type ActionConfigSchema,
  type ActionDefinition
} from './actionRegistry'

export interface K432FieldUiMeta {
  section: string
  multiline?: boolean
  rows?: number
  visibleWhen?: { key: string; equals: string | number | boolean }
}

const PACING: readonly ActionConfigFieldDefinition[] = [
  { key: 'itemDelayMinSeconds', label: 'Delay từ', kind: 'number', defaultValue: 200, min: 0, max: 3600, help: 'giây' },
  { key: 'itemDelayMaxSeconds', label: 'Delay đến', kind: 'number', defaultValue: 300, min: 0, max: 3600, help: 'giây' },
  { key: 'pauseAfterCount', label: 'Sau khi chạy', kind: 'number', defaultValue: 30, min: 0, max: 10000, help: 'người' },
  { key: 'pauseMinutes', label: 'Tạm dừng', kind: 'number', defaultValue: 15, min: 0, max: 1440, help: 'phút' }
]

const INVITE_FRIENDS_GROUP_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    {
      key: 'groupTargets',
      label: 'ID nhóm muốn mời bạn bè',
      kind: 'text',
      defaultValue: '',
      maxLength: 50000,
      placeholder: 'Mỗi dòng một Group UID hoặc URL Facebook'
    },
    { key: 'inviteMin', label: 'Số bạn bè muốn mời từ', kind: 'number', defaultValue: 100, min: 1, max: 5000 },
    { key: 'inviteMax', label: 'Số bạn bè muốn mời đến', kind: 'number', defaultValue: 200, min: 1, max: 5000 },
    {
      key: 'invitePerBatch',
      label: 'Số người mời / 1 lượt',
      kind: 'number',
      defaultValue: 7,
      min: 1,
      max: 100,
      help: 'người'
    },
    ...PACING
  ]
}

const UI: Record<string, K432FieldUiMeta> = {
  groupTargets: { section: 'Nhóm đích', multiline: true, rows: 6 },
  inviteMin: { section: 'Số lượng' },
  inviteMax: { section: 'Số lượng' },
  invitePerBatch: { section: 'Số lượng' },
  itemDelayMinSeconds: { section: 'Thiết lập' },
  itemDelayMaxSeconds: { section: 'Thiết lập' },
  pauseAfterCount: { section: 'Thiết lập' },
  pauseMinutes: { section: 'Thiết lập' }
}

let applied = false

export function applyK432InviteFriendsGroupActionOverrides(): void {
  if (applied) return
  const definition: ActionDefinition | undefined = ACTION_REGISTRY.find((item) => item.id === 'invite_friends_to_group')
  if (definition) {
    definition.description = 'Mời bạn bè vào danh sách nhóm theo số lượng, chia lượt và pacing cấu hình.'
    definition.runtimeStatus = 'ready'
    definition.configSchema = INVITE_FRIENDS_GROUP_SCHEMA
  }
  applied = true
}

export function getK432FieldUiMeta(actionType: string, fieldKey: string): K432FieldUiMeta | undefined {
  if (actionType !== 'invite_friends_to_group') return undefined
  return UI[fieldKey]
}

export function getK432ValidationErrors(actionType: string, config: ActionConfig): string[] {
  if (actionType !== 'invite_friends_to_group') return []

  const number = (key: string) => typeof config[key] === 'number' ? config[key] as number : 0
  const text = (key: string) => typeof config[key] === 'string' ? config[key] as string : ''
  const errors: string[] = []

  if (!text('groupTargets').trim()) {
    errors.push('ID nhóm muốn mời bạn bè: không được để trống.')
  }
  if (number('inviteMin') > number('inviteMax')) {
    errors.push('Số bạn bè muốn mời: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  }
  if (number('itemDelayMinSeconds') > number('itemDelayMaxSeconds')) {
    errors.push('Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  }
  if (number('invitePerBatch') < 1) {
    errors.push('Số người mời / 1 lượt: phải lớn hơn 0.')
  }

  return errors
}
