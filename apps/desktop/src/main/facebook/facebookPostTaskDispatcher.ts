import {
  legacyPostingJobFromGroupTask,
  validateFacebookPostTaskJob,
  type FacebookPostTaskJobRequest,
  type GroupPostTaskJobRequest,
  type PageWallPostTaskJobRequest
} from '../../shared/facebookTasks'
import { spinContent } from '../../shared/contentSpin'
import type { PostingJobResult } from '../../shared/posting'
import { executePostingJob } from '../browser/posting/postingEngine'
import { executePageWallPostJob } from '../business/page-wall-post/executePageWallPostJob'

function invalidTask(message: string): PostingJobResult {
  return { status: 'failed', code: 'unexpected_error', message }
}

function isGroupPostTaskJob(job: FacebookPostTaskJobRequest): job is GroupPostTaskJobRequest {
  return job.task.type === 'group_post'
}

function isPageWallPostTaskJob(job: FacebookPostTaskJobRequest): job is PageWallPostTaskJobRequest {
  return job.task.type === 'page_wall_post'
}

function spinJobContent<T extends FacebookPostTaskJobRequest>(job: T): T {
  return {
    ...job,
    content: spinContent(job.content)
  }
}

export async function executeFacebookPostTaskJob(job: FacebookPostTaskJobRequest): Promise<PostingJobResult> {
  const validationError = validateFacebookPostTaskJob(job)
  if (validationError) return invalidTask(validationError)

  const runtimeJob = spinJobContent(job)
  if (isGroupPostTaskJob(runtimeJob)) {
    return executePostingJob(legacyPostingJobFromGroupTask(runtimeJob))
  }
  if (isPageWallPostTaskJob(runtimeJob)) {
    return executePageWallPostJob(runtimeJob)
  }

  return invalidTask('Facebook posting worker nhận task type chưa được hỗ trợ.')
}
