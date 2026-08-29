import {
  ACTION_REGISTRY,
  type ActionConfig,
  type ActionConfigFieldDefinition,
  type ActionConfigSchema,
  type ActionDefinition
} from './actionRegistry'

export interface K433FieldUiMeta {
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
  { key: 'itemDelayMinSeconds', label: 'Delay từ', kind: 'number', defaultValue: 60, min: 0, max: 3600, help: 'giây' },
  { key: 'itemDelayMaxSeconds', label: 'Delay đến', kind: 'number', defaultValue: 240, min: 0, max: 3600, help: 'giây' },
  { key: 'pauseAfterCount', label: 'Sau khi chạy', kind: 'number', defaultValue: 30, min: 0, max: 10000, help: 'lượt' },
  { key: 'pauseMinutes', label: 'Tạm dừng', kind: 'number', defaultValue: 15, min: 0, max: 1440, help: 'phút' }
]

const GROUP_INTERACTION_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    {
      key: 'sourceMode',
      label: 'Nguồn nhóm',
      kind: 'select',
      defaultValue: 'groups_feed',
      options: [
        { value: 'groups_feed', label: 'Newsfeed nhóm' },
        { value: 'joined_groups', label: 'Nhóm đã tham gia' }
      ]
    },
    { key: 'joinedGroupMin', label: 'Số nhóm từ', kind: 'number', defaultValue: 5, min: 1, max: 500 },
    { key: 'joinedGroupMax', label: 'Số nhóm đến', kind: 'number', defaultValue: 10, min: 1, max: 500 },
    {
      key: 'groupWhitelist',
      label: 'Whitelist Group UID / URL',
      kind: 'text',
      defaultValue: '',
      maxLength: 50000,
      placeholder: 'Để trống = mọi nhóm; mỗi dòng một Group UID hoặc URL Facebook'
    },
    { key: 'viewEnabled', label: 'Xem bài viết', kind: 'boolean', defaultValue: true },
    { key: 'viewMinSeconds', label: 'Thời gian xem từ', kind: 'number', defaultValue: 1, min: 0, max: 600 },
    { key: 'viewMaxSeconds', label: 'Thời gian xem đến', kind: 'number', defaultValue: 5, min: 0, max: 600 },
    { key: 'sortRecent', label: 'Sắp xếp bài viết gần đây', kind: 'boolean', defaultValue: false },
    { key: 'reactionEnabled', label: 'Thả cảm xúc bài viết', kind: 'boolean', defaultValue: true },
    { key: 'reactionMin', label: 'Cảm xúc từ', kind: 'number', defaultValue: 1, min: 0, max: 500 },
    { key: 'reactionMax', label: 'Cảm xúc đến', kind: 'number', defaultValue: 2, min: 0, max: 500 },
    ...REACTIONS,
    { key: 'commentEnabled', label: 'Comment vào bài viết', kind: 'boolean', defaultValue: false },
    { key: 'commentMin', label: 'Comment từ', kind: 'number', defaultValue: 1, min: 0, max: 500 },
    { key: 'commentMax', label: 'Comment đến', kind: 'number', defaultValue: 2, min: 0, max: 500 },
    { key: 'deleteCommentAfter', label: 'Xóa comment sau khi comment', kind: 'boolean', defaultValue: false },
    { key: 'usePostTextAsComment', label: 'Lấy nội dung bài viết làm comment', kind: 'boolean', defaultValue: false },
    {
      key: 'commentTemplates',
      label: 'Nội dung comment',
      kind: 'text',
      defaultValue: '',
      maxLength: 12000,
      placeholder: 'Mỗi dòng hoặc dấu | là một nội dung comment'
    },
    { key: 'commentImagePath', label: 'Ảnh comment', kind: 'text', defaultValue: '', maxLength: 2000, placeholder: 'Đường dẫn file ảnh (nếu dùng)' },
    { key: 'shareWallEnabled', label: 'Chia sẻ bài viết lên tường', kind: 'boolean', defaultValue: false },
    { key: 'shareWallMin', label: 'Chia sẻ tường từ', kind: 'number', defaultValue: 1, min: 0, max: 200 },
    { key: 'shareWallMax', label: 'Chia sẻ tường đến', kind: 'number', defaultValue: 1, min: 0, max: 200 },
    { key: 'shareGroupEnabled', label: 'Chia sẻ bài viết lên nhóm', kind: 'boolean', defaultValue: false },
    { key: 'shareGroupMin', label: 'Chia sẻ nhóm từ', kind: 'number', defaultValue: 1, min: 0, max: 200 },
    { key: 'shareGroupMax', label: 'Chia sẻ nhóm đến', kind: 'number', defaultValue: 1, min: 0, max: 200 },
    {
      key: 'shareGroupWhitelist',
      label: 'Whitelist nhóm đích khi chia sẻ',
      kind: 'text',
      defaultValue: '',
      maxLength: 50000,
      placeholder: 'Mỗi dòng một Group UID hoặc URL Facebook'
    },
    {
      key: 'restrictedGroupPolicy',
      label: 'Khi nhóm hạn chế thao tác',
      kind: 'select',
      defaultValue: 'skip',
      options: [
        { value: 'skip', label: 'Bỏ qua nhóm' },
        { value: 'leave', label: 'Rời nhóm nếu đang ở trang nhóm' }
      ],
      help: 'Không cố vượt hạn chế Facebook. Ở feed tổng, nhóm hạn chế được classify và bỏ qua.'
    },
    ...PACING
  ]
}

