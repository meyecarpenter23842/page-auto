import type { RunDetails, RunItem } from './runs'

export const POSTING_RESULT_STATUSES = ['success', 'failed', 'needs_login', 'skipped'] as const
export type PostingResultStatus = (typeof POSTING_RESULT_STATUSES)[number]

export const POSTING_ERROR_CODES = [
  'no_enabled_account',
  'account_disabled',
  'needs_login',
  'verification_required',
  'profile_in_use',
  'browser_launch_failed',
  'page_navigation_failed',
  'page_identity_unconfirmed',
  'group_navigation_failed',
  'group_unavailable',
  'composer_not_found',
  'content_failed',
  'media_failed',
  'missing_media',
  'publish_action_failed',
  'publish_unconfirmed',
  'no_content',
  'no_pending_item',
  'worker_timeout',
  'worker_crashed',
  'unexpected_error'
] as const
export type PostingErrorCode = (typeof POSTING_ERROR_CODES)[number]

export interface PostingProxyConfig {
  server: string
  username?: string
  password?: string
}

export interface PostingJobRequest {
  runId: number
  itemId: number
  accountId: number
  profileDirectory: string
  pageUid: string
  groupUid: string
  content: string
  imagePaths: string[]
  userAgent?: string
  proxy?: PostingProxyConfig
}

export interface PostingJobResult {
  status: PostingResultStatus
  code?: PostingErrorCode
  message: string
  publishedUrl?: string
}

export interface PostingWorkerRequestMessage {
  type: 'execute'
  job: PostingJobRequest
}

export interface PostingWorkerReadyMessage {
  type: 'ready'
}

export interface PostingWorkerResultMessage {
  type: 'result'
  result: PostingJobResult
}

export type PostingWorkerMessage = PostingWorkerReadyMessage | PostingWorkerResultMessage

export interface ExecuteSinglePostingJobPayload {
  runId: number
  accountId?: number
}

export interface ExecuteSinglePostingJobResult {
  accountId: number | null
  item: RunItem | null
  result: PostingJobResult
  run: RunDetails
}
