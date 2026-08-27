import type { PostingErrorCode, PostingJobResult } from '../../../shared/posting'
import { MediaUploader, PostComposer } from '../../browser/posting/postingEngine'
import { RobustComposerDetector } from '../../browser/posting/robustComposerDetector'
import { PageWallPublishAction } from './pageWallPublishAction'
import type { PreparedPageWallRuntime } from './pageWallTask'
import { PageWallPublishVerifier } from './pageWallPublishVerifier'

function failure(code: PostingErrorCode, message: string): PostingJobResult {
  return { status: 'failed', code, message }
}

export class PageWallPostFlow {
  private readonly networkTimeoutMs: number

  constructor(
    private readonly runtime: PreparedPageWallRuntime,
    private readonly wallUrl: string,
    networkTimeoutMs: number
  ) {
    this.networkTimeoutMs = Math.max(1_000, Math.round(networkTimeoutMs))
  }

  async execute(content: string, imagePaths: string[]): Promise<PostingJobResult> {
    const normalizedContent = content.trim()
    if (!normalizedContent && imagePaths.length === 0) {
      return failure('no_content', 'page_wall_post cần nội dung hoặc ít nhất một ảnh để đăng.')
    }

    const verifier = new PageWallPublishVerifier(
      this.runtime,
      this.wallUrl,
      this.networkTimeoutMs
    )
    const baseline = await verifier.captureBaseline()
    if (!baseline.captured) {
      return failure(
        'publish_unconfirmed',
        'Không chụp được baseline Tường Page trước khi đăng; chưa gửi publish để tránh trạng thái không thể xác minh.'
      )
    }

    await this.runtime.pace('wall-to-composer')
    const composerDetector = new RobustComposerDetector(
      this.runtime.page,
      this.networkTimeoutMs,
      this.runtime.browser.pageSettleDelayMs
    )
    const composer = await composerDetector.open()
    if (!composer) {
      const diagnostics = await composerDetector.diagnostics()
      return failure(
        'composer_not_found',
        `Không phát hiện được editor sẵn sàng trên Tường Page. ${diagnostics}`
      )
    }

    if (normalizedContent) {
      const contentResult = await new PostComposer(
        this.runtime.page,
        this.networkTimeoutMs,
        this.runtime.browser.pageSettleDelayMs
      ).fill(composer.textbox, normalizedContent)
      if (contentResult.status !== 'success') return contentResult
    }

    const mediaResult = await new MediaUploader(
      this.runtime.page,
      composerDetector,
      this.networkTimeoutMs,
      this.runtime.browser.pageSettleDelayMs
    ).upload(composer.container, imagePaths)
    if (mediaResult.status !== 'success') return mediaResult

    await this.runtime.pace('media-to-publish')
    const publishResult = await new PageWallPublishAction(
      this.runtime,
      composerDetector,
      this.networkTimeoutMs
    ).click(composer.container)
    if (publishResult.status !== 'success') return publishResult

    return verifier.verify(content, baseline)
  }
}
