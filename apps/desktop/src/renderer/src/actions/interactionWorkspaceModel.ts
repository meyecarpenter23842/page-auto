import { getActionDefinition, type ActionRuntimeStatus } from '../../../shared/actionRegistry'
import { applyActionOverrides } from '../../../shared/actionOverrides'

applyActionOverrides()

export const INTERACTION_TARGET_OPTIONS = [
  { id: 'friends', label: 'Bạn bè', hint: 'Tương tác bài viết từ danh sách bạn bè.' },
  { id: 'friend_requests', label: 'Người gửi yêu cầu kết bạn', hint: 'Dùng người đã gửi lời mời kết bạn làm nguồn target.' },
  { id: 'uid_distribute', label: 'UID · chia đều', hint: 'Chia danh sách UID/URL cho các account theo lượt.' },
  { id: 'uid_limit', label: 'UID · theo limit', hint: 'Mỗi account lấy số UID theo limit cấu hình.' },
  { id: 'uid_account_file', label: '1 account · 1 file UID', hint: 'Mỗi account sử dụng một file UID riêng.' },
  { id: 'groups', label: 'Group', hint: 'Tương tác nội dung trong danh sách Group.' },
  { id: 'seeding', label: 'Seeding', hint: 'Luồng like/comment seeding; module hiện vẫn được hiển thị nếu chưa có executor.' }
] as const

export type InteractionTargetMode = typeof INTERACTION_TARGET_OPTIONS[number]['id']
export type InteractionActor = 'profile' | 'page'

export const INTERACTION_ACTION_OPTIONS = [
  { key: 'reaction', label: 'Like / Reaction' },
  { key: 'comment', label: 'Comment' },
  { key: 'replyComment', label: 'Reply comment' },
  { key: 'reactComment', label: 'Like / Reaction comment' },
  { key: 'commentTag', label: 'Tag trong comment' },
  { key: 'poke', label: 'Chọc bạn bè' }
] as const

export type InteractionActionKey = typeof INTERACTION_ACTION_OPTIONS[number]['key']
export type InteractionReactionKey = 'like' | 'love' | 'care' | 'haha' | 'wow' | 'sad' | 'angry'

export interface InteractionWorkspaceDraft {
  actor: InteractionActor
  targetMode: InteractionTargetMode
  targetValues: string
  uidFilePath: string
  actions: Record<InteractionActionKey, boolean>
  reactions: Record<InteractionReactionKey, boolean>
  commentMatch: string
  commentTemplates: string
  replyTemplates: string
  tagTargets: string
  targetLimit: number
  postsPerTarget: number
  delayMinSeconds: number
  delayMaxSeconds: number
  repeat: boolean
}

export interface InteractionModulePlanItem {
  actionType: string
  label: string
  runtimeStatus: ActionRuntimeStatus
}

export interface InteractionWorkspacePlan {
  modules: InteractionModulePlanItem[]
  errors: string[]
  warnings: string[]
}

export const DEFAULT_INTERACTION_WORKSPACE_DRAFT: InteractionWorkspaceDraft = {
  actor: 'profile',
  targetMode: 'friends',
  targetValues: '',
  uidFilePath: '',
  actions: {
    reaction: true,
    comment: false,
    replyComment: false,
    reactComment: false,
    commentTag: false,
    poke: false
  },
  reactions: {
    like: true,
    love: false,
    care: false,
    haha: false,
    wow: false,
    sad: false,
    angry: false
  },
  commentMatch: '',
  commentTemplates: '',
  replyTemplates: '',
  tagTargets: '',
  targetLimit: 20,
  postsPerTarget: 1,
  delayMinSeconds: 2,
  delayMaxSeconds: 5,
  repeat: false
}

const DRIVER_BY_TARGET: Record<InteractionTargetMode, string> = {
  friends: 'friend_interaction',
  friend_requests: 'friend_interaction',
  uid_distribute: 'target_uid_interaction',
  uid_limit: 'target_uid_interaction',
  uid_account_file: 'target_uid_interaction',
  groups: 'group_interaction',
  seeding: 'like_comment_seeding'
}