const UI: Record<string, K433FieldUiMeta> = {
  sourceMode: { section: 'Nguồn nhóm' },
  joinedGroupMin: { section: 'Nguồn nhóm', visibleWhen: { key: 'sourceMode', equals: 'joined_groups' } },
  joinedGroupMax: { section: 'Nguồn nhóm', visibleWhen: { key: 'sourceMode', equals: 'joined_groups' } },
  groupWhitelist: { section: 'Nguồn nhóm', multiline: true, rows: 4 },
  viewEnabled: { section: 'Xem bài' },
  viewMinSeconds: { section: 'Xem bài', visibleWhen: { key: 'viewEnabled', equals: true } },
  viewMaxSeconds: { section: 'Xem bài', visibleWhen: { key: 'viewEnabled', equals: true } },
  sortRecent: { section: 'Xem bài' },
  reactionEnabled: { section: 'Cảm xúc' },
  reactionMin: { section: 'Cảm xúc', visibleWhen: { key: 'reactionEnabled', equals: true } },
  reactionMax: { section: 'Cảm xúc', visibleWhen: { key: 'reactionEnabled', equals: true } },
  reactionLike: { section: 'Cảm xúc', visibleWhen: { key: 'reactionEnabled', equals: true } },
  reactionLove: { section: 'Cảm xúc', visibleWhen: { key: 'reactionEnabled', equals: true } },
  reactionCare: { section: 'Cảm xúc', visibleWhen: { key: 'reactionEnabled', equals: true } },
  reactionHaha: { section: 'Cảm xúc', visibleWhen: { key: 'reactionEnabled', equals: true } },
  reactionWow: { section: 'Cảm xúc', visibleWhen: { key: 'reactionEnabled', equals: true } },
  reactionSad: { section: 'Cảm xúc', visibleWhen: { key: 'reactionEnabled', equals: true } },
  reactionAngry: { section: 'Cảm xúc', visibleWhen: { key: 'reactionEnabled', equals: true } },
  commentEnabled: { section: 'Bình luận' },
  commentMin: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
  commentMax: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
  deleteCommentAfter: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
  usePostTextAsComment: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
  commentTemplates: { section: 'Bình luận', multiline: true, rows: 4, visibleWhen: { key: 'commentEnabled', equals: true } },
  commentImagePath: { section: 'Bình luận', visibleWhen: { key: 'commentEnabled', equals: true } },
  shareWallEnabled: { section: 'Chia sẻ' },
  shareWallMin: { section: 'Chia sẻ', visibleWhen: { key: 'shareWallEnabled', equals: true } },
  shareWallMax: { section: 'Chia sẻ', visibleWhen: { key: 'shareWallEnabled', equals: true } },
  shareGroupEnabled: { section: 'Chia sẻ' },
  shareGroupMin: { section: 'Chia sẻ', visibleWhen: { key: 'shareGroupEnabled', equals: true } },
  shareGroupMax: { section: 'Chia sẻ', visibleWhen: { key: 'shareGroupEnabled', equals: true } },
  shareGroupWhitelist: { section: 'Chia sẻ', multiline: true, rows: 4, visibleWhen: { key: 'shareGroupEnabled', equals: true } },
  restrictedGroupPolicy: { section: 'Nhóm hạn chế' },
  itemDelayMinSeconds: { section: 'Thiết lập' },
  itemDelayMaxSeconds: { section: 'Thiết lập' },
  pauseAfterCount: { section: 'Thiết lập' },
  pauseMinutes: { section: 'Thiết lập' }
}

