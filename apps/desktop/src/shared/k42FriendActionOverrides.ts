import {
  ACTION_REGISTRY,
  type ActionConfig,
  type ActionConfigFieldDefinition,
  type ActionConfigSchema,
  type ActionDefinition
} from './actionRegistry'

export interface K42FieldUiMeta {
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

const FRIEND_INTERACTION_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'onlineLikeEnabled', label: 'Like bạn bè online', kind: 'boolean', defaultValue: true },
    { key: 'onlineLikeMin', label: 'Like online từ', kind: 'number', defaultValue: 5, min: 0, max: 500 },
    { key: 'onlineLikeMax', label: 'Like online đến', kind: 'number', defaultValue: 10, min: 0, max: 500 },
    { key: 'randomFriends', label: 'Tương tác random bạn bè', kind: 'boolean', defaultValue: false },
    ...REACTIONS,
    { key: 'commentEnabled', label: 'Comment vào bài bạn bè', kind: 'boolean', defaultValue: false },
    { key: 'commentMin', label: 'Comment từ', kind: 'number', defaultValue: 1, min: 0, max: 200 },
    { key: 'commentMax', label: 'Comment đến', kind: 'number', defaultValue: 5, min: 0, max: 200 },
    { key: 'usePostTextAsComment', label: 'Lấy nội dung bài viết làm comment', kind: 'boolean', defaultValue: false },
    { key: 'commentTemplates', label: 'Nội dung comment', kind: 'text', defaultValue: '', maxLength: 12000, placeholder: 'Mỗi dòng một nội dung comment' },
    { key: 'commentImagePath', label: 'Ảnh comment', kind: 'text', defaultValue: '', maxLength: 2000 },
    { key: 'avatarLikeEnabled', label: 'Like Avatar', kind: 'boolean', defaultValue: false },
    { key: 'avatarLikeMin', label: 'Avatar từ', kind: 'number', defaultValue: 5, min: 0, max: 500 },
    { key: 'avatarLikeMax', label: 'Avatar đến', kind: 'number', defaultValue: 10, min: 0, max: 500 },
    ...PACING
  ]
}

const POKE_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'pokeEnabled', label: 'Chọc bạn bè', kind: 'boolean', defaultValue: true },
    { key: 'pokeMin', label: 'Chọc từ', kind: 'number', defaultValue: 5, min: 0, max: 500 },
    { key: 'pokeMax', label: 'Chọc đến', kind: 'number', defaultValue: 5, min: 0, max: 500 },
    { key: 'pokeBackEnabled', label: 'Chọc lại', kind: 'boolean', defaultValue: false },
    { key: 'pokeBackMin', label: 'Chọc lại từ', kind: 'number', defaultValue: 5, min: 0, max: 500 },
    { key: 'pokeBackMax', label: 'Chọc lại đến', kind: 'number', defaultValue: 10, min: 0, max: 500 },
    ...PACING
  ]
}

const REQUEST_FILTERS: readonly ActionConfigFieldDefinition[] = [
  { key: 'mutualMin', label: 'Bạn chung từ', kind: 'number', defaultValue: 0, min: 0, max: 10000 },
  { key: 'mutualMax', label: 'Bạn chung đến', kind: 'number', defaultValue: 10000, min: 0, max: 10000 },
  { key: 'locale', label: 'Locale', kind: 'text', defaultValue: '', maxLength: 100, placeholder: 'vd: vi_VN' },
  { key: 'locationKeyword', label: 'Location chứa', kind: 'text', defaultValue: '', maxLength: 200 },
  { key: 'hometownKeyword', label: 'Hometown chứa', kind: 'text', defaultValue: '', maxLength: 200 },
  { key: 'requireAvatar', label: 'Yêu cầu có avatar', kind: 'boolean', defaultValue: false }
]

const SEND_FRIEND_REQUEST_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'sourceMode', label: 'Nguồn kết bạn', kind: 'select', defaultValue: 'suggestions', options: [
      { value: 'suggestions', label: 'Gợi ý của Facebook' },
      { value: 'uid_list', label: 'Theo danh sách UID' },
      { value: 'friend_of_friend', label: 'Theo bạn của bạn bè' },
      { value: 'keyword_search', label: 'Theo từ khóa / link tìm kiếm' }
    ] },
    { key: 'sourceValue', label: 'UID / từ khóa / link nguồn', kind: 'text', defaultValue: '', maxLength: 20000, placeholder: 'Mỗi dòng một UID hoặc nhập từ khóa/link' },
    { key: 'requestMin', label: 'Số yêu cầu từ', kind: 'number', defaultValue: 1, min: 1, max: 500 },
    { key: 'requestMax', label: 'Số yêu cầu đến', kind: 'number', defaultValue: 5, min: 1, max: 500 },
    ...REQUEST_FILTERS,
    ...PACING
  ]
}

