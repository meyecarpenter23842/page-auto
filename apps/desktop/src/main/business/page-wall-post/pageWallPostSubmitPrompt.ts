import type { PostingJobResult } from '../../../shared/posting'
import { waitForComposerStage } from '../../browser/posting/robustComposerDetector'
import {
  formatPageWallOptionalCtaDiagnostics,
  resolvePageWallOptionalCtaPrompt,
  type PageWallOptionalCtaPromptResolution
} from './pageWallPublishAction'
import type { PreparedPageWallRuntime } from './pageWallTask'

const PAGE_WALL_POST_SUBMIT_PROMPT_GRACE_MS = 5_000

export interface PageWallPostSubmitPromptOutcome {
  observed: boolean
  completed: boolean
  blockingResult: PostingJobResult | null
  message: string
}

function commonAfterPublish(
  result: Awaited<ReturnType<PreparedPageWallRuntime['checkAccessBlock']>>
): PostingJobResult {
  return {
    status: result.status,
    ...(result.code ? { code: result.code } : {}),
    message: `${result.message} Hành động publish đã được gửi trước đó; cần review Tường Page trước khi retry.`,
    ...(result.sessionValidation ? { sessionValidation: result.sessionValidation } : {})
  }
}

export function waitForPageWallPostSubmitOptionalCta(
  probe: () => Promise<PageWallOptionalCtaPromptResolution>,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>
): Promise<PageWallOptionalCtaPromptResolution | null> {
  return waitForComposerStage(async () => {
    const resolution = await probe()
    return resolution.dismissButton ? resolution : null
  }, timeoutMs, sleep)
}

export class PageWallPostSubmitPrompt {
  constructor(
    private readonly runtime: PreparedPageWallRuntime,
    private readonly networkTimeoutMs: number
  ) {}

  private diagnostic(message: string): void {
    console.info(`[PAGE-AUTO page-wall-post-submit] ${message}`)
  }

  private async settle(): Promise<void> {
    if (this.runtime.browser.pageSettleDelayMs > 0) {
      await this.runtime.page.waitForTimeout(this.runtime.browser.pageSettleDelayMs).catch(() => undefined)
    }
  }

  async complete(): Promise<PageWallPostSubmitPromptOutcome> {
    const pageRoot = this.runtime.page.locator('body')
    const graceMs = Math.max(
      1_000,
      Math.min(Math.round(this.networkTimeoutMs), PAGE_WALL_POST_SUBMIT_PROMPT_GRACE_MS)
    )
    const resolution = await waitForPageWallPostSubmitOptionalCta(
      () => resolvePageWallOptionalCtaPrompt(pageRoot),
      graceMs,
      (milliseconds) => this.runtime.page.waitForTimeout(milliseconds).catch(() => undefined)
    )

    if (!resolution?.dismissButton) {
      return {
        observed: false,
        completed: false,
        blockingResult: null,
        message: 'Không xuất hiện CTA hậu Đăng Tường trong cửa sổ quan sát.'
      }
    }

    this.diagnostic(`stage=owned_prompt ${formatPageWallOptionalCtaDiagnostics(resolution)}`)
    const dismissButton = resolution.dismissButton
    await this.runtime.pace('page-wall-post-submit-optional-cta-dismiss')

    const stillVisible = await dismissButton.isVisible().catch(() => false)
    const stillEnabled = await dismissButton.isEnabled().catch(() => false)
    if (!stillVisible || !stillEnabled) {
      const message = `Đã thấy CTA hậu Đăng nhưng Not now/Để sau không còn sẵn sàng. ${formatPageWallOptionalCtaDiagnostics(resolution)}`
      this.diagnostic(`stage=prompt_changed ${message}`)
      return {
        observed: true,
        completed: false,
        blockingResult: null,
        message
      }
    }

    try {
      await dismissButton.click({ timeout: this.networkTimeoutMs })
      this.diagnostic('stage=dismiss_click sent')
      await this.settle()
    } catch (error) {
      const message = `Đã thấy CTA hậu Đăng nhưng không dismiss được (${error instanceof Error ? error.message : String(error)}). Không gửi lại Post.`
      this.diagnostic(`stage=dismiss_failed ${message}`)
      return {
        observed: true,
        completed: false,
        blockingResult: null,
        message
      }
    }

    const access = await this.runtime.checkAccessBlock('sau khi xử lý popup hậu Đăng Tường')
    if (access.status !== 'success') {
      return {
        observed: true,
        completed: true,
        blockingResult: commonAfterPublish(access),
        message: access.message
      }
    }

    this.diagnostic('stage=dismiss_complete')
    return {
      observed: true,
      completed: true,
      blockingResult: null,
      message: 'Đã hoàn tất CTA hậu Đăng bằng Not now/Để sau; tiếp tục xác minh bài.'
    }
  }
}