let applied = false

export function applyK433GroupInteractionActionOverrides(): void {
  if (applied) return
  const definition: ActionDefinition | undefined = ACTION_REGISTRY.find((item) => item.id === 'group_interaction')
  if (definition) {
    definition.description = 'Duyệt feed nhóm hoặc nhóm đã tham gia; xem bài, thả cảm xúc, comment, chia sẻ và xử lý nhóm hạn chế theo cấu hình.'
    definition.runtimeStatus = 'ready'
    definition.capabilities = { ...definition.capabilities, supportsMedia: true }
    definition.configSchema = GROUP_INTERACTION_SCHEMA
  }
  applied = true
}

export function getK433FieldUiMeta(actionType: string, fieldKey: string): K433FieldUiMeta | undefined {
  if (actionType !== 'group_interaction') return undefined
  return UI[fieldKey]
}

export function getK433ValidationErrors(actionType: string, config: ActionConfig): string[] {
  if (actionType !== 'group_interaction') return []
  const number = (key: string) => typeof config[key] === 'number' ? config[key] as number : 0
  const text = (key: string) => typeof config[key] === 'string' ? config[key] as string : ''
  const bool = (key: string) => config[key] === true
  const errors: string[] = []
  const range = (min: string, max: string, label: string) => {
    if (number(min) > number(max)) errors.push(`${label}: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.`)
  }

  range('joinedGroupMin', 'joinedGroupMax', 'Số nhóm')
  range('viewMinSeconds', 'viewMaxSeconds', 'Thời gian xem')
  range('reactionMin', 'reactionMax', 'Số cảm xúc')
  range('commentMin', 'commentMax', 'Số comment')
  range('shareWallMin', 'shareWallMax', 'Số chia sẻ lên tường')
  range('shareGroupMin', 'shareGroupMax', 'Số chia sẻ lên nhóm')
  range('itemDelayMinSeconds', 'itemDelayMaxSeconds', 'Delay')

  if (bool('reactionEnabled') && !REACTIONS.some((field) => bool(field.key))) {
    errors.push('Loại cảm xúc: cần chọn ít nhất một cảm xúc.')
  }
  if (bool('commentEnabled') && !bool('usePostTextAsComment') && !text('commentTemplates').trim()) {
    errors.push('Nội dung comment: cần nhập nội dung hoặc bật lấy nội dung từ bài viết.')
  }
  if (bool('shareGroupEnabled') && !text('shareGroupWhitelist').trim()) {
    errors.push('Whitelist nhóm đích khi chia sẻ: không được để trống khi bật chia sẻ lên nhóm.')
  }
  if (!bool('viewEnabled') && !bool('reactionEnabled') && !bool('commentEnabled') && !bool('shareWallEnabled') && !bool('shareGroupEnabled')) {
    errors.push('Tương tác nhóm: cần bật ít nhất một thao tác.')
  }

  return errors
}
