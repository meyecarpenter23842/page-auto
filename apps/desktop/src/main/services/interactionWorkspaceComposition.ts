import { getActionDefinition } from '../../shared/actionRegistry'
import { applyActionOverrides } from '../../shared/actionOverrides'
import {
  splitInteractionValues,
  type InteractionWorkspaceDraft
} from '../../shared/interactionWorkspaceConfig'

applyActionOverrides()

export interface InteractionComposedAction {
  actionType: string
  label: string
  config: Record<string, string | number | boolean>
}

function reactions(draft: InteractionWorkspaceDraft): Record<string, boolean> {
  return {
    reactionLike: draft.reactions.like,
    reactionLove: draft.reactions.love,
    reactionCare: draft.reactions.care,
    reactionHaha: draft.reactions.haha,
    reactionWow: draft.reactions.wow,
    reactionSad: draft.reactions.sad,
    reactionAngry: draft.reactions.angry
  }
}

function pacing(draft: InteractionWorkspaceDraft): Record<string, number> {
  return {
    itemDelayMinSeconds: draft.delayMinSeconds,
    itemDelayMaxSeconds: draft.delayMaxSeconds
  }
}

function pushAction(
  actions: InteractionComposedAction[],
  actionType: string,
  config: Record<string, string | number | boolean>
): void {
  const definition = getActionDefinition(actionType)
  actions.push({
    actionType,
    label: definition?.label ?? actionType,
    config
  })
}

export function interactionWorkspaceActionTypes(draft: InteractionWorkspaceDraft): string[] {
  const result: string[] = []
  const push = (value: string) => {
    if (!result.includes(value)) result.push(value)
  }

  if (draft.actions.reaction || draft.actions.comment) {
    if (draft.targetMode === 'friends' || draft.targetMode === 'friend_requests') push('friend_interaction')
    else if (draft.targetMode === 'groups') push('group_interaction')
    else if (draft.targetMode === 'seeding') push('like_comment_seeding')
    else push('target_uid_interaction')
  }
  if (draft.actions.reactComment) push('react_comment')
  if (draft.actions.replyComment) push('reply_comment')
  if (draft.actions.commentTag) push('comment_tag')
  if (draft.actions.poke) push('poke_friend')
  return result
}

export function validateInteractionWorkspaceRun(
  draft: InteractionWorkspaceDraft,
  enabledAccountCount: number
): string[] {
  const errors: string[] = []
  const actionTypes = interactionWorkspaceActionTypes(draft)

  if (enabledAccountCount < 1) errors.push('Chưa có account được bật để chạy.')
  if (actionTypes.length < 1) errors.push('Cần chọn ít nhất một hành động.')
  if (draft.actor === 'page' && !draft.pageUid.trim()) errors.push('Actor Page cần Page UID.')
  if (draft.delayMinSeconds > draft.delayMaxSeconds) errors.push('Delay từ phải nhỏ hơn hoặc bằng delay đến.')
  if (draft.targetLimit < 1) errors.push('Limit target phải lớn hơn 0.')
  if (draft.postsPerTarget < 1) errors.push('Số bài / target phải lớn hơn 0.')
  if (draft.actions.reaction && !Object.values(draft.reactions).some(Boolean)) {
    errors.push('Reaction cần chọn ít nhất một cảm xúc.')
  }
  if (draft.actions.comment && !draft.commentTemplates.trim()) errors.push('Comment cần nội dung.')
  if (draft.actions.replyComment && !draft.replyTemplates.trim()) errors.push('Reply comment cần nội dung.')
  if (draft.actions.commentTag && !draft.tagTargets.trim()) errors.push('Comment tag cần UID/tên target.')

  const needsInlineTargets = draft.targetMode === 'uid_distribute'
    || draft.targetMode === 'uid_limit'
    || draft.targetMode === 'groups'
    || draft.targetMode === 'seeding'
  if (needsInlineTargets && splitInteractionValues(draft.targetValues).length < 1) {
    errors.push('Nguồn target đang chọn cần ít nhất một UID/URL/Group.')
  }
  if (draft.targetMode === 'uid_account_file' && !draft.uidFilePath.trim()) {
    errors.push('Chế độ 1 account · 1 file UID cần folder hoặc đường dẫn mẫu file.')
  }
  if (
    draft.targetMode === 'friend_requests'
    && (draft.actions.reaction || draft.actions.comment)
  ) {
    errors.push('Nguồn người gửi yêu cầu kết bạn chưa có target collector; chưa thể Start tổ hợp này.')
  }
  if (
    (draft.targetMode === 'friends' || draft.targetMode === 'friend_requests')
    && (draft.actions.reactComment || draft.actions.replyComment || draft.actions.commentTag)
  ) {
    errors.push('Action cấp comment cần nguồn target có UID/URL cụ thể.')
  }

  for (const actionType of actionTypes) {
    const definition = getActionDefinition(actionType)
    if (!definition) {
      errors.push(`Action ${actionType} không còn trong Action Registry.`)
      continue
    }
    if (definition.runtimeStatus !== 'ready') errors.push(`${definition.label}: executor chưa sẵn sàng.`)
    if (!definition.capabilities.actors.includes(draft.actor)) {
      errors.push(`${definition.label}: không hỗ trợ actor ${draft.actor === 'page' ? 'Page' : 'Profile'}.`)
    }
  }
  return errors
}

