import type {
  PostingErrorCode,
  PostingResultStatus,
  PostingSessionValidation
} from './posting'

/** Secret-free renderer -> Main payload for a one-shot Page Wall publish. */
export interface PageWallRunNowPayload {
  pageTabId: number
  accountId: number
  content: string
  imagePaths: string[]
}

/** Internal Main input after Page Tab/account membership has been validated. */
export interface PageWallExecutionInput {
  accountId: number
  pageUid: string
  content: string
  imagePaths: string[]
}

/** Secret-free result returned to renderer. */
export interface PageWallRunNowResult {
  pageTabId: number
  accountId: number
  status: PostingResultStatus
  code?: PostingErrorCode
  message: string
  publishedUrl?: string
  screenshotPath?: string
  sessionValidation?: PostingSessionValidation
  accountName?: string
}
