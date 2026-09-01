import {
  ACTION_REGISTRY,
  type ActionConfig,
  type ActionConfigFieldDefinition,
  type ActionConfigSchema,
  type ActionDefinition
} from './actionRegistry'

export interface InteractionAtomicFieldUiMeta {
  section: string
  multiline?: boolean
  rows?: number
  visibleWhen?: { key: string; equals: string | number | boolean }
}

const REACTIONS: readonly ActionConfigFieldDefinition[] = [
  { key: 'reactionLike', label: 'Like', kind: 'boolean', defaultValue: true },
  { key: 'reactionLove', label: 'Love', kind: 'boolean', defaultValue: false },
  { key: 'reactionCare', label: 'Care', kind: 'boolean', defaultValue: false },
  { key: 'reactionHaha', label: 'Haha', kind: 'boolean', defaultValue: false },
  { key: 'reactionWow', label: 'Wow', kind: 'boolean', defaultValue: false },
  { key: 'reactionSad', label: 'Sad', kind: 'boolean', defaultValue: false },
  { key: 'reactionAngry', label: 'Angry', kind: 'boolean', defaultValue: false }
]

const PACING: readonly ActionConfigFieldDefinition[] = [
  { key: 'itemDelayMinSeconds', label: 'Delay từ', kind: 'number', defaultValue: 2, min: 0, max: 3600, help: 'giây' },
  { key: 'itemDelayMaxSeconds', label: 'Delay đến', kind: 'number', defaultValue: 5, min: 0, max: 3600, help: 'giây' }
]

const REACT_COMMENT_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'targetUrl', label: 'Link bài viết / comment', kind: 'text', required: true, maxLength: 2000, placeholder: 'https://www.facebook.com/...' },
    { key: 'commentMatch', label: 'Nội dung comment cần tìm', kind: 'text', defaultValue: '', maxLength: 1000, placeholder: 'Để trống = comment phù hợp đầu tiên' },
    ...REACTIONS,
    ...PACING
  ]
}

const REPLY_COMMENT_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'targetUrl', label: 'Link bài viết / comment', kind: 'text', required: true, maxLength: 2000, placeholder: 'https://www.facebook.com/...' },
    { key: 'commentMatch', label: 'Nội dung comment cần trả lời', kind: 'text', defaultValue: '', maxLength: 1000, placeholder: 'Để trống = comment phù hợp đầu tiên' },
    { key: 'replyTemplates', label: 'Nội dung trả lời', kind: 'text', required: true, maxLength: 12000, placeholder: 'Mỗi dòng hoặc dấu | là một nội dung' },
    { key: 'replyImagePath', label: 'Ảnh trả lời', kind: 'text', defaultValue: '', maxLength: 2000 },
    ...PACING
  ]
}

const COMMENT_TAG_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'targetUrl', label: 'Link bài viết', kind: 'text', required: true, maxLength: 2000, placeholder: 'https://www.facebook.com/...' },
    { key: 'tagTargets', label: 'Tên / UID cần tag', kind: 'text', required: true, maxLength: 12000, placeholder: 'Mỗi dòng hoặc dấu | là một target' },
    { key: 'commentTemplates', label: 'Nội dung kèm theo', kind: 'text', defaultValue: '', maxLength: 12000, placeholder: 'Mỗi dòng hoặc dấu | là một nội dung; có thể để trống' },
    ...PACING
  ]
}

const TARGET_UID_INTERACTION_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'targets', label: 'Danh sách UID / URL', kind: 'text', required: true, maxLength: 50000, placeholder: 'Mỗi dòng hoặc dấu | là một UID / URL Facebook' },
    { key: 'targetsPerRun', label: 'Số target / lượt', kind: 'number', defaultValue: 20, min: 1, max: 1000 },
    { key: 'postsPerTarget', label: 'Số bài / target', kind: 'number', defaultValue: 1, min: 1, max: 20 },
    { key: 'randomTargets', label: 'Random target', kind: 'boolean', defaultValue: false },
    { key: 'reactionEnabled', label: 'Like / Reaction', kind: 'boolean', defaultValue: true },
    ...REACTIONS,
    { key: 'commentEnabled', label: 'Comment', kind: 'boolean', defaultValue: false },
    { key: 'commentTemplates', label: 'Nội dung comment', kind: 'text', defaultValue: '', maxLength: 12000, placeholder: 'Mỗi dòng hoặc dấu | là một nội dung' },
    { key: 'commentImagePath', label: 'Ảnh comment', kind: 'text', defaultValue: '', maxLength: 2000 },
    ...PACING
  ]
}