const LIST_TARGETS = new Set<InteractionTargetMode>(['uid_distribute', 'uid_limit', 'groups', 'seeding'])

function selectedActionCount(draft: InteractionWorkspaceDraft): number {
  return Object.values(draft.actions).filter(Boolean).length
}

function pushModule(actionTypes: string[], actionType: string): void {
  if (!actionTypes.includes(actionType)) actionTypes.push(actionType)
}

export function buildInteractionWorkspacePlan(draft: InteractionWorkspaceDraft): InteractionWorkspacePlan {
  const errors: string[] = []
  const warnings: string[] = []
  const actionTypes: string[] = []

  if (selectedActionCount(draft) === 0) errors.push('Cần tích ít nhất một hành động.')
  if (draft.delayMinSeconds > draft.delayMaxSeconds) errors.push('Delay từ phải nhỏ hơn hoặc bằng delay đến.')
  if (draft.targetLimit < 1) errors.push('Limit target phải lớn hơn 0.')
  if (draft.postsPerTarget < 1) errors.push('Số bài / target phải lớn hơn 0.')

  if (LIST_TARGETS.has(draft.targetMode) && !draft.targetValues.trim()) {
    errors.push('Danh sách UID/URL/Group không được để trống với nguồn target này.')
  }
  if (draft.targetMode === 'uid_account_file' && !draft.uidFilePath.trim()) {
    errors.push('Cần nhập đường dẫn file UID cho chế độ 1 account · 1 file UID.')
  }
  if (draft.actions.reaction && !Object.values(draft.reactions).some(Boolean)) {
    errors.push('Like / Reaction cần chọn ít nhất một cảm xúc.')
  }
  if (draft.actions.comment && !draft.commentTemplates.trim()) {
    errors.push('Comment đang bật nhưng chưa có nội dung.')
  }
  if (draft.actions.replyComment && !draft.replyTemplates.trim()) {
    errors.push('Reply comment đang bật nhưng chưa có nội dung trả lời.')
  }
  if (draft.actions.commentTag && !draft.tagTargets.trim()) {
    errors.push('Tag trong comment đang bật nhưng chưa có target cần tag.')
  }

  if (draft.actions.reaction || draft.actions.comment) pushModule(actionTypes, DRIVER_BY_TARGET[draft.targetMode])
  if (draft.actions.reactComment) pushModule(actionTypes, 'react_comment')
  if (draft.actions.replyComment) pushModule(actionTypes, 'reply_comment')
  if (draft.actions.commentTag) pushModule(actionTypes, 'comment_tag')
  if (draft.actions.poke) pushModule(actionTypes, 'poke_friend')

  if (draft.targetMode === 'friend_requests' && (draft.actions.reaction || draft.actions.comment)) {
    warnings.push('Nguồn “người gửi yêu cầu kết bạn” chưa có target collector riêng; khi nối runner cần bổ sung tầng lấy target trước friend_interaction.')
  }
  if (draft.targetMode === 'uid_account_file') {
    warnings.push('Chia 1 file UID cho từng account mới là draft UI; file picker/distribution sẽ nối ở lô persistence + runner.')
  }

  const modules: InteractionModulePlanItem[] = actionTypes.flatMap((actionType) => {
    const definition = getActionDefinition(actionType)
    if (!definition) {
      warnings.push(`${actionType}: chưa có trong Action Registry.`)
      return []
    }
    if (definition.runtimeStatus !== 'ready') warnings.push(`${definition.label}: module chưa có executor.`)
    if (!definition.capabilities.actors.includes(draft.actor)) {
      warnings.push(`${definition.label}: không hỗ trợ actor ${draft.actor === 'page' ? 'Page' : 'Profile'}.`)
    }
    return [{ actionType, label: definition.label, runtimeStatus: definition.runtimeStatus }]
  })

  return { modules, errors, warnings }
}

export function interactionTargetNeedsText(mode: InteractionTargetMode): boolean {
  return LIST_TARGETS.has(mode)
}
