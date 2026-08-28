import {
  ACTION_REGISTRY,
  type ActionConfig,
  type ActionConfigFieldDefinition,
  type ActionConfigSchema,
  type ActionDefinition
} from './actionRegistry'

export interface K41FieldUiMeta {
  section: string
  multiline?: boolean
  rows?: number
  visibleWhen?: { key: string; equals: string | number | boolean }
}

const REACTION_FIELDS: readonly ActionConfigFieldDefinition[] = [
  { key: 'reactionLike', label: 'Like', kind: 'boolean', defaultValue: true },
  { key: 'reactionLove', label: 'Love', kind: 'boolean', defaultValue: false },
  { key: 'reactionCare', label: 'Care', kind: 'boolean', defaultValue: false },
  { key: 'reactionHaha', label: 'Haha', kind: 'boolean', defaultValue: false },
  { key: 'reactionWow', label: 'Wow', kind: 'boolean', defaultValue: false },
  { key: 'reactionSad', label: 'Sad', kind: 'boolean', defaultValue: false },
  { key: 'reactionAngry', label: 'Angry', kind: 'boolean', defaultValue: false }
]

const NEWSFEED_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'feedSource', label: 'Nguồn bảng tin', kind: 'select', defaultValue: 'home', options: [
      { value: 'home', label: 'Trang chủ' },
      { value: 'feed', label: 'Bảng feed' },
      { value: 'friends', label: 'Bảng feed bạn bè' },
      { value: 'pages', label: 'Bảng feed Page' },
      { value: 'groups', label: 'Bảng feed nhóm' },
      { value: 'group_newsfeed', label: 'Newsfeed nhóm' }
    ] },
    { key: 'durationMinMinutes', label: 'Xem từ', kind: 'number', defaultValue: 5, min: 1, max: 180, help: 'phút' },
    { key: 'durationMaxMinutes', label: 'Xem đến', kind: 'number', defaultValue: 5, min: 1, max: 180, help: 'phút' },
    { key: 'keywordFilterEnabled', label: 'Chỉ tương tác bài chứa từ khóa', kind: 'boolean', defaultValue: false },
    { key: 'keywords', label: 'Danh sách từ khóa', kind: 'text', defaultValue: '', maxLength: 6000, placeholder: 'Mỗi dòng một từ khóa' },
    { key: 'aiContentCheckEnabled', label: 'Kiểm tra nội dung bằng AI adapter', kind: 'boolean', defaultValue: false, help: 'Runtime phải cung cấp classifier; không lưu API key trong action.' },
    { key: 'aiPrompt', label: 'Yêu cầu kiểm tra', kind: 'text', defaultValue: 'Bài viết này có phù hợp để tương tác không?', maxLength: 3000 },
    { key: 'skipImageCheck', label: 'Không kiểm tra ảnh', kind: 'boolean', defaultValue: true },
    { key: 'likeEnabled', label: 'Like / cảm xúc', kind: 'boolean', defaultValue: true },
    { key: 'likeMin', label: 'Like từ', kind: 'number', defaultValue: 1, min: 0, max: 500 },
    { key: 'likeMax', label: 'Like đến', kind: 'number', defaultValue: 2, min: 0, max: 500 },
    ...REACTION_FIELDS,
    { key: 'commentEnabled', label: 'Bình luận', kind: 'boolean', defaultValue: false },
    { key: 'commentMin', label: 'Comment từ', kind: 'number', defaultValue: 1, min: 0, max: 200 },
    { key: 'commentMax', label: 'Comment đến', kind: 'number', defaultValue: 5, min: 0, max: 200 },
    { key: 'usePostTextAsComment', label: 'Lấy nội dung bài viết làm comment', kind: 'boolean', defaultValue: false },
    { key: 'commentTemplates', label: 'Nội dung comment', kind: 'text', defaultValue: '', maxLength: 12000, placeholder: 'Mỗi dòng một nội dung comment' },
    { key: 'commentImagePath', label: 'Ảnh comment', kind: 'text', defaultValue: '', maxLength: 2000, placeholder: 'Đường dẫn ảnh (tùy chọn)' },
    { key: 'shareEnabled', label: 'Chia sẻ', kind: 'boolean', defaultValue: false },
    { key: 'shareMin', label: 'Share từ', kind: 'number', defaultValue: 1, min: 0, max: 100 },
    { key: 'shareMax', label: 'Share đến', kind: 'number', defaultValue: 5, min: 0, max: 100 }
  ]
}

