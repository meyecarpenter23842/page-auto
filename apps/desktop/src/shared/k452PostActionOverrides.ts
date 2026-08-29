import type { ActionConfig } from './actionRegistry'
import { getActionDefinition } from './actionRegistry'

const POST_SELECTION_OPTIONS = [
  { value: 'sequential', label: 'Lần lượt' },
  { value: 'random', label: 'Ngẫu nhiên' }
] as const

export interface K452PostFieldUiMeta {
  section: string
  multiline?: boolean
  rows?: number
  visibleWhen?: { key: string; equals: string | number | boolean }
  textFilePickerLabel?: string
}

const UI_META: Record<string, K452PostFieldUiMeta> = {
  contentSetId: { section: 'Nguồn bài viết' },
  selectionMode: { section: 'Nguồn bài viết' },
  postToWall: { section: 'Đăng tường' },
  wallPageUid: { section: 'Đăng tường', visibleWhen: { key: 'postToWall', equals: true } },
  wallPostsPerAccount: { section: 'Đăng tường', visibleWhen: { key: 'postToWall', equals: true } },
  postToGroups: { section: 'Đăng nhóm' },
  groupTargets: {
    section: 'Đăng nhóm',
    multiline: true,
    rows: 5,
    visibleWhen: { key: 'postToGroups', equals: true },
    textFilePickerLabel: 'Mở file ID'
  },
  groupPostsPerAccount: { section: 'Đăng nhóm', visibleWhen: { key: 'postToGroups', equals: true } },
  postDelayMinSeconds: { section: 'Delay' },
  postDelayMaxSeconds: { section: 'Delay' }
}

function numberValue(config: ActionConfig, key: string, fallback: number): number {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringValue(config: ActionConfig, key: string): string {
  const value = config[key]
  return typeof value === 'string' ? value.trim() : ''
}

function booleanValue(config: ActionConfig, key: string): boolean {
  return config[key] === true
}

export function applyK452PostActionOverrides(): void {
  const definition = getActionDefinition('post')
  if (!definition) return
  definition.runtimeStatus = 'ready'
  definition.description = 'Đăng bài từ Thư viện chung lên tường Page và/hoặc Group.'
  definition.configSchema = {
    version: 1,
    fields: [
      {
        key: 'contentSetId',
        label: 'Nguồn bài viết',
        kind: 'number',
        required: true,
        min: 1,
        help: 'Chọn nguồn global từ Thư viện Bài viết chung.'
      },
      {
        key: 'selectionMode',
        label: 'Cách lấy bài',
        kind: 'select',
        defaultValue: 'sequential',
        options: POST_SELECTION_OPTIONS
      },
      { key: 'postToWall', label: 'Đăng tường', kind: 'boolean', defaultValue: true },
      {
        key: 'wallPageUid',
        label: 'Page UID',
        kind: 'text',
        defaultValue: '',
        maxLength: 200,
        placeholder: 'Nhập Page UID...'
      },
      {
        key: 'wallPostsPerAccount',
        label: 'Số bài',
        kind: 'number',
        defaultValue: 1,
        min: 1,
        max: 100
      },
      { key: 'postToGroups', label: 'Đăng nhóm', kind: 'boolean', defaultValue: false },
      {
        key: 'groupTargets',
        label: 'Group ID / URL',
        kind: 'text',
        defaultValue: '',
        maxLength: 100_000,
        placeholder: 'Mỗi dòng một Group UID hoặc URL Facebook...'
      },
      {
        key: 'groupPostsPerAccount',
        label: 'Số bài',
        kind: 'number',
        defaultValue: 1,
        min: 1,
        max: 100
      },
      {
        key: 'postDelayMinSeconds',
        label: 'Delay từ',
        kind: 'number',
        defaultValue: 200,
        min: 0,
        max: 86_400,
        help: 'giây'
      },
      {
        key: 'postDelayMaxSeconds',
        label: 'Delay đến',
        kind: 'number',
        defaultValue: 300,
        min: 0,
        max: 86_400,
        help: 'giây'
      }
    ]
  }
}

export function getK452PostFieldUiMeta(actionType: string, fieldKey: string): K452PostFieldUiMeta | undefined {
  return actionType === 'post' ? UI_META[fieldKey] : undefined
}

export function getK452PostValidationErrors(actionType: string, config: ActionConfig): string[] {
  if (actionType !== 'post') return []
  const errors: string[] = []
  const contentSetId = numberValue(config, 'contentSetId', 0)
  const postToWall = booleanValue(config, 'postToWall')
  const postToGroups = booleanValue(config, 'postToGroups')
  const wallPosts = numberValue(config, 'wallPostsPerAccount', 1)
  const groupPosts = numberValue(config, 'groupPostsPerAccount', 1)
  const delayMin = numberValue(config, 'postDelayMinSeconds', 0)
  const delayMax = numberValue(config, 'postDelayMaxSeconds', 0)

  if (!Number.isSafeInteger(contentSetId) || contentSetId <= 0) {
    errors.push('Nguồn bài viết: cần chọn một nguồn trong Thư viện chung.')
  }
  if (!postToWall && !postToGroups) errors.push('Cần bật ít nhất một đích: Đăng tường hoặc Đăng nhóm.')
  if (postToWall && !stringValue(config, 'wallPageUid')) errors.push('Page UID: không được để trống khi bật Đăng tường.')
  if (postToWall && (!Number.isSafeInteger(wallPosts) || wallPosts < 1)) errors.push('Đăng tường: Số bài phải từ 1 trở lên.')
  if (postToGroups && !stringValue(config, 'groupTargets')) errors.push('Group ID / URL: cần nhập ít nhất một Group khi bật Đăng nhóm.')
  if (postToGroups && (!Number.isSafeInteger(groupPosts) || groupPosts < 1)) errors.push('Đăng nhóm: Số bài phải từ 1 trở lên.')
  if (delayMax < delayMin) errors.push('Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  return errors
}
