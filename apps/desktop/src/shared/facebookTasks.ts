import type { PostingJobRequest } from './posting'

export const FACEBOOK_TASK_TYPES = ['group_post', 'page_wall_post', 'page_edit', 'comment'] as const
export type FacebookTaskType = (typeof FACEBOOK_TASK_TYPES)[number]

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
 * Transitional multi-business job base.
 *
 * Group still exposes `PostingJobRequest` to its existing orchestration, while the
 * worker boundary can now carry explicit business tasks without inheriting a Group UID.
 */
export type FacebookTaskJobBase = Omit<PostingJobRequest, 'groupUid'>

export type GroupPostTaskJobRequest = FacebookTaskJobBase & {
  task: GroupPostTaskDescriptor
}

export type PageWallPostTaskJobRequest = FacebookTaskJobBase & {
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
    task: {
      type: 'group_post',
      target: { kind: 'group', groupUid }
    }
  }
}

export function legacyPostingJobFromGroupTask(job: GroupPostTaskJobRequest): PostingJobRequest {
  const { task, ...base } = job
  return {
    ...base,
    groupUid: task.target.groupUid
  }
}

export function pageWallPostTaskFromBase(base: FacebookTaskJobBase): PageWallPostTaskJobRequest {
  return {
    ...base,
    task: {
      type: 'page_wall_post',
      target: { kind: 'page_wall', pageUid: base.pageUid }
    }
  }
}

export function validateFacebookPostTaskJob(job: FacebookPostTaskJobRequest): string | null {
  if (job.task.type === 'group_post') {
    return job.task.target.groupUid.trim() ? null : 'group_post yêu cầu Group UID hợp lệ.'
  }

  const targetPageUid = job.task.target.pageUid.trim()
  if (!targetPageUid) return 'page_wall_post yêu cầu Page UID hợp lệ.'
  if (targetPageUid !== job.pageUid.trim()) {
    return 'Page UID của page_wall_post target phải trùng Page UID của common runtime.'
  }
  return null
}