const STORY_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'durationMinMinutes', label: 'Xem từ', kind: 'number', defaultValue: 5, min: 1, max: 180, help: 'phút' },
    { key: 'durationMaxMinutes', label: 'Xem đến', kind: 'number', defaultValue: 5, min: 1, max: 180, help: 'phút' },
    { key: 'likeEnabled', label: 'Like / cảm xúc', kind: 'boolean', defaultValue: true },
    { key: 'likeMin', label: 'Like từ', kind: 'number', defaultValue: 5, min: 0, max: 500 },
    { key: 'likeMax', label: 'Like đến', kind: 'number', defaultValue: 10, min: 0, max: 500 },
    ...REACTION_FIELDS,
    { key: 'commentEnabled', label: 'Bình luận', kind: 'boolean', defaultValue: false },
    { key: 'commentMin', label: 'Comment từ', kind: 'number', defaultValue: 1, min: 0, max: 200 },
    { key: 'commentMax', label: 'Comment đến', kind: 'number', defaultValue: 5, min: 0, max: 200 },
    { key: 'commentTemplates', label: 'Nội dung comment', kind: 'text', defaultValue: '', maxLength: 12000, placeholder: 'Mỗi dòng một nội dung comment' },
    { key: 'randomUidEnabled', label: 'View story theo UID ngẫu nhiên', kind: 'boolean', defaultValue: false },
    { key: 'randomUidMin', label: 'Số UID từ', kind: 'number', defaultValue: 1, min: 1, max: 500 },
    { key: 'randomUidMax', label: 'Số UID đến', kind: 'number', defaultValue: 5, min: 1, max: 500 },
    { key: 'storyUids', label: 'Danh sách UID', kind: 'text', defaultValue: '', maxLength: 20000, placeholder: 'Mỗi dòng một UID' }
  ]
}

const REEL_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'durationMinMinutes', label: 'Xem từ', kind: 'number', defaultValue: 5, min: 1, max: 180, help: 'phút' },
    { key: 'durationMaxMinutes', label: 'Xem đến', kind: 'number', defaultValue: 5, min: 1, max: 180, help: 'phút' },
    { key: 'likeEnabled', label: 'Like / cảm xúc', kind: 'boolean', defaultValue: true },
    { key: 'likeMin', label: 'Like từ', kind: 'number', defaultValue: 5, min: 0, max: 500 },
    { key: 'likeMax', label: 'Like đến', kind: 'number', defaultValue: 10, min: 0, max: 500 },
    ...REACTION_FIELDS,
    { key: 'commentEnabled', label: 'Bình luận', kind: 'boolean', defaultValue: false },
    { key: 'commentMin', label: 'Comment từ', kind: 'number', defaultValue: 1, min: 0, max: 200 },
    { key: 'commentMax', label: 'Comment đến', kind: 'number', defaultValue: 5, min: 0, max: 200 },
    { key: 'commentTemplates', label: 'Nội dung comment', kind: 'text', defaultValue: '', maxLength: 12000, placeholder: 'Mỗi dòng một nội dung comment' },
    { key: 'commentImagePath', label: 'Ảnh comment', kind: 'text', defaultValue: '', maxLength: 2000, placeholder: 'Đường dẫn ảnh (tùy chọn)' },
    { key: 'shareToWall', label: 'Chia sẻ reel lên tường', kind: 'boolean', defaultValue: false },
    { key: 'shareToGroup', label: 'Chia sẻ reel lên nhóm', kind: 'boolean', defaultValue: false },
    { key: 'shareGroupMin', label: 'Số nhóm từ', kind: 'number', defaultValue: 1, min: 1, max: 100 },
    { key: 'shareGroupMax', label: 'Số nhóm đến', kind: 'number', defaultValue: 5, min: 1, max: 100 },
    { key: 'shareMessage', label: 'Nội dung chia sẻ', kind: 'text', defaultValue: '', maxLength: 12000 },
    { key: 'groupWhitelist', label: 'Whitelist Group UID', kind: 'text', defaultValue: '', maxLength: 20000, placeholder: 'Mỗi dòng một Group UID' }
  ]
}