const UI: Record<string, Record<string, InteractionAtomicFieldUiMeta>> = {
  react_comment: {
    targetUrl: { section: 'Đích' },
    commentMatch: { section: 'Đích' },
    ...Object.fromEntries(REACTIONS.map((field) => [field.key, { section: 'Cảm xúc' }])),
    itemDelayMinSeconds: { section: 'Thiết lập' },
    itemDelayMaxSeconds: { section: 'Thiết lập' }
  },
  reply_comment: {
    targetUrl: { section: 'Đích' },
    commentMatch: { section: 'Đích' },
    replyTemplates: { section: 'Trả lời', multiline: true, rows: 5 },
    replyImagePath: { section: 'Trả lời' },
    itemDelayMinSeconds: { section: 'Thiết lập' },
    itemDelayMaxSeconds: { section: 'Thiết lập' }
  },
  comment_tag: {
    targetUrl: { section: 'Đích' },
    tagTargets: { section: 'Tag', multiline: true, rows: 5 },
    commentTemplates: { section: 'Tag', multiline: true, rows: 5 },
    itemDelayMinSeconds: { section: 'Thiết lập' },
    itemDelayMaxSeconds: { section: 'Thiết lập' }
  },
  target_uid_interaction: {
    targets: { section: 'Đối tượng', multiline: true, rows: 6 },
    targetsPerRun: { section: 'Đối tượng' },
    postsPerTarget: { section: 'Đối tượng' },
    randomTargets: { section: 'Đối tượng' },
    reactionEnabled: { section: 'Cảm xúc' },
    ...Object.fromEntries(REACTIONS.map((field) => [field.key, { section: 'Cảm xúc', visibleWhen: { key: 'reactionEnabled', equals: true } }])),
    commentEnabled: { section: 'Bình luận' },
    commentTemplates: { section: 'Bình luận', multiline: true, rows: 5, visibleWhen: { key: 'commentEnabled', equals: true } },
    commentImagePath: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
    itemDelayMinSeconds: { section: 'Thiết lập' },
    itemDelayMaxSeconds: { section: 'Thiết lập' }
  }
}

const OVERRIDES: Record<string, { description: string; schema: ActionConfigSchema; supportsMedia?: boolean }> = {
  react_comment: {
    description: 'Thả Like/cảm xúc vào comment phù hợp trên một bài viết hoặc permalink Facebook.',
    schema: REACT_COMMENT_SCHEMA
  },
  reply_comment: {
    description: 'Trả lời comment phù hợp bằng nội dung cấu hình, có thể kèm ảnh.',
    schema: REPLY_COMMENT_SCHEMA,
    supportsMedia: true
  },
  comment_tag: {
    description: 'Đăng comment có mention/tag target phù hợp và chọn suggestion của Facebook.',
    schema: COMMENT_TAG_SCHEMA
  },
  target_uid_interaction: {
    description: 'Tương tác bài viết theo danh sách UID/URL cụ thể với reaction và comment dùng chung.',
    schema: TARGET_UID_INTERACTION_SCHEMA,
    supportsMedia: true
  }
}

let applied = false

export function applyInteractionAtomicActionOverrides(): void {
  if (applied) return
  for (const [actionType, override] of Object.entries(OVERRIDES)) {
    const definition: ActionDefinition | undefined = ACTION_REGISTRY.find((item) => item.id === actionType)
    if (!definition) continue
    definition.description = override.description
    definition.runtimeStatus = 'ready'
    definition.configSchema = override.schema
    if (override.supportsMedia !== undefined) {
      definition.capabilities = { ...definition.capabilities, supportsMedia: override.supportsMedia }
    }
  }
  applied = true
}

export function getInteractionAtomicFieldUiMeta(actionType: string, fieldKey: string): InteractionAtomicFieldUiMeta | undefined {
  return UI[actionType]?.[fieldKey]
}

export function getInteractionAtomicValidationErrors(actionType: string, config: ActionConfig): string[] {
  if (!(actionType in OVERRIDES)) return []
  const text = (key: string) => typeof config[key] === 'string' ? String(config[key]).trim() : ''
  const number = (key: string) => typeof config[key] === 'number' ? Number(config[key]) : 0
  const bool = (key: string) => config[key] === true
  const errors: string[] = []

  if (number('itemDelayMinSeconds') > number('itemDelayMaxSeconds')) {
    errors.push('Delay: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.')
  }

  if (actionType === 'react_comment' && !REACTIONS.some((field) => bool(field.key))) {
    errors.push('Cảm xúc: cần chọn ít nhất một loại.')
  }
  if (actionType === 'reply_comment' && !text('replyTemplates')) {
    errors.push('Nội dung trả lời: không được để trống.')
  }
  if (actionType === 'comment_tag' && !text('tagTargets')) {
    errors.push('Tên / UID cần tag: không được để trống.')
  }
  if (actionType === 'target_uid_interaction') {
    if (!text('targets')) errors.push('Danh sách UID / URL: không được để trống.')
    if (!bool('reactionEnabled') && !bool('commentEnabled')) errors.push('Tương tác theo UID: cần bật Reaction hoặc Comment.')
    if (bool('reactionEnabled') && !REACTIONS.some((field) => bool(field.key))) errors.push('Cảm xúc: cần chọn ít nhất một loại.')
    if (bool('commentEnabled') && !text('commentTemplates')) errors.push('Nội dung comment: không được để trống khi bật Comment.')
  }

  return errors
}
