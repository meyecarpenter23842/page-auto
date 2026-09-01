import {
  SCENARIO_ACTION_CATEGORIES,
  scenarioCategoryLabels,
  type ScenarioActionCategory
} from './scenarios'

export const ACTION_RESULT_STATUSES = ['success', 'skipped', 'needs_attention', 'failed', 'stopped'] as const
export type ActionResultStatus = typeof ACTION_RESULT_STATUSES[number]
export type ActionActor = 'profile' | 'page'
export type ActionRuntimeStatus = 'placeholder' | 'ready'
export type ActionConfigValue = string | number | boolean
export type ActionConfig = Record<string, ActionConfigValue>

export interface ActionResult {
  status: ActionResultStatus
  code?: string
  message?: string
  data?: Record<string, unknown>
}

export interface ActionConfigOption {
  value: string
  label: string
}

export interface ActionConfigFieldDefinition {
  key: string
  label: string
  kind: 'text' | 'number' | 'boolean' | 'select'
  required?: boolean
  defaultValue?: ActionConfigValue
  placeholder?: string
  help?: string
  min?: number
  max?: number
  maxLength?: number
  options?: readonly ActionConfigOption[]
}

export interface ActionConfigSchema {
  version: 1
  fields: readonly ActionConfigFieldDefinition[]
}

export interface ActionCapabilities {
  actors: readonly ActionActor[]
  requiresNavigation: boolean
  supportsMedia?: boolean
}

export interface ActionDefinition {
  id: string
  category: ScenarioActionCategory
  label: string
  description: string
  runtimeStatus: ActionRuntimeStatus
  capabilities: ActionCapabilities
  configSchema: ActionConfigSchema
}

export interface ActionCategoryDefinition {
  id: ScenarioActionCategory
  label: string
}

export type ActionConfigValidation =
  | { valid: true; value: ActionConfig; errors: [] }
  | { valid: false; value: ActionConfig; errors: string[] }

const BOTH_ACTORS = ['profile', 'page'] as const
const PROFILE_ONLY = ['profile'] as const
const PAGE_ONLY = ['page'] as const
const EMPTY_SCHEMA: ActionConfigSchema = { version: 1, fields: [] }
const VIEW_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [{
    key: 'durationSeconds',
    label: 'Thời gian xem',
    kind: 'number',
    defaultValue: 15,
    min: 1,
    max: 600,
    help: 'Khung cấu hình dùng cho action xem; executor sẽ nối ở K3.'
  }]
}
const READ_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [{ key: 'durationSeconds', label: 'Thời gian đọc', kind: 'number', defaultValue: 10, min: 1, max: 600 }]
}
const SEARCH_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [{ key: 'keyword', label: 'Từ khóa', kind: 'text', required: true, maxLength: 300, placeholder: 'Nhập từ khóa...' }]
}
const VIEW_LINK_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [{ key: 'url', label: 'Đường dẫn', kind: 'text', required: true, maxLength: 2000, placeholder: 'https://...' }]
}

function action(
  id: string,
  category: ScenarioActionCategory,
  label: string,
  description: string,
  options: {
    actors?: readonly ActionActor[]
    configSchema?: ActionConfigSchema
    requiresNavigation?: boolean
    supportsMedia?: boolean
  } = {}
): ActionDefinition {
  return {
    id,
    category,
    label,
    description,
    runtimeStatus: 'placeholder',
    capabilities: {
      actors: options.actors ?? BOTH_ACTORS,
      requiresNavigation: options.requiresNavigation ?? true,
      ...(options.supportsMedia === undefined ? {} : { supportsMedia: options.supportsMedia })
    },
    configSchema: options.configSchema ?? EMPTY_SCHEMA
  }
}

export const ACTION_CATEGORIES: readonly ActionCategoryDefinition[] = SCENARIO_ACTION_CATEGORIES.map((id) => ({
  id,
  label: scenarioCategoryLabels[id]
}))