const ACCEPT_FRIEND_REQUEST_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'confirmMin', label: 'Số yêu cầu xác nhận từ', kind: 'number', defaultValue: 1, min: 1, max: 500 },
    { key: 'confirmMax', label: 'Số yêu cầu xác nhận đến', kind: 'number', defaultValue: 5, min: 1, max: 500 },
    { key: 'deleteUnmatched', label: 'Xóa yêu cầu không thỏa điều kiện', kind: 'boolean', defaultValue: false },
    ...REQUEST_FILTERS,
    ...PACING
  ]
}

const CANCEL_SENT_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'cancelMin', label: 'Số yêu cầu muốn hủy từ', kind: 'number', defaultValue: 1, min: 1, max: 500 },
    { key: 'cancelMax', label: 'Số yêu cầu muốn hủy đến', kind: 'number', defaultValue: 5, min: 1, max: 500 },
    ...PACING
  ]
}

const UNFRIEND_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'uids', label: 'Danh sách UID cần hủy bạn bè', kind: 'text', required: true, maxLength: 20000, placeholder: 'Mỗi dòng một UID' },
    { key: 'unfriendMin', label: 'Hủy từ', kind: 'number', defaultValue: 1, min: 1, max: 500 },
    { key: 'unfriendMax', label: 'Hủy đến', kind: 'number', defaultValue: 5, min: 1, max: 500 },
    ...PACING
  ]
}

const FRIEND_FROM_ENGAGEMENT_SCHEMA: ActionConfigSchema = {
  version: 1,
  fields: [
    { key: 'sourceMode', label: 'Nguồn', kind: 'select', defaultValue: 'engagement', options: [
      { value: 'engagement', label: 'Người like/comment bài trên nhóm, Page, UID' },
      { value: 'group_members', label: 'Thành viên nhóm' }
    ] },
    { key: 'sourceTargets', label: 'Danh sách nhóm / Page / UID', kind: 'text', required: true, maxLength: 20000, placeholder: 'Mỗi dòng một UID hoặc URL' },
    { key: 'scanComments', label: 'Quét người comment', kind: 'boolean', defaultValue: true },
    { key: 'scanLikes', label: 'Quét người like', kind: 'boolean', defaultValue: true },
    { key: 'scanPosts', label: 'Quét người đăng bài', kind: 'boolean', defaultValue: true },
    { key: 'sourcesPerAccount', label: 'Số nguồn / 1 tài khoản', kind: 'number', defaultValue: 10, min: 1, max: 500 },
    { key: 'requestMin', label: 'Số yêu cầu từ', kind: 'number', defaultValue: 1, min: 1, max: 500 },
    { key: 'requestMax', label: 'Số yêu cầu đến', kind: 'number', defaultValue: 5, min: 1, max: 500 },
    { key: 'postsToScan', label: 'Số bài muốn quét like', kind: 'number', defaultValue: 20, min: 1, max: 500 },
    { key: 'removeSourceAfterRun', label: 'Xóa nguồn khỏi phiên sau khi chạy', kind: 'boolean', defaultValue: false, help: 'Chỉ là trạng thái run; không xóa source gốc.' },
    ...PACING
  ]
}

const UI: Record<string, Record<string, K42FieldUiMeta>> = {}
function section(actionType: string, keys: readonly string[], name: string, meta: Partial<K42FieldUiMeta> = {}) {
  const target = UI[actionType] ??= {}
  for (const key of keys) target[key] = { section: name, ...meta }
}

section('friend_interaction', ['onlineLikeEnabled','onlineLikeMin','onlineLikeMax','randomFriends'], 'Tương tác')
section('friend_interaction', REACTIONS.map((f)=>f.key), 'Loại cảm xúc')
section('friend_interaction', ['commentEnabled','commentMin','commentMax','usePostTextAsComment'], 'Bình luận')
UI.friend_interaction!.commentTemplates = { section:'Bình luận', multiline:true, rows:4, visibleWhen:{key:'commentEnabled',equals:true} }
UI.friend_interaction!.commentImagePath = { section:'Bình luận', visibleWhen:{key:'commentEnabled',equals:true} }
section('friend_interaction', ['avatarLikeEnabled','avatarLikeMin','avatarLikeMax'], 'Avatar')
section('poke_friend', ['pokeEnabled','pokeMin','pokeMax','pokeBackEnabled','pokeBackMin','pokeBackMax'], 'Chọc bạn bè')
section('send_friend_request', ['sourceMode'], 'Nguồn kết bạn')
UI.send_friend_request!.sourceValue = { section:'Nguồn kết bạn', multiline:true, rows:4 }
section('send_friend_request', ['requestMin','requestMax'], 'Số lượng')
section('send_friend_request', REQUEST_FILTERS.map((f)=>f.key), 'Bộ lọc')
section('accept_friend_request', ['confirmMin','confirmMax','deleteUnmatched'], 'Xác nhận')
section('accept_friend_request', REQUEST_FILTERS.map((f)=>f.key), 'Bộ lọc')
section('cancel_sent_friend_requests', ['cancelMin','cancelMax'], 'Hủy yêu cầu đã gửi')
UI.unfriend = { uids:{section:'Danh sách UID',multiline:true,rows:6}, unfriendMin:{section:'Số lượng'}, unfriendMax:{section:'Số lượng'} }
section('friend_from_engagement', ['sourceMode'], 'Nguồn')
UI.friend_from_engagement!.sourceTargets = { section:'Nguồn', multiline:true, rows:6 }
section('friend_from_engagement', ['scanComments','scanLikes','scanPosts','sourcesPerAccount','postsToScan'], 'Quét tương tác')
section('friend_from_engagement', ['requestMin','requestMax','removeSourceAfterRun'], 'Kết bạn')
for (const actionType of Object.keys(UI)) section(actionType, PACING.map((f)=>f.key), 'Thiết lập')

