import type { BrowserSettings, LoggingSettings, NetworkSettings, SessionSettings } from './appSettings'
import type { BrowserWindowPlacement } from './browserWindowLayout'
import type { RunDetails, RunItem } from './runs'

export const POSTING_RESULT_STATUSES = ['success', 'failed', 'needs_login', 'skipped'] as const
export type PostingResultStatus = (typeof POSTING_RESULT_STATUSES)[number]

export const POSTING_ERROR_CODES = [
  'no_enabled_account',
  'account_disabled',
  'needs_login',
  'verification_required',
  'email_auth_missing',
  'email_auth_expired',
  'email_code_not_found',
  'email_support_error',
  'email_code_failed',
  'proxy_invalid',
  'proxy_unavailable',
  'profile_in_use',
  'browser_launch_failed',
  'page_navigation_failed',
  'page_identity_unconfirmed',
  'profile_identity_unconfirmed',
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

export const POSTING_SESSION_STATES = ['valid', 'needs_login', 'verification_required'] as const
export type PostingSessionState = (typeof POSTING_SESSION_STATES)[number]
export type PostingSessionPhase = 'before_run' | 'after_run'
export const POSTING_CHECKPOINT_KINDS = ['282', '956', '956_purple_lock', 'disabled', 'unknown'] as const
export type PostingCheckpointKind = (typeof POSTING_CHECKPOINT_KINDS)[number]

export interface PostingSessionValidation {
  phase: PostingSessionPhase
  state: PostingSessionState
  message: string
  checkpointKind?: PostingCheckpointKind
}

export interface PostingSessionAccount {
  id: number
  uid: string
  username: string | null
  password: string | null
  cookie: string | null
  twoFactorSecret: string | null
  name: string | null
}

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
  browser: BrowserSettings
  browserPlacement?: BrowserWindowPlacement | null
  session: SessionSettings
  network: NetworkSettings
  logging: LoggingSettings
  sessionAccount: PostingSessionAccount
  userAgent?: string
  proxy?: PostingProxyConfig
}

export interface PostingJobResult {
  status: PostingResultStatus
  code?: PostingErrorCode
  message: string
  publishedUrl?: string
  screenshotPath?: string
  currentUrl?: string
  tracePath?: string
  sessionValidation?: PostingSessionValidation
  accountName?: string
  /** Main-process only. PostingService strips this before returning through IPC/logging. */
  sessionCookie?: string
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