export const ACTION_REGISTRY: readonly ActionDefinition[] = [
  action('view_newsfeed', 'interaction', 'View newsfeed', 'Xem bảng tin Facebook.', { configSchema: VIEW_SCHEMA }),
  action('view_watch', 'interaction', 'View watch', 'Xem nội dung Watch.', { configSchema: VIEW_SCHEMA }),
  action('view_marketplace', 'interaction', 'View marketplace', 'Xem Marketplace.', { configSchema: VIEW_SCHEMA }),
  action('view_story', 'interaction', 'View story', 'Xem story.', { configSchema: VIEW_SCHEMA }),
  action('view_reel', 'interaction', 'View reel', 'Xem reel.', { configSchema: VIEW_SCHEMA }),
  action('read_notifications', 'interaction', 'Đọc thông báo', 'Mở và đọc khu vực thông báo.', { configSchema: READ_SCHEMA }),
  action('read_messages', 'interaction', 'Đọc tin nhắn', 'Mở và đọc khu vực tin nhắn.', { configSchema: READ_SCHEMA }),
  action('facebook_search', 'interaction', 'Tìm kiếm', 'Tìm kiếm nội dung theo từ khóa.', { configSchema: SEARCH_SCHEMA }),
  action('like_comment_seeding', 'interaction', 'Like Comment Seeding', 'Tương tác like/comment theo cấu hình seeding.'),
  action('keyword_interaction', 'interaction', 'Tương tác theo từ khóa', 'Tìm và tương tác theo từ khóa.', { configSchema: SEARCH_SCHEMA }),
  action('react_comment', 'interaction', 'Thả cảm xúc comment', 'Thả Like/cảm xúc vào comment phù hợp.'),
  action('reply_comment', 'interaction', 'Trả lời comment', 'Trả lời một comment phù hợp.', { supportsMedia: true }),
  action('comment_tag', 'interaction', 'Comment tag', 'Đăng comment có tag/mention target phù hợp.'),
  action('target_uid_interaction', 'interaction', 'Tương tác theo UID', 'Tương tác theo danh sách UID/URL cụ thể.', { supportsMedia: true }),

  action('friend_interaction', 'friends', 'Tương tác bạn bè', 'Tương tác với danh sách bạn bè.', { actors: PROFILE_ONLY }),
  action('poke_friend', 'friends', 'Chọc bạn bè', 'Chọc bạn bè.', { actors: PROFILE_ONLY }),
  action('send_friend_request', 'friends', 'Kết bạn', 'Gửi lời mời kết bạn.', { actors: PROFILE_ONLY }),
  action('accept_friend_request', 'friends', 'Chấp nhận kết bạn', 'Chấp nhận lời mời kết bạn.', { actors: PROFILE_ONLY }),
  action('cancel_sent_friend_requests', 'friends', 'Hủy yêu cầu bạn bè đã gửi', 'Hủy các lời mời kết bạn đã gửi.', { actors: PROFILE_ONLY }),
  action('unfriend', 'friends', 'Hủy bạn bè', 'Hủy kết bạn.', { actors: PROFILE_ONLY }),
  action('friend_from_engagement', 'friends', 'Kết bạn người like comment', 'Kết bạn từ người đã like/comment.', { actors: PROFILE_ONLY }),

  action('join_group', 'groups', 'Tham gia nhóm', 'Tham gia nhóm Facebook.'),
  action('invite_friends_to_group', 'groups', 'Mời bạn bè vào nhóm', 'Mời bạn bè tham gia nhóm.', { actors: PROFILE_ONLY }),
  action('group_interaction', 'groups', 'Tương tác nhóm', 'Tương tác nội dung trong nhóm.'),
  action('leave_group', 'groups', 'Rời nhóm', 'Rời khỏi nhóm Facebook.'),
  action('group_post', 'groups', 'Đăng bài nhóm', 'Đăng bài vào nhóm. Đây là một action nhỏ thuộc nhóm Nhóm.', { supportsMedia: true }),

  action('marketplace_post', 'marketplace', 'Đăng Marketplace', 'Tạo bài đăng Marketplace.', { supportsMedia: true }),
  action('marketplace_edit', 'marketplace', 'Sửa Marketplace', 'Sửa bài đăng Marketplace.', { supportsMedia: true }),
  action('marketplace_message', 'marketplace', 'Gửi tin nhắn Marketplace', 'Gửi tin nhắn trong luồng Marketplace.'),
  action('marketplace_seeding', 'marketplace', 'Seeding Marketplace', 'Tương tác seeding trên Marketplace.'),

  action('post', 'publishing', 'Đăng bài', 'Đăng bài Facebook.', { supportsMedia: true }),
  action('copy_post', 'publishing', 'Copy bài viết', 'Sao chép nội dung bài viết theo cấu hình.', { supportsMedia: true }),
  action('post_story', 'publishing', 'Đăng story', 'Đăng story.', { supportsMedia: true }),
  action('copy_tiktok_douyin', 'publishing', 'Copy bài từ Tiktok/Douyin', 'Lấy nội dung từ Tiktok/Douyin để chuẩn bị đăng.', { supportsMedia: true }),
  action('copy_shopee', 'publishing', 'Copy bài từ Shopee', 'Lấy nội dung từ Shopee để chuẩn bị đăng.', { supportsMedia: true }),

  action('send_message', 'other', 'Gửi tin nhắn', 'Gửi tin nhắn Facebook.'),
  action('delete_post_comment', 'other', 'Xóa bài viết & comment', 'Xóa bài viết hoặc bình luận theo cấu hình.'),
  action('backup_photo', 'other', 'Backup photo', 'Sao lưu ảnh theo cấu hình.', { supportsMedia: true }),
  action('play_game', 'other', 'Chơi game', 'Mở luồng chơi game.', { actors: PROFILE_ONLY }),
  action('view_link', 'other', 'View Link', 'Mở và xem một đường dẫn.', { configSchema: VIEW_LINK_SCHEMA }),
  action('block_uid', 'other', 'Block Uid', 'Chặn UID theo cấu hình.'),
  action('spam_appeal', 'other', 'Kháng spam', 'Mở luồng kháng spam khi phù hợp.'),
  action('xlike_cross_interaction', 'other', 'XLike - Tương tác chéo', 'Tương tác chéo theo cấu hình XLike.'),
  action('switch_page', 'other', 'Switch Page', 'Chuyển sang Page UID của actor bằng Facebook Common Runtime.', { actors: PAGE_ONLY, requiresNavigation: false })
] as const

