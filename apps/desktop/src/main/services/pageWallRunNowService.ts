import { extname } from 'node:path'
import type { PageTabConfig } from '../../shared/pageTabs'
import type {
  PageWallExecutionInput,
  PageWallRunNowPayload,
  PageWallRunNowResult
} from '../../shared/pageWall'
import type { PostingJobResult } from '../../shared/posting'
import { PageWallMaterialResolver } from './pageWallMaterialResolver'

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
  code: NonNullable<PostingJobResult['code']> = 'unexpected_error',
  accountId = payload.accountId ?? 0
): PageWallRunNowResult {
  return {
    pageTabId: payload.pageTabId,
    accountId,
    status: 'failed',
    code,
    message
  }
}

function publicResult(
  pageTabId: number,
  accountId: number,
  result: PostingJobResult
): PageWallRunNowResult {
  return {
    pageTabId,
    accountId,
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
    private readonly posting: PageWallPostingExecutor,
    private readonly materialResolver = new PageWallMaterialResolver()
  ) {}

  async prepare(payload: PageWallRunNowPayload): Promise<PageWallPreparationResult> {
    if (!Number.isInteger(payload.pageTabId) || payload.pageTabId <= 0) {
      return { ok: false, result: failure(payload, 'Page Tab không hợp lệ.') }
    }
    if (payload.accountId !== undefined && (!Number.isInteger(payload.accountId) || payload.accountId <= 0)) {
      return { ok: false, result: failure(payload, 'Tài khoản chạy Đăng Tường không hợp lệ.', 'no_enabled_account') }
    }

    const pageTab = this.pageTabs.get(payload.pageTabId)
    if (!pageTab) return { ok: false, result: failure(payload, 'Page Tab không còn tồn tại.') }

    const runnableAccounts = pageTab.accounts
      .filter((account) => account.enabled && account.status !== 'disabled')
      .sort((left, right) => left.sortOrder - right.sortOrder || left.accountId - right.accountId)
    const accountRef = payload.accountId === undefined
      ? runnableAccounts[0]
      : runnableAccounts.find((account) => account.accountId === payload.accountId)
    if (!accountRef) {
      const message = payload.accountId === undefined
        ? 'Page chưa có tài khoản canonical đang bật để chạy Đăng Tường.'
        : 'Tài khoản không thuộc danh sách đang bật của Page Tab.'
      return { ok: false, result: failure(payload, message, 'no_enabled_account') }
    }

    const pageUid = pageTab.pageUid.trim()
    if (!pageUid) {
      return { ok: false, result: failure(payload, 'Page Tab chưa có Page UID hợp lệ.', 'page_navigation_failed', accountRef.accountId) }
    }

    let content = payload.content
    let imagePaths = normalizeImagePaths(payload.imagePaths)
    if (payload.canonicalPost) {
      const resolved = await this.materialResolver.resolve(payload.canonicalPost)
      if (!resolved.ok) return { ok: false, result: failure(payload, resolved.message, resolved.code, accountRef.accountId) }
      content = resolved.material.content
      imagePaths = resolved.material.imagePaths
    } else {
      const unsupported = imagePaths.find((path) => !supportedImageExtensions.has(extname(path).toLowerCase()))
      if (unsupported) {
        return {
          ok: false,
          result: failure(payload, 'Danh sách ảnh có file không được hỗ trợ. Chỉ dùng JPG, JPEG, PNG hoặc WEBP.', 'media_failed', accountRef.accountId)
        }
      }
    }

    if (!content.trim() && imagePaths.length === 0) {
      return { ok: false, result: failure(payload, 'Hãy nhập nội dung hoặc chọn ít nhất một ảnh.', 'no_content', accountRef.accountId) }
    }

    return {
      ok: true,
      prepared: {
        input: {
          accountId: accountRef.accountId,
          pageUid,
          content,
          imagePaths
        },
        pageTabName: pageTab.name,
        accountUid: accountRef.uid,
        accountName: accountRef.name
      }
    }
  }

  async execute(payload: PageWallRunNowPayload): Promise<PageWallRunNowResult> {
    const preparation = await this.prepare(payload)
    if (!preparation.ok) return preparation.result

    const result = await this.posting.executePageWallPostNow(preparation.prepared.input)
    return publicResult(payload.pageTabId, preparation.prepared.input.accountId, result)
  }
}