const COMMON_REACTION_UI: Record<string, K41FieldUiMeta> = Object.fromEntries(
  REACTION_FIELDS.map((field) => [field.key, { section: 'Like & cảm xúc', visibleWhen: { key: 'likeEnabled', equals: true } }])
)

export const K41_ACTION_FIELD_UI: Record<string, Record<string, K41FieldUiMeta>> = {
  view_newsfeed: {
    feedSource: { section: 'Nguồn bảng tin' },
    durationMinMinutes: { section: 'Nguồn bảng tin' },
    durationMaxMinutes: { section: 'Nguồn bảng tin' },
    keywordFilterEnabled: { section: 'Lọc nội dung' },
    keywords: { section: 'Lọc nội dung', multiline: true, rows: 3, visibleWhen: { key: 'keywordFilterEnabled', equals: true } },
    aiContentCheckEnabled: { section: 'Lọc nội dung' },
    aiPrompt: { section: 'Lọc nội dung', multiline: true, rows: 3, visibleWhen: { key: 'aiContentCheckEnabled', equals: true } },
    skipImageCheck: { section: 'Lọc nội dung', visibleWhen: { key: 'aiContentCheckEnabled', equals: true } },
    likeEnabled: { section: 'Like & cảm xúc' },
    likeMin: { section: 'Like & cảm xúc', visibleWhen: { key: 'likeEnabled', equals: true } },
    likeMax: { section: 'Like & cảm xúc', visibleWhen: { key: 'likeEnabled', equals: true } },
    ...COMMON_REACTION_UI,
    commentEnabled: { section: 'Bình luận' },
    commentMin: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
    commentMax: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
    usePostTextAsComment: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
    commentTemplates: { section: 'Bình luận', multiline: true, rows: 4, visibleWhen: { key: 'commentEnabled', equals: true } },
    commentImagePath: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
    shareEnabled: { section: 'Chia sẻ' },
    shareMin: { section: 'Chia sẻ', visibleWhen: { key: 'shareEnabled', equals: true } },
    shareMax: { section: 'Chia sẻ', visibleWhen: { key: 'shareEnabled', equals: true } }
  },
  view_story: {
    durationMinMinutes: { section: 'Thời gian' },
    durationMaxMinutes: { section: 'Thời gian' },
    likeEnabled: { section: 'Like & cảm xúc' },
    likeMin: { section: 'Like & cảm xúc', visibleWhen: { key: 'likeEnabled', equals: true } },
    likeMax: { section: 'Like & cảm xúc', visibleWhen: { key: 'likeEnabled', equals: true } },
    ...COMMON_REACTION_UI,
    commentEnabled: { section: 'Bình luận' },
    commentMin: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
    commentMax: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
    commentTemplates: { section: 'Bình luận', multiline: true, rows: 4, visibleWhen: { key: 'commentEnabled', equals: true } },
    randomUidEnabled: { section: 'Story theo UID' },
    randomUidMin: { section: 'Story theo UID', visibleWhen: { key: 'randomUidEnabled', equals: true } },
    randomUidMax: { section: 'Story theo UID', visibleWhen: { key: 'randomUidEnabled', equals: true } },
    storyUids: { section: 'Story theo UID', multiline: true, rows: 4, visibleWhen: { key: 'randomUidEnabled', equals: true } }
  },
  view_reel: {
    durationMinMinutes: { section: 'Thời gian' },
    durationMaxMinutes: { section: 'Thời gian' },
    likeEnabled: { section: 'Like & cảm xúc' },
    likeMin: { section: 'Like & cảm xúc', visibleWhen: { key: 'likeEnabled', equals: true } },
    likeMax: { section: 'Like & cảm xúc', visibleWhen: { key: 'likeEnabled', equals: true } },
    ...COMMON_REACTION_UI,
    commentEnabled: { section: 'Bình luận' },
    commentMin: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
    commentMax: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
    commentTemplates: { section: 'Bình luận', multiline: true, rows: 4, visibleWhen: { key: 'commentEnabled', equals: true } },
    commentImagePath: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
    shareToWall: { section: 'Chia sẻ' },
    shareToGroup: { section: 'Chia sẻ' },
    shareGroupMin: { section: 'Chia sẻ', visibleWhen: { key: 'shareToGroup', equals: true } },
    shareGroupMax: { section: 'Chia sẻ', visibleWhen: { key: 'shareToGroup', equals: true } },
    shareMessage: { section: 'Chia sẻ', multiline: true, rows: 3, visibleWhen: { key: 'shareToGroup', equals: true } },
    groupWhitelist: { section: 'Chia sẻ', multiline: true, rows: 4, visibleWhen: { key: 'shareToGroup', equals: true } }
  }
}

