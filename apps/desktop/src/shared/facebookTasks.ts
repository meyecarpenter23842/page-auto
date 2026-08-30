import type { PostingJobRequest } from './posting'

export const FACEBOOK_TASK_TYPES = ['group_post', 'page_wall_post', 'page_edit', 'comment'] as const
export type FacebookTaskType = (typeof FACEBOOK_TASK_TYPES)[number]

export const FACEBOOK_EXECUTION_MODES = ['rotation', 'one_shot'] as const
export type FacebookExecutionMode = (typeof FACEBOOK_EXECUTION_MODES)[number]

export interface GroupPostTaskDescriptor {
  type: 'group_post'
  target: {
    kind: 'group'
    groupUid: string
  }
}

export interface PageWallPostTaskDescriptor {
  type: 'page_wall_post'
  target: {
    kind: 'page_wall'
    pageUid: string
  }
}

export interface PageEditTaskDescriptor {
  type: 'page_edit'
  target: {
    kind: 'page'
    pageUid: string
  }
}

export interface CommentTaskDescriptor {
  type: 'comment'
  target: {
    kind: 'post'
    postId: string
  }
}

export type FacebookTaskDescriptor =
  | GroupPostTaskDescriptor
  | PageWallPostTaskDescriptor
  | PageEditTaskDescriptor
  | CommentTaskDescriptor

/**
 * Transitional multi-business job seed.
 *
 * Existing Main call sites can omit executionMode while adapters normalize every
 * worker-bound job to an explicit lifecycle. Group legacy orchestration is always
 * `rotation`; wall posting is `one_shot`.
 *
 * For `page_wall_post`, a non-empty `pageUid` means Page mode and Common Runtime
 * must switch/verify that Page. A blank `pageUid` means profile-wall mode: Common
 * Runtime stays on the account identity and the task target is the account UID.
 */
export type FacebookTaskJobBase = Omit<PostingJobRequest, 'groupUid'> & {
  executionMode?: FacebookExecutionMode
}

type NormalizedFacebookTaskJobBase = Omit<FacebookTaskJobBase, 'executionMode'> & {
  executionMode: FacebookExecutionMode
}

export type GroupPostTaskJobRequest = NormalizedFacebookTaskJobBase & {
  task: GroupPostTaskDescriptor
}

export type PageWallPostTaskJobRequest = NormalizedFacebookTaskJobBase & {
  task: PageWallPostTaskDescriptor
}

export type FacebookPostTaskJobRequest = GroupPostTaskJobRequest | PageWallPostTaskJobRequest

export interface FacebookPostWorkerRequestMessage {
  type: 'execute'
  job: FacebookPostTaskJobRequest
}

export function groupPostTaskFromLegacy(job: PostingJobRequest): GroupPostTaskJobRequest {
  const { groupUid, ...base } = job
  return {
    ...base,
    executionMode: 'rotation',
    task: {
      type: 'group_post',
      target: { kind: 'group', groupUid }
    }
  }
}

export function legacyPostingJobFromGroupTask(job: GroupPostTaskJobRequest): PostingJobRequest {
  const { task, executionMode: _executionMode, ...base } = job
  return {
    ...base,
    groupUid: task.target.groupUid
  }
}

export function pageWallPostTaskFromBase(base: FacebookTaskJobBase): PageWallPostTaskJobRequest {
  const commonPageUid = base.pageUid.trim()
  const targetUid = commonPageUid || base.sessionAccount.uid.trim()
  return {
    ...base,
    executionMode: 'one_shot',
    task: {
      type: 'page_wall_post',
      target: { kind: 'page_wall', pageUid: targetUid }
    }
  }
}

export function validateFacebookPostTaskJob(job: FacebookPostTaskJobRequest): string | null {
  if (job.task.type === 'group_post') {
    return job.task.target.groupUid.trim() ? null : 'group_post yêu cầu Group UID hợp lệ.'
  }

  const targetUid = job.task.target.pageUid.trim()
  if (!targetUid) return 'page_wall_post yêu cầu UID tường hợp lệ.'

  const commonPageUid = job.pageUid.trim()
  if (commonPageUid) {
    return targetUid === commonPageUid
      ? null
      : 'Page UID của page_wall_post target phải trùng Page UID của common runtime.'
  }

  const profileUid = job.sessionAccount.uid.trim()
  if (!profileUid) return 'profile wall yêu cầu UID account hợp lệ.'
  return targetUid === profileUid
    ? null
    : 'Profile wall target phải trùng UID account khi common runtime không switch Page.'
}