const ACTION_BY_ID = new Map(ACTION_REGISTRY.map((definition) => [definition.id, definition] as const))
const forbiddenConfigKey = /(password|cookie|2fa|token|secret|credential|passphrase|otp)/i

export function getActionDefinition(actionType: string): ActionDefinition | undefined {
  return ACTION_BY_ID.get(actionType)
}

export function getActionsByCategory(category: ScenarioActionCategory): ActionDefinition[] {
  return ACTION_REGISTRY.filter((definition) => definition.category === category)
}

export function createDefaultActionConfig(definition: ActionDefinition): ActionConfig {
  const config: ActionConfig = {}
  for (const field of definition.configSchema.fields) {
    if (field.defaultValue !== undefined) config[field.key] = field.defaultValue
  }
  return config
}

function assertNoForbiddenKeys(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenConfigKey.test(key)) errors.push(`${path}${key}: không được lưu secret trong config action.`)
    assertNoForbiddenKeys(child, `${path}${key}.`, errors)
  }
}

export function validateActionConfig(actionType: string, input: unknown): ActionConfigValidation {
  const definition = getActionDefinition(actionType)
  if (!definition) return { valid: false, value: {}, errors: [`Action “${actionType}” chưa có trong registry.`] }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, value: {}, errors: ['Config action phải là JSON object.'] }
  }

  const errors: string[] = []
  assertNoForbiddenKeys(input, '', errors)
  const source = input as Record<string, unknown>
  const allowed = new Set(definition.configSchema.fields.map((field) => field.key))
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) errors.push(`${key}: trường config không được hỗ trợ bởi action này.`)
  }

  const value = createDefaultActionConfig(definition)
  for (const field of definition.configSchema.fields) {
    const raw = source[field.key]
    if (raw === undefined || raw === null || raw === '') {
      if (field.required && field.defaultValue === undefined) errors.push(`${field.label}: không được để trống.`)
      continue
    }
    if (field.kind === 'text') {
      if (typeof raw !== 'string') errors.push(`${field.label}: phải là chuỗi.`)
      else if (field.maxLength !== undefined && raw.length > field.maxLength) errors.push(`${field.label}: dài tối đa ${field.maxLength} ký tự.`)
      else value[field.key] = raw
      continue
    }
    if (field.kind === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) errors.push(`${field.label}: phải là số.`)
      else if (field.min !== undefined && raw < field.min) errors.push(`${field.label}: tối thiểu ${field.min}.`)
      else if (field.max !== undefined && raw > field.max) errors.push(`${field.label}: tối đa ${field.max}.`)
      else value[field.key] = raw
      continue
    }
    if (field.kind === 'boolean') {
      if (typeof raw !== 'boolean') errors.push(`${field.label}: phải là bật/tắt.`)
      else value[field.key] = raw
      continue
    }
    if (field.kind === 'select') {
      if (typeof raw !== 'string' || !field.options?.some((option) => option.value === raw)) errors.push(`${field.label}: giá trị không hợp lệ.`)
      else value[field.key] = raw
    }
  }

  return errors.length ? { valid: false, value, errors } : { valid: true, value, errors: [] }
}
