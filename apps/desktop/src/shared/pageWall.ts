import type { PageTabImageConfig } from './pageTabs'
import type {
  PostingErrorCode,
  PostingResultStatus,
  PostingSessionValidation
} from './posting'

/** Secret-free canonical post snapshot selected by the renderer from the shared Post Library. */
export interface PageWallCanonicalPostSelection {
  postId: number
  postName: string
  variantIndex: number
  content: string
  image: PageTabImageConfig
}

/** Secret-free renderer -> Main payload for a one-shot Page Wall publish. */
export interface PageWallRunNowPayload {
  pageTabId: number
  accountId: number
  content: string
  imagePaths: string[]
  /**
   * When present, Main materializes this canonical-library selection immediately before
   * Run/Hẹn. The resolved content + concrete image paths are then detached from the library.
   */
  canonicalPost?: PageWallCanonicalPostSelection
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
