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
 * `PostingJobRequest` remains the legacy Group worker contract during Batch 5A.
 * New business jobs derive from the same common account/Page/runtime material but
 * do not inherit Group-only target fields.
 */
export type FacebookTaskJobBase = Omit<PostingJobRequest, 'groupUid'>

export type GroupPostTaskJobRequest = FacebookTaskJobBase & {
  task: GroupPostTaskDescriptor
}

export type PageWallPostTaskJobRequest = FacebookTaskJobBase & {
  task: PageWallPostTaskDescriptor
}

export type FacebookPostTaskJobRequest = GroupPostTaskJobRequest | PageWallPostTaskJobRequest

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
