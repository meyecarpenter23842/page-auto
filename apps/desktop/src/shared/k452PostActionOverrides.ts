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
  postToWall: { section: 'Nơi đăng' },
  wallPostsPerAccount: { section: 'Nơi đăng', visibleWhen: { key: 'postToWall', equals: true } },
  postToGroups: { section: 'Nơi đăng' },
  groupTargets: {
    section: 'Đăng nhóm',
    multiline: true,
    rows: 5,
    visibleWhen: { key: 'postToGroups', equals: true },
    textFilePickerLabel: 'Mở file ID'
  },
  groupPostsPerAccount: { section: 'Nơi đăng', visibleWhen: { key: 'postToGroups', equals: true } },
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

function scalarConfig(value: unknown): ActionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: ActionConfig = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') result[key] = entry
  }
  return result
}

/**
 * Keeps Scenario `post` as one composite action owned by the running profile.
 * The short-lived Page UID field is intentionally discarded. The short-lived
 * wall-only `postsPerAccount` field is migrated into wallPostsPerAccount.
 */
export function normalizeK452PostConfig(input: unknown): ActionConfig {
  const source = scalarConfig(input)
  const normalized: ActionConfig = {
    selectionMode: source.selectionMode === 'random' ? 'random' : 'sequential',
    postToWall: typeof source.postToWall === 'boolean' ? source.postToWall : true,
    wallPostsPerAccount: typeof source.wallPostsPerAccount === 'number'
      ? source.wallPostsPerAccount
      : typeof source.postsPerAccount === 'number'
        ? source.postsPerAccount
        : 1,
    postToGroups: source.postToGroups === true,
    groupTargets: typeof source.groupTargets === 'string' ? source.groupTargets : '',
    groupPostsPerAccount: typeof source.groupPostsPerAccount === 'number' ? source.groupPostsPerAccount : 1,
    postDelayMinSeconds: typeof source.postDelayMinSeconds === 'number' ? source.postDelayMinSeconds : 200,
    postDelayMaxSeconds: typeof source.postDelayMaxSeconds === 'number' ? source.postDelayMaxSeconds : 300
  }
  if (typeof source.contentSetId === 'number') normalized.contentSetId = source.contentSetId
  return normalized
}

export function applyK452PostActionOverrides(): void {
  const definition = getActionDefinition('post')
  if (!definition) return
  definition.label = 'Đăng bài'
  definition.runtimeStatus = 'ready'
  definition.description = 'Đăng bài bằng tài khoản đang chạy Kịch Bản: lên tường, vào nhóm hoặc cả hai.'
  definition.capabilities.actors = ['profile']
  definition.configSchema = {
    version: 1,
    fields: [
      {
        key: 'contentSetId',
        label: 'Nguồn bài viết',
        kind: 'number',
        required: true,
        min: 1,
        help: 'Nguồn compatibility; bài canonical đã bind được ưu tiên khi Start.'
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
        key: 'wallPostsPerAccount',
        label: 'Số bài đăng tường',
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
        label: 'Số bài đăng nhóm',
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
    errors.push('Nguồn bài viết: cần có nguồn/binding bài viết hợp lệ.')
  }
  if (!postToWall && !postToGroups) errors.push('Cần bật ít nhất một nơi đăng: Đăng tường hoặc Đăng nhóm.')
  if (postToWall && (!Number.isSafeInteger(wallPosts) || wallPosts < 1)) errors.push('Đăng tường: Số bài phải từ 1 trở lên.')
  if (postToGroups && !stringValue(config, 'groupTargets')) errors.push('Group ID / URL: cần nhập ít nhất một Group khi bật Đăng nhóm.')
  if (postToGroups && (!Number.isSafeInteger(groupPosts) || groupPosts < 1)) errors.push('Đăng nhóm: Số bài phải từ 1 trở lên.')
  if (delayMax < delayMin) errors.push('Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  return errors
}
