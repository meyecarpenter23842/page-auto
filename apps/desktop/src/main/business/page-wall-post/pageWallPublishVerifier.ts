import type { PostingJobResult } from '../../../shared/posting'
import { pollForReady, readinessAttempts } from '../../browser/posting/postingReadiness'
import {
  capturePublishBaseline,
  findNewPublishedPost,
  findSingleNewPublishedPost,
  type NewPublishedPost,
  type PublishBaseline
} from '../../browser/posting/publishVerification'
import {
  capturePageWallContentBaseline,
  hasNewPageWallContentEvidence,
  type PageWallContentBaseline
} from './pageWallPublishContentEvidence'
import type { PreparedPageWallRuntime } from './pageWallTask'

const WALL_VERIFY_POLL_MS = 500
const WALL_CONTENT_FINGERPRINT_MIN = 12

export interface PageWallPublishVerificationHints {
  postSubmitPromptCompleted?: boolean
}

export interface PageWallPublishBaseline extends PublishBaseline {
  pageWallContent?: PageWallContentBaseline | null
}

function publishUnconfirmed(message: string): PostingJobResult {
  return { status: 'failed', code: 'publish_unconfirmed', message }
}

function commonAfterPublish(result: Awaited<ReturnType<PreparedPageWallRuntime['checkAccessBlock']>>): PostingJobResult {
  return {
    status: result.status,
    ...(result.code ? { code: result.code } : {}),
    message: `${result.message} Hành động publish đã được gửi trước đó; cần review Tường Page trước khi retry.`,
    ...(result.sessionValidation ? { sessionValidation: result.sessionValidation } : {})
  }
}

export class PageWallPublishVerifier {
  private readonly networkTimeoutMs: number

  constructor(
    private readonly runtime: PreparedPageWallRuntime,
    private readonly wallUrl: string,
    networkTimeoutMs: number
  ) {
    this.networkTimeoutMs = Math.max(1_000, Math.round(networkTimeoutMs))
  }

  async captureBaseline(content = ''): Promise<PageWallPublishBaseline> {
    const [publishBaseline, pageWallContent] = await Promise.all([
      capturePublishBaseline(this.runtime.page),
      content.trim()
        ? capturePageWallContentBaseline(this.runtime.page, content)
        : Promise.resolve(null)
    ])
    return {
      ...publishBaseline,
      ...(pageWallContent ? { pageWallContent } : {})
    }
  }

  private waitForEvidence(content: string, baseline: PublishBaseline, timeoutMs: number) {
    const allowKeyOnly = content.trim().length === 0
    return pollForReady(
      () => findNewPublishedPost(
        this.runtime.page,
        content,
        baseline,
        allowKeyOnly,
        WALL_CONTENT_FINGERPRINT_MIN,
        !allowKeyOnly
      ),
      {
        attempts: readinessAttempts(timeoutMs, WALL_VERIFY_POLL_MS),
        intervalMs: WALL_VERIFY_POLL_MS,
        sleep: (milliseconds) => this.runtime.page.waitForTimeout(milliseconds)
      }
    )
  }

  private async confirmedResult(
    evidence: NewPublishedPost,
    message: string,
    accessContext: string
  ): Promise<PostingJobResult> {
    const access = await this.runtime.checkAccessBlock(accessContext)
    if (access.status !== 'success') return commonAfterPublish(access)
    return {
      status: 'success',
      message,
      publishedUrl: evidence.publishedUrl
    }
  }

  private async confirmedContentResult(message: string, accessContext: string): Promise<PostingJobResult> {
    const access = await this.runtime.checkAccessBlock(accessContext)
    if (access.status !== 'success') return commonAfterPublish(access)
    return { status: 'success', message }
  }