export function allocateInteractionTargets(
  draft: InteractionWorkspaceDraft,
  allTargets: readonly string[],
  accountIndex: number,
  accountCount: number
): string[] {
  const limit = Math.max(1, Math.floor(draft.targetLimit))
  if (draft.targetMode === 'uid_distribute') {
    return allTargets.filter((_value, index) => index % Math.max(1, accountCount) === accountIndex).slice(0, limit)
  }
  if (draft.targetMode === 'uid_limit') {
    const start = accountIndex * limit
    return allTargets.slice(start, start + limit)
  }
  return [...allTargets].slice(0, limit)
}

export function composeInteractionActions(
  draft: InteractionWorkspaceDraft,
  resolvedTargets: readonly string[]
): InteractionComposedAction[] {
  const actions: InteractionComposedAction[] = []
  const hasResolvedTargets = resolvedTargets.length > 0
  const targetCount = Math.min(draft.targetLimit, resolvedTargets.length)
  const operationCount = Math.max(1, targetCount * Math.max(1, draft.postsPerTarget))
  const reactionFields = reactions(draft)
  const pacingFields = pacing(draft)

  if (draft.actions.reaction || draft.actions.comment) {
    if (draft.targetMode === 'friends' || draft.targetMode === 'friend_requests') {
      pushAction(actions, 'friend_interaction', {
        onlineLikeEnabled: draft.actions.reaction,
        onlineLikeMin: draft.actions.reaction ? operationCount : 0,
        onlineLikeMax: draft.actions.reaction ? operationCount : 0,
        randomFriends: false,
        ...reactionFields,
        commentEnabled: draft.actions.comment,
        commentMin: draft.actions.comment ? operationCount : 0,
        commentMax: draft.actions.comment ? operationCount : 0,
        usePostTextAsComment: false,
        commentTemplates: draft.commentTemplates,
        commentImagePath: '',
        avatarLikeEnabled: false,
        avatarLikeMin: 0,
        avatarLikeMax: 0,
        ...pacingFields,
        pauseAfterCount: 0,
        pauseMinutes: 0
      })
    } else if (draft.targetMode === 'groups') {
      if (hasResolvedTargets) pushAction(actions, 'group_interaction', {
        sourceMode: 'joined_groups',
        joinedGroupMin: Math.max(1, resolvedTargets.length),
        joinedGroupMax: Math.max(1, resolvedTargets.length),
        groupWhitelist: resolvedTargets.join('\n'),
        viewEnabled: false,
        viewMinSeconds: 0,
        viewMaxSeconds: 0,
        sortRecent: false,
        reactionEnabled: draft.actions.reaction,
        reactionMin: draft.actions.reaction ? operationCount : 0,
        reactionMax: draft.actions.reaction ? operationCount : 0,
        ...reactionFields,
        commentEnabled: draft.actions.comment,
        commentMin: draft.actions.comment ? operationCount : 0,
        commentMax: draft.actions.comment ? operationCount : 0,
        deleteCommentAfter: false,
        usePostTextAsComment: false,
        commentTemplates: draft.commentTemplates,
        commentImagePath: '',
        shareWallEnabled: false,
        shareWallMin: 0,
        shareWallMax: 0,
        shareGroupEnabled: false,
        shareGroupMin: 0,
        shareGroupMax: 0,
        shareGroupWhitelist: '',
        restrictedGroupPolicy: 'skip',
        ...pacingFields,
        pauseAfterCount: 0,
        pauseMinutes: 0
      })
    } else if (draft.targetMode === 'seeding') {
      if (hasResolvedTargets) pushAction(actions, 'like_comment_seeding', {})
    } else if (hasResolvedTargets) {
      pushAction(actions, 'target_uid_interaction', {
        targets: resolvedTargets.join('\n'),
        targetsPerRun: Math.max(1, resolvedTargets.length),
        postsPerTarget: draft.postsPerTarget,
        randomTargets: false,
        reactionEnabled: draft.actions.reaction,
        ...reactionFields,
        commentEnabled: draft.actions.comment,
        commentTemplates: draft.commentTemplates,
        commentImagePath: '',
        ...pacingFields
      })
    }
  }

  for (const targetUrl of resolvedTargets) {
    if (draft.actions.reactComment) {
      pushAction(actions, 'react_comment', {
        targetUrl,
        commentMatch: draft.commentMatch,
        ...reactionFields,
        ...pacingFields
      })
    }
    if (draft.actions.replyComment) {
      pushAction(actions, 'reply_comment', {
        targetUrl,
        commentMatch: draft.commentMatch,
        replyTemplates: draft.replyTemplates,
        replyImagePath: '',
        ...pacingFields
      })
    }
    if (draft.actions.commentTag) {
      pushAction(actions, 'comment_tag', {
        targetUrl,
        tagTargets: draft.tagTargets,
        commentTemplates: draft.commentTemplates,
        ...pacingFields
      })
    }
  }

  if (draft.actions.poke) {
    pushAction(actions, 'poke_friend', {
      pokeEnabled: true,
      pokeMin: draft.targetLimit,
      pokeMax: draft.targetLimit,
      pokeBackEnabled: false,
      pokeBackMin: 0,
      pokeBackMax: 0,
      ...pacingFields,
      pauseAfterCount: 0,
      pauseMinutes: 0
    })
  }

  return actions
}
