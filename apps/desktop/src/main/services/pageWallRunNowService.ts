import { extname } from 'node:path'
import type { PageTabConfig } from '../../shared/pageTabs'
import type {
  PageWallExecutionInput,
  PageWallRunNowPayload,
  PageWallRunNowResult
} from '../../shared/pageWall'
import type { PostingJobResult } from '../../shared/posting'

const supportedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp'])

interface PageWallPageTabSource {
  get(id: number): PageTabConfig | null
}

interface PageWallPostingExecutor {
  executePageWallPostNow(input: PageWallExecutionInput): Promise<PostingJobResult>
}

export interface PreparedPageWallExecution {
  input: PageWallExecutionInput
  pageTabName: string
  accountUid: string
  accountName: string | null
}

export type PageWallPreparationResult =
  | { ok: true; prepared: PreparedPageWallExecution }
  | { ok: false; result: PageWallRunNowResult }

function failure(
  payload: PageWallRunNowPayload,
  message: string,
  code: NonNullable<PostingJobResult['code']> = 'unexpected_error'
): PageWallRunNowResult {
  return {
    pageTabId: payload.pageTabId,
    accountId: payload.accountId,
    status: 'failed',
    code,
    message
  }
}

function publicResult(
  payload: PageWallRunNowPayload,
  result: PostingJobResult
): PageWallRunNowResult {
  return {
    pageTabId: payload.pageTabId,
    accountId: payload.accountId,
    status: result.status,
    ...(result.code ? { code: result.code } : {}),
    message: result.message,
    ...(result.publishedUrl ? { publishedUrl: result.publishedUrl } : {}),
    ...(result.screenshotPath ? { screenshotPath: result.screenshotPath } : {}),
    ...(result.sessionValidation ? { sessionValidation: result.sessionValidation } : {}),
    ...(result.accountName ? { accountName: result.accountName } : {})
  }
}

function normalizeImagePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of paths) {
    const path = raw.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    normalized.push(path)
  }
  return normalized
}

export class PageWallRunNowService {
  constructor(
    private readonly pageTabs: PageWallPageTabSource,
    private readonly posting: PageWallPostingExecutor
  ) {}

  prepare(payload: PageWallRunNowPayload): PageWallPreparationResult {
    if (!Number.isInteger(payload.pageTabId) || payload.pageTabId <= 0) {
      return { ok: false, result: failure(payload, 'Page Tab không hợp lệ.') }
    }
    if (!Number.isInteger(payload.accountId) || payload.accountId <= 0) {
      return { ok: false, result: failure(payload, 'Tài khoản chạy Đăng Tường không hợp lệ.', 'no_enabled_account') }
    }

    const pageTab = this.pageTabs.get(payload.pageTabId)
    if (!pageTab) return { ok: false, result: failure(payload, 'Page Tab không còn tồn tại.') }

    const accountRef = pageTab.accounts.find((account) => account.accountId === payload.accountId)
    if (!accountRef || !accountRef.enabled) {
      return { ok: false, result: failure(payload, 'Tài khoản không thuộc danh sách đang bật của Page Tab.', 'no_enabled_account') }
    }

    const pageUid = pageTab.pageUid.trim()
    if (!pageUid) {
      return { ok: false, result: failure(payload, 'Page Tab chưa có Page UID hợp lệ.', 'page_navigation_failed') }
    }

    const imagePaths = normalizeImagePaths(payload.imagePaths)
    const unsupported = imagePaths.find((path) => !supportedImageExtensions.has(extname(path).toLowerCase()))
    if (unsupported) {
      return {
        ok: false,
        result: failure(payload, 'Danh sách ảnh có file không được hỗ trợ. Chỉ dùng JPG, JPEG, PNG hoặc WEBP.', 'media_failed')
      }
    }

    if (!payload.content.trim() && imagePaths.length === 0) {
      return { ok: false, result: failure(payload, 'Hãy nhập nội dung hoặc chọn ít nhất một ảnh.', 'no_content') }
    }

    return {
      ok: true,
      prepared: {
        input: {
          accountId: payload.accountId,
          pageUid,
          content: payload.content,
          imagePaths
        },
        pageTabName: pageTab.name,
        accountUid: accountRef.uid,
        accountName: accountRef.name
      }
    }
  }

  async execute(payload: PageWallRunNowPayload): Promise<PageWallRunNowResult> {
    const preparation = this.prepare(payload)
    if (!preparation.ok) return preparation.result

    const result = await this.posting.executePageWallPostNow(preparation.prepared.input)
    return publicResult(payload, result)
  }
}