  async verify(
    content: string,
    baseline: PageWallPublishBaseline,
    hints: PageWallPublishVerificationHints = {}
  ): Promise<PostingJobResult> {
    if (!baseline.captured) {
      return publishUnconfirmed('Baseline Tường Page không hợp lệ; không thể xác minh bài mới sau publish.')
    }

    const currentDomBudget = Math.max(1_000, Math.floor(this.networkTimeoutMs / 2))
    const current = await this.waitForEvidence(content, baseline, currentDomBudget)
    if (current) {
      return this.confirmedResult(
        current,
        'Đã xác minh bài mới xuất hiện trên Tường Page sau publish.',
        'sau khi phát hiện bài mới trên Tường Page'
      )
    }

    try {
      await this.runtime.page.goto(this.wallUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.runtime.browser.navigationTimeoutMs
      })
      if (this.runtime.browser.pageSettleDelayMs > 0) {
        await this.runtime.page.waitForTimeout(this.runtime.browser.pageSettleDelayMs)
      }
    } catch (error) {
      if (hints.postSubmitPromptCompleted) {
        const access = await this.runtime.checkAccessBlock('sau khi hoàn tất popup hậu Đăng Tường')
        if (access.status !== 'success') return commonAfterPublish(access)
        return {
          status: 'success',
          message: `Facebook đã hoàn tất popup hậu Đăng sau final Post nhưng không thể tải lại Tường để lấy permalink (${error instanceof Error ? error.message : String(error)}). Không gửi lại Post.`
        }
      }
      return publishUnconfirmed(
        `Đã gửi publish nhưng không thể tải lại Tường Page để xác minh (${error instanceof Error ? error.message : String(error)}). Không tự retry.`
      )
    }

    const access = await this.runtime.checkAccessBlock('khi xác minh bài mới trên Tường Page')
    if (access.status !== 'success') return commonAfterPublish(access)

    const reloaded = await this.waitForEvidence(content, baseline, this.networkTimeoutMs)
    if (reloaded) {
      return this.confirmedResult(
        reloaded,
        'Đã xác minh bài mới trên Tường Page sau khi tải lại surface.',
        'sau khi xác minh bài mới trên Tường Page'
      )
    }

    // Page feeds can delay or change permalink wrappers. For text posts, compare the count
    // of exact visible content occurrences on the main Page surface against the pre-publish wall.
    // The reload happens before this probe and dialog/status surfaces are excluded, so composer
    // text or transient UI cannot count as publish evidence.
    if (
      baseline.pageWallContent?.captured
      && await hasNewPageWallContentEvidence(this.runtime.page, content, baseline.pageWallContent).catch(() => false)
    ) {
      return this.confirmedContentResult(
        'Đã xác minh Tường Page có thêm một nội dung exact trên main surface so với baseline trước publish; permalink/post key Facebook chưa ổn định.',
        'sau khi xác minh content-count mới trên Tường Page'
      )
    }

    // Facebook frequently changes the post text wrapper while keeping stable permalink/post IDs.
    // Do not blindly accept any DOM change: only accept this fallback when the target wall has
    // exactly one unique post key that did not exist in the pre-publish baseline.
    const singleNewPost = await findSingleNewPublishedPost(this.runtime.page, baseline)
    if (singleNewPost) {
      return this.confirmedResult(
        singleNewPost,
        'Đã xác minh đúng một bài mới theo post key sau khi tải lại Tường Page; content wrapper Facebook không còn khớp fingerprint.',
        'sau khi xác minh post key mới trên Tường Page'
      )
    }

    // The owned CTA is not treated as generic DOM evidence. It is only a fallback
    // when it appeared after final Post and the safe Not now/Để sau action completed.
    // In that exact state Facebook has advanced beyond the publish click even if the
    // wall feed has not exposed a stable wrapper/permalink yet. Never retry Post here.
    if (hints.postSubmitPromptCompleted) {
      const postSubmitAccess = await this.runtime.checkAccessBlock('sau khi hoàn tất popup hậu Đăng Tường')
      if (postSubmitAccess.status !== 'success') return commonAfterPublish(postSubmitAccess)
      return {
        status: 'success',
        message: 'Facebook đã hiển thị và hoàn tất popup hậu Đăng sau final Post; Tường chưa render được fingerprint/post key/permalink ổn định nhưng post-submit state đã được xác nhận. Không gửi lại Post.'
      }
    }

    return publishUnconfirmed(
      'Facebook đã nhận click Đăng nhưng chưa thấy bài mới khớp baseline/nội dung trên Tường Page. Không tự retry để tránh đăng trùng; cần review thủ công.'
    )
  }
}
