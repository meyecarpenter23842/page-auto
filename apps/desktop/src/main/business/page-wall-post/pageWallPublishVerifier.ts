import type { PostingJobResult } from '../../../shared/posting'
import { pollForReady, readinessAttempts } from '../../browser/posting/postingReadiness'
import {
  capturePublishBaseline,
  findNewPublishedPost,
  type PublishBaseline
} from '../../browser/posting/publishVerification'
import type { PreparedPageWallRuntime } from './pageWallTask'

const WALL_VERIFY_POLL_MS = 500

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

  captureBaseline(): Promise<PublishBaseline> {
    return capturePublishBaseline(this.runtime.page)
  }

  private waitForEvidence(content: string, baseline: PublishBaseline, timeoutMs: number) {
    const allowKeyOnly = content.trim().length === 0
    return pollForReady(
      () => findNewPublishedPost(
        this.runtime.page,
        content,
        baseline,
        allowKeyOnly,
        1
      ),
      {
        attempts: readinessAttempts(timeoutMs, WALL_VERIFY_POLL_MS),
        intervalMs: WALL_VERIFY_POLL_MS,
        sleep: (milliseconds) => this.runtime.page.waitForTimeout(milliseconds)
      }
    )
  }

  async verify(content: string, baseline: PublishBaseline): Promise<PostingJobResult> {
    if (!baseline.captured) {
      return publishUnconfirmed('Baseline Tường Page không hợp lệ; không thể xác minh bài mới sau publish.')
    }

    const currentDomBudget = Math.max(1_000, Math.floor(this.networkTimeoutMs / 2))
    const current = await this.waitForEvidence(content, baseline, currentDomBudget)
    if (current) {
      return {
        status: 'success',
        message: 'Đã xác minh bài mới xuất hiện trên Tường Page sau publish.',
        publishedUrl: current.publishedUrl
      }
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
      return publishUnconfirmed(
        `Đã gửi publish nhưng không thể tải lại Tường Page để xác minh (${error instanceof Error ? error.message : String(error)}). Không tự retry.`
      )
    }

    const access = await this.runtime.checkAccessBlock('khi xác minh bài mới trên Tường Page')
    if (access.status !== 'success') return commonAfterPublish(access)

    const reloaded = await this.waitForEvidence(content, baseline, this.networkTimeoutMs)
    if (reloaded) {
      return {
        status: 'success',
        message: 'Đã xác minh bài mới trên Tường Page sau khi tải lại surface.',
        publishedUrl: reloaded.publishedUrl
      }
    }

    return publishUnconfirmed(
      'Facebook đã nhận click Đăng nhưng chưa thấy bài mới khớp baseline/nội dung trên Tường Page. Không tự retry để tránh đăng trùng; cần review thủ công.'
    )
  }
}