const OVERRIDES: Record<string, { description: string; schema: ActionConfigSchema }> = {
  friend_interaction: { description:'Tương tác bài viết/avatar của bạn bè với cảm xúc và comment theo cấu hình.', schema:FRIEND_INTERACTION_SCHEMA },
  poke_friend: { description:'Chọc bạn bè hoặc chọc lại từ surface Pokes.', schema:POKE_SCHEMA },
  send_friend_request: { description:'Gửi lời mời kết bạn từ gợi ý, UID, bạn của bạn bè hoặc tìm kiếm.', schema:SEND_FRIEND_REQUEST_SCHEMA },
  accept_friend_request: { description:'Xác nhận lời mời kết bạn theo số lượng và bộ lọc cơ bản.', schema:ACCEPT_FRIEND_REQUEST_SCHEMA },
  cancel_sent_friend_requests: { description:'Hủy các lời mời kết bạn đã gửi theo số lượng.', schema:CANCEL_SENT_SCHEMA },
  unfriend: { description:'Hủy bạn bè theo danh sách UID đã nhập.', schema:UNFRIEND_SCHEMA },
  friend_from_engagement: { description:'Kết bạn từ người tương tác bài viết hoặc thành viên nhóm, không dùng token quét.', schema:FRIEND_FROM_ENGAGEMENT_SCHEMA }
}

let applied = false
export function applyK42FriendActionOverrides(): void {
  if (applied) return
  for (const [actionType, override] of Object.entries(OVERRIDES)) {
    const definition: ActionDefinition | undefined = ACTION_REGISTRY.find((item) => item.id === actionType)
    if (!definition) continue
    definition.description = override.description
    definition.runtimeStatus = 'ready'
    definition.configSchema = override.schema
  }
  applied = true
}

export function getK42FieldUiMeta(actionType: string, fieldKey: string): K42FieldUiMeta | undefined {
  return UI[actionType]?.[fieldKey]
}

export function getK42ValidationErrors(actionType: string, config: ActionConfig): string[] {
  const number = (key:string) => typeof config[key] === 'number' ? config[key] as number : 0
  const text = (key:string) => typeof config[key] === 'string' ? config[key] as string : ''
  const errors:string[] = []
  const range=(a:string,b:string,label:string)=>{if(number(a)>number(b))errors.push(`${label}: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.`)}
  range('itemDelayMinSeconds','itemDelayMaxSeconds','Delay')
  if(actionType==='friend_interaction'){ range('onlineLikeMin','onlineLikeMax','Like online'); range('commentMin','commentMax','Comment'); range('avatarLikeMin','avatarLikeMax','Like Avatar') }
  if(actionType==='poke_friend'){ range('pokeMin','pokeMax','Chọc bạn bè'); range('pokeBackMin','pokeBackMax','Chọc lại') }
  if(actionType==='send_friend_request'){ range('requestMin','requestMax','Số yêu cầu'); range('mutualMin','mutualMax','Bạn chung'); const mode=text('sourceMode'); if(mode!=='suggestions'&&!text('sourceValue').trim())errors.push('Nguồn kết bạn: cần nhập UID / từ khóa / link nguồn.') }
  if(actionType==='accept_friend_request'){ range('confirmMin','confirmMax','Số yêu cầu xác nhận'); range('mutualMin','mutualMax','Bạn chung') }
  if(actionType==='cancel_sent_friend_requests') range('cancelMin','cancelMax','Số yêu cầu muốn hủy')
  if(actionType==='unfriend'){ range('unfriendMin','unfriendMax','Số bạn bè muốn hủy'); if(!text('uids').trim())errors.push('Danh sách UID: không được để trống.') }
  if(actionType==='friend_from_engagement'){ range('requestMin','requestMax','Số yêu cầu'); if(!text('sourceTargets').trim())errors.push('Danh sách nguồn: không được để trống.') }
  return errors
}