const OVERRIDES: Record<string, { description: string; schema: ActionConfigSchema; supportsMedia?: boolean }> = {
  view_newsfeed: {
    description: 'Xem và tương tác bảng tin theo nguồn, từ khóa, cảm xúc, comment và share.',
    schema: NEWSFEED_SCHEMA,
    supportsMedia: true
  },
  view_story: {
    description: 'Xem story, cảm xúc, bình luận và có thể chọn story theo UID.',
    schema: STORY_SCHEMA
  },
  view_reel: {
    description: 'Xem reel, cảm xúc, bình luận và chia sẻ theo cấu hình.',
    schema: REEL_SCHEMA,
    supportsMedia: true
  }
}

let applied = false

export function applyK41ActionOverrides(): void {
  if (applied) return
  for (const [actionType, override] of Object.entries(OVERRIDES)) {
    const definition: ActionDefinition | undefined = ACTION_REGISTRY.find((item) => item.id === actionType)
    if (!definition) continue
    definition.description = override.description
    definition.runtimeStatus = 'ready'
    definition.configSchema = override.schema
    if (override.supportsMedia !== undefined) definition.capabilities.supportsMedia = override.supportsMedia
  }
  applied = true
}

export function getK41FieldUiMeta(actionType: string, fieldKey: string): K41FieldUiMeta | undefined {
  return K41_ACTION_FIELD_UI[actionType]?.[fieldKey]
}

export function getK41ValidationErrors(actionType: string, config: ActionConfig): string[] {
  const number = (key: string) => typeof config[key] === 'number' ? config[key] as number : 0
  const text = (key: string) => typeof config[key] === 'string' ? config[key] as string : ''
  const enabled = (key: string) => config[key] === true
  const errors: string[] = []
  const range = (minKey: string, maxKey: string, label: string) => {
    if (number(minKey) > number(maxKey)) errors.push(`${label}: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.`)
  }

  range('durationMinMinutes', 'durationMaxMinutes', 'Thời gian xem')
  range('likeMin', 'likeMax', 'Like')
  range('commentMin', 'commentMax', 'Comment')
  if (actionType === 'view_newsfeed') {
    range('shareMin', 'shareMax', 'Share')
    if (enabled('keywordFilterEnabled') && !text('keywords').trim()) errors.push('Danh sách từ khóa: cần nhập ít nhất một từ khóa.')
    if (enabled('aiContentCheckEnabled') && !text('aiPrompt').trim()) errors.push('Yêu cầu kiểm tra AI: không được để trống.')
  }
  if (actionType === 'view_story') {
    range('randomUidMin', 'randomUidMax', 'Số UID')
    if (enabled('randomUidEnabled') && !text('storyUids').trim()) errors.push('Danh sách UID: cần nhập ít nhất một UID.')
  }
  if (actionType === 'view_reel') {
    range('shareGroupMin', 'shareGroupMax', 'Số nhóm')
    if (enabled('shareToGroup') && !text('groupWhitelist').trim()) errors.push('Whitelist Group UID: cần nhập ít nhất một Group UID.')
  }
  return errors
}
