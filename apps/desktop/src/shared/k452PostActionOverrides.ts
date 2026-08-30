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
  postsPerAccount: { section: 'Số lượng' },
  postDelayMinSeconds: { section: 'Delay' },
  postDelayMaxSeconds: { section: 'Delay' }
}

function numberValue(config: ActionConfig, key: string, fallback: number): number {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
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
 * Converts the short-lived composite `post` config (Page wall + Group) into the
 * canonical Scenario meaning: post to the wall of the profile/account that is
 * already running the Scenario. Destination/Page fields are intentionally dropped.
 */
export function normalizeK452PostConfig(input: unknown): ActionConfig {
  const source = scalarConfig(input)
  const postsPerAccount = typeof source.postsPerAccount === 'number'
    ? source.postsPerAccount
    : typeof source.wallPostsPerAccount === 'number'
      ? source.wallPostsPerAccount
      : 1

  const normalized: ActionConfig = {
    selectionMode: source.selectionMode === 'random' ? 'random' : 'sequential',
    postsPerAccount,
    postDelayMinSeconds: typeof source.postDelayMinSeconds === 'number' ? source.postDelayMinSeconds : 200,
    postDelayMaxSeconds: typeof source.postDelayMaxSeconds === 'number' ? source.postDelayMaxSeconds : 300
  }
  if (typeof source.contentSetId === 'number') normalized.contentSetId = source.contentSetId
  return normalized
}

export function applyK452PostActionOverrides(): void {
  const definition = getActionDefinition('post')
  if (!definition) return
  definition.label = 'Đăng tường'
  definition.runtimeStatus = 'ready'
  definition.description = 'Đăng bài lên tường của tài khoản đang chạy Kịch Bản.'
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
      {
        key: 'postsPerAccount',
        label: 'Số bài / tài khoản',
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
  const postsPerAccount = numberValue(config, 'postsPerAccount', 1)
  const delayMin = numberValue(config, 'postDelayMinSeconds', 0)
  const delayMax = numberValue(config, 'postDelayMaxSeconds', 0)

  if (!Number.isSafeInteger(contentSetId) || contentSetId <= 0) {
    errors.push('Nguồn bài viết: cần có nguồn/binding bài viết hợp lệ.')
  }
  if (!Number.isSafeInteger(postsPerAccount) || postsPerAccount < 1) {
    errors.push('Số bài / tài khoản: phải từ 1 trở lên.')
  }
  if (delayMax < delayMin) errors.push('Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  return errors
}
