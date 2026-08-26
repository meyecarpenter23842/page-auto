import type { Locator, Page } from 'playwright-core'
import type { BrowserSettings } from '../../../shared/appSettings'
import type { PostingJobRequest, PostingJobResult } from '../../../shared/posting'
import {
  FacebookCommonRuntime,
  checkFacebookCommonAccess,
  type FacebookCommonStepResult
} from '../../facebook/facebookCommonRuntime'
import { COMPOSER_MEDIA_PATTERN } from './composerSurface'
import { finishPostingEvidence, startPostingTrace } from './postingEvidence'
import {
  isMediaAttachmentReady,
  pollForReady,
  readinessAttempts,
  type MediaReadinessSnapshot
} from './postingReadiness'
import { postSubmitBucketLabel, sweepPostSubmitVerification } from './postSubmitVerification'
import {
  capturePublishBaseline,
  groupMyPostedContentUrl,
  publishContentFingerprint,
  type PublishBaseline
} from './publishVerification'
import {
  RobustComposerDetector,
  formatPublishCandidateDiagnostics,
  type RobustComposerHandle
} from './robustComposerDetector'

type PostingCode = NonNullable<PostingJobResult['code']>

const ACTION_SETTLE_MS = 850
const READINESS_POLL_MS = 250
const CONTENT_READY_TIMEOUT_MS = 3_000
const MEDIA_READY_TIMEOUT_MS = 20_000
const PUBLISH_READY_TIMEOUT_MS = 20_000

function failure(code: PostingCode, message: string): PostingJobResult {
  return {
    status: code === 'needs_login' || code === 'verification_required' ? 'needs_login' : 'failed',
    code,
    message
  }
}

function commonResult(result: FacebookCommonStepResult): PostingJobResult {
  return {
    status: result.status,
    ...(result.code ? { code: result.code } : {}),
    message: result.message,
    ...(result.sessionValidation ? { sessionValidation: result.sessionValidation } : {})
  }
}

function engineDiagnostic(job: PostingJobRequest, message: string): void {
  console.info(
    `[PAGE-AUTO posting-engine] run=${job.runId} item=${job.itemId} account=${job.accountId} group=${job.groupUid} ${message}`
  )
}

async function firstVisibleMatch(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const item = candidate.nth(index)
      if (await item.isVisible().catch(() => false)) return item
    }
  }
  return null
}

async function visibleCount(candidate: Locator): Promise<number> {
  const count = await candidate.count().catch(() => 0)
  let visible = 0
  for (let index = 0; index < count; index += 1) {
    if (await candidate.nth(index).isVisible().catch(() => false)) visible += 1
  }
  return visible
}

async function pollPage<T>(page: Page, timeoutMs: number, probe: () => Promise<T | null>): Promise<T | null> {
  return pollForReady(probe, {
    attempts: readinessAttempts(timeoutMs, READINESS_POLL_MS),
    intervalMs: READINESS_POLL_MS,
    sleep: (milliseconds) => page.waitForTimeout(milliseconds)
  })
}

async function settleAction(page: Page): Promise<void> {
  await page.waitForTimeout(ACTION_SETTLE_MS)
}

async function settlePage(page: Page, settings: BrowserSettings): Promise<void> {
  if (settings.pageSettleDelayMs > 0) await page.waitForTimeout(settings.pageSettleDelayMs)
}

function normalizeComposerText(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

async function composerContainsText(textbox: Locator, content: string): Promise<boolean> {
  const expected = publishContentFingerprint(content)
  if (!expected) return false
  let actualText = await textbox.innerText().catch(() => '')
  if (!actualText) actualText = await textbox.textContent().catch(() => null) ?? ''
  return normalizeComposerText(actualText).includes(expected)
}

function compactRuntimeDiagnostics(job: PostingJobRequest): string {
  const placement = job.browserPlacement
  if (!placement) return 'compact=off placement=none'
  return [
    'compact=on',
    `placement=${placement.width}x${placement.height}@${placement.x},${placement.y}`,
    `viewport=${placement.viewportWidth}x${placement.viewportHeight}`,
    `scale=${placement.contentScale}`
  ].join(' ')
}

export class GroupNavigator {
  constructor(private readonly page: Page, private readonly browser: BrowserSettings) {}

  async open(groupUid: string): Promise<PostingJobResult> {
    try {
      await this.page.goto(`https://www.facebook.com/groups/${encodeURIComponent(groupUid)}`, {
        waitUntil: 'domcontentloaded',
        timeout: this.browser.navigationTimeoutMs
      })
      await settlePage(this.page, this.browser)
    } catch (error) {
      return failure('group_navigation_failed', error instanceof Error ? error.message : String(error))
    }

    const access = await checkFacebookCommonAccess(this.page, 'sau khi mở Group')
    if (access.status !== 'success') return commonResult(access)

    const unavailable = this.page.getByText(/content isn't available|nội dung này hiện không hiển thị|this content isn't available/i).first()
    if (await unavailable.isVisible().catch(() => false)) return failure('group_unavailable', 'Group không khả dụng với session hiện tại.')
    return { status: 'success', message: 'Đã mở Group.' }
  }
}

// Compatibility export: runtime ownership now comes from RobustComposerDetector only.
export type ComposerHandle = RobustComposerHandle
export class ComposerDetector extends RobustComposerDetector {}

export class PostComposer {
  constructor(private readonly page: Page) {}

  private waitForContent(textbox: Locator, content: string): Promise<boolean | null> {
    return pollPage(this.page, CONTENT_READY_TIMEOUT_MS, async () => (
      await composerContainsText(textbox, content) ? true : null
    ))
  }

  async fill(textbox: Locator, content: string): Promise<PostingJobResult> {
    const normalized = content.trim()
    if (!normalized) return failure('no_content', 'Content Set không có nội dung hợp lệ cho job này.')

    try {
      await textbox.fill(normalized, { timeout: 8_000 }).catch(() => undefined)
      if (await this.waitForContent(textbox, normalized)) {
        await settleAction(this.page)
        return { status: 'success', message: 'Đã điền và xác nhận nội dung trong composer.' }
      }

      await textbox.click({ timeout: 10_000 })
      await this.page.waitForTimeout(300)
      await this.page.keyboard.press('Control+A').catch(() => undefined)
      await this.page.keyboard.press('Backspace').catch(() => undefined)
      await this.page.keyboard.insertText(normalized)
      await settleAction(this.page)

      if (!await this.waitForContent(textbox, normalized)) {
        return failure('content_failed', 'Composer đã mở nhưng nội dung chưa xuất hiện sau cả fill và keyboard fallback.')
      }
      return { status: 'success', message: 'Đã điền và xác nhận nội dung bằng keyboard fallback.' }
    } catch (error) {
      return failure('content_failed', error instanceof Error ? error.message : String(error))
    }
  }
}

export class MediaUploader {
  constructor(
    private readonly page: Page,
    private readonly composerDetector?: RobustComposerDetector
  ) {}

  private async currentContainer(fallback: Locator): Promise<Locator> {
    if (!this.composerDetector) return fallback
    const current = await this.composerDetector.resolve().catch(() => null)
    return current?.container ?? fallback
  }

  private async setInputFiles(container: Locator, imagePaths: string[]): Promise<boolean> {
    const current = await this.currentContainer(container)
    const localInput = current.locator('input[type="file"]').last()
    if (await localInput.count().catch(() => 0)) {
      await localInput.setInputFiles(imagePaths, { timeout: 30_000 })
      return true
    }

    const pageInput = this.page.locator('input[type="file"]').last()
    if (await pageInput.count().catch(() => 0)) {
      await pageInput.setInputFiles(imagePaths, { timeout: 30_000 })
      return true
    }
    return false
  }

  private async mediaSnapshot(container: Locator): Promise<MediaReadinessSnapshot> {
    const current = await this.currentContainer(container)
    const previews = current.locator('img[src^="blob:"], img[src*="scontent"], img[src*="fbcdn"]')
    const removeControls = current.getByRole('button', { name: /remove (photo|image)|xóa (ảnh|hình)|gỡ (ảnh|hình)/i })
    const busyMarkers = current.locator('[role="progressbar"], [aria-busy="true"]')
    const busyText = current.getByText(/uploading|processing|đang tải|đang xử lý/i)
    return {
      previewCount: await visibleCount(previews),
      removeControlCount: await visibleCount(removeControls),
      busyCount: await visibleCount(busyMarkers) + await visibleCount(busyText)
    }
  }

  private async waitForMediaReady(
    container: Locator,
    expectedCount: number,
    baseline: MediaReadinessSnapshot
  ): Promise<boolean> {
    const ready = await pollPage(this.page, MEDIA_READY_TIMEOUT_MS, async () => {
      const current = await this.mediaSnapshot(container)
      return isMediaAttachmentReady(baseline, current, expectedCount) ? true : null
    })
    if (!ready) return false
    await settleAction(this.page)
    return true
  }

  async upload(container: Locator, imagePaths: string[]): Promise<PostingJobResult> {
    if (imagePaths.length === 0) return { status: 'success', message: 'Job không có ảnh cần upload.' }

    try {
      const baseline = await this.mediaSnapshot(container)
      if (await this.setInputFiles(container, imagePaths)) {
        if (!await this.waitForMediaReady(container, imagePaths.length, baseline)) {
          return failure('media_failed', 'Đã chọn ảnh nhưng Facebook chưa render đủ media đã xử lý trong composer.')
        }
        return { status: 'success', message: `Đã chọn và xác nhận ${imagePaths.length} ảnh sẵn sàng.` }
      }

      const current = await this.currentContainer(container)
      const mediaButton = await firstVisibleMatch([
        current.getByRole('button', { name: /photo\s*\/?\s*video|photo|video|ảnh/i }),
        current.getByLabel(/photo\s*\/?\s*video|photo|video|ảnh/i),
        current.getByText(/photo\s*\/?\s*video|ảnh\s*\/?\s*video/i)
      ])
      if (!mediaButton) return failure('media_failed', 'Không tìm thấy control Photo/Video trong composer.')

      const chooserPromise = this.page.waitForEvent('filechooser', { timeout: 5_000 }).catch(() => null)
      await mediaButton.click({ timeout: 10_000 })
      await settleAction(this.page)
      const chooser = await chooserPromise
      if (chooser) {
        await chooser.setFiles(imagePaths)
        if (!await this.waitForMediaReady(container, imagePaths.length, baseline)) {
          return failure('media_failed', 'Đã chọn ảnh qua file chooser nhưng Facebook chưa render đủ media đã xử lý.')
        }
        return { status: 'success', message: `Đã chọn và xác nhận ${imagePaths.length} ảnh qua file chooser.` }
      }

      if (!await this.setInputFiles(container, imagePaths)) {
        return failure('media_failed', 'Đã mở Photo/Video nhưng không tìm thấy file chooser hoặc file input.')
      }
      if (!await this.waitForMediaReady(container, imagePaths.length, baseline)) {
        return failure('media_failed', 'Đã chọn ảnh sau khi mở Photo/Video nhưng Facebook chưa render đủ media đã xử lý.')
      }
      return { status: 'success', message: `Đã chọn và xác nhận ${imagePaths.length} ảnh sau khi mở Photo/Video.` }
    } catch (error) {
      return failure('media_failed', error instanceof Error ? error.message : String(error))
    }
  }
}

export class PublishAction {
  constructor(
    private readonly page: Page,
    private readonly composerDetector?: RobustComposerDetector
  ) {}

  private async fallbackCandidate(container: Locator): Promise<Locator | null> {
    return firstVisibleMatch([
      container.getByRole('button', { name: /^(post|đăng)$/i }),
      container.locator('[aria-label="Post" i], [aria-label="Đăng" i]')
    ])
  }

  async click(container: Locator): Promise<PostingJobResult> {
    try {
      let sawVisibleButton = false
      let lastDiagnostics = 'strategy=legacy-fallback'
      const button = await pollPage(this.page, PUBLISH_READY_TIMEOUT_MS, async () => {
        if (this.composerDetector) {
          const resolution = await this.composerDetector.publishCandidates()
          lastDiagnostics = formatPublishCandidateDiagnostics(resolution)
          const counts = resolution.counts
          sawVisibleButton ||= counts.scopedRoleVisible > 0
            || counts.scopedAriaVisible > 0
            || counts.pageRoleVisible > 0
            || counts.pageAriaVisible > 0
          return resolution.button
        }

        const candidate = await this.fallbackCandidate(container)
        if (!candidate) return null
        sawVisibleButton = true
        return await candidate.isEnabled().catch(() => false) ? candidate : null
      })

      if (!button) {
        return failure(
          'publish_action_failed',
          `${sawVisibleButton
            ? 'Nút Đăng/Post đã xuất hiện nhưng không có candidate duy nhất và sẵn sàng để click.'
            : 'Không tìm thấy nút Đăng/Post thuộc composer hiện tại.'} ${lastDiagnostics}`
        )
      }

      await settleAction(this.page)
      if (!await button.isEnabled().catch(() => false)) {
        return failure('publish_action_failed', `Nút Đăng/Post vừa chuyển về trạng thái chưa sẵn sàng trước khi click. ${lastDiagnostics}`)
      }
      await button.click({ timeout: 15_000 })
      await settleAction(this.page)
      return { status: 'success', message: 'Đã gửi hành động publish; đang chờ xác minh kết quả.' }
    } catch (error) {
      return failure('publish_action_failed', error instanceof Error ? error.message : String(error))
    }
  }
}

export const contentFingerprint = publishContentFingerprint

export class PublishResultDetector {
  private readonly verificationUrl: string

  constructor(
    private readonly page: Page,
    private readonly browser: BrowserSettings,
    private readonly groupUid: string
  ) {
    this.verificationUrl = groupMyPostedContentUrl(groupUid)
  }

  async captureBaseline(): Promise<PublishBaseline> {
    let verificationPage: Page | null = null
    try {
      verificationPage = await this.page.context().newPage()
      verificationPage.setDefaultNavigationTimeout(this.browser.navigationTimeoutMs)
      await verificationPage.goto(this.verificationUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.browser.navigationTimeoutMs
      })
      await settlePage(verificationPage, this.browser)
      return await capturePublishBaseline(verificationPage)
    } catch {
      return capturePublishBaseline(this.page)
    } finally {
      await verificationPage?.close().catch(() => undefined)
    }
  }

  async detect(content: string, baseline: PublishBaseline): Promise<PostingJobResult> {
    try {
      const sweep = await sweepPostSubmitVerification(
        this.page,
        this.browser,
        this.groupUid,
        content,
        baseline
      )
      const route = 'Đã đăng → Đang chờ duyệt → Bị từ chối → Bị gỡ → Đã đăng'
      const endedAtPosted = sweep.finalUrl.includes('/my_posted_content')
      const navigationNote = sweep.navigationErrors > 0
        ? ` Có ${sweep.navigationErrors} trang kiểm tra không mở được.`
        : ''
      const finalNote = endedAtPosted
        ? ' Browser đang dừng tại my_posted_content.'
        : ' Không thể giữ browser ở my_posted_content do điều hướng Facebook.'

      if (sweep.evidence) {
        const publishedUrl = sweep.evidence.publishedUrl ?? undefined
        return {
          status: 'success',
          message: `Facebook đã nhận thao tác Đăng; xác nhận thấy bài ở mục ${postSubmitBucketLabel(sweep.evidence.bucket)}. Đã quét ${route}, cách nhau 2 giây.${navigationNote}${finalNote}`,
          ...(publishedUrl ? { publishedUrl } : {})
        }
      }

      return {
        status: 'success',
        message: `Facebook đã nhận thao tác Đăng; quét ${route}, cách nhau 2 giây nhưng chưa thấy bài. Không retry Group để tránh đăng trùng và vẫn tiếp tục Bài/lượt.${navigationNote}${finalNote}`
      }
    } catch (error) {
      return {
        status: 'success',
        message: `Facebook đã nhận thao tác Đăng; bước xác minh bổ sung gặp lỗi (${error instanceof Error ? error.message : String(error)}). Không retry Group để tránh đăng trùng và vẫn tiếp tục Bài/lượt.`
      }
    }
  }
}

export async function executePostingJob(job: PostingJobRequest): Promise<PostingJobResult> {
  let runtime: FacebookCommonRuntime | null = null
  let page: Page | null = null
  let traceStarted = false

  const finish = async (result: PostingJobResult): Promise<PostingJobResult> => {
    let enriched = result
    const metadata = runtime?.metadata()
    if (metadata?.sessionValidated && !enriched.sessionValidation) {
      enriched = {
        ...enriched,
        sessionValidation: {
          phase: 'before_run',
          state: 'valid',
          message: 'Session Facebook đã được xác minh/phục hồi trước khi thực thi bài đăng.'
        }
      }
    }
    if (metadata?.accountName && !enriched.accountName) enriched = { ...enriched, accountName: metadata.accountName }
    if (metadata?.sessionCookie && !enriched.sessionCookie) enriched = { ...enriched, sessionCookie: metadata.sessionCookie }
    return page ? finishPostingEvidence(page, job, enriched, traceStarted) : enriched
  }

  try {
    const opened = await FacebookCommonRuntime.open({
      profileDirectory: job.profileDirectory,
      pageUid: job.pageUid,
      browser: job.browser,
      session: job.session,
      network: job.network,
      sessionAccount: job.sessionAccount,
      ...(job.userAgent ? { userAgent: job.userAgent } : {}),
      ...(job.proxy ? { proxy: job.proxy } : {}),
      diagnostic: (message) => engineDiagnostic(job, message)
    })
    if (opened.status !== 'ready') return commonResult(opened.result)

    runtime = opened.runtime
    page = runtime.page
    traceStarted = await startPostingTrace(runtime.context, job)
    engineDiagnostic(job, compactRuntimeDiagnostics(job))

    const prepared = await runtime.prepareForPage()
    if (prepared.status !== 'success') return finish(commonResult(prepared))

    await runtime.pace('page-to-group')
    const navigation = await new GroupNavigator(page, runtime.browser).open(job.groupUid)
    if (navigation.status !== 'success') return finish(navigation)
    engineDiagnostic(job, 'state=group_surface ready')

    await runtime.pace('group-to-composer')
    engineDiagnostic(job, `material ready contentLength=${job.content.trim().length} imageCount=${job.imagePaths.length}`)
    const resultDetector = new PublishResultDetector(page, runtime.browser, job.groupUid)
    const publishBaseline = await resultDetector.captureBaseline()
    engineDiagnostic(job, `verification baseline captured=${publishBaseline.captured} posts=${publishBaseline.postKeys.size}`)

    const composerDetector = new RobustComposerDetector(page)
    const composer = await composerDetector.open()
    if (!composer) {
      const diagnostics = await composerDetector.diagnostics()
      engineDiagnostic(job, `composer detection failed ${diagnostics}`)
      return finish(failure('composer_not_found', `Không phát hiện được editor sẵn sàng trong Create post surface sau thời gian chờ. ${diagnostics}`))
    }
    engineDiagnostic(job, `state=editor_ready ${await composerDetector.selectionDiagnostics(composer)}`)

    const contentResult = await new PostComposer(page).fill(composer.textbox, job.content)
    if (contentResult.status !== 'success') return finish(contentResult)
    engineDiagnostic(job, `state=content_ready length=${job.content.trim().length}`)
    engineDiagnostic(job, `publish candidates before media ${await composerDetector.publishDiagnostics()}`)

    const mediaResult = await new MediaUploader(page, composerDetector).upload(composer.container, job.imagePaths)
    if (mediaResult.status !== 'success') return finish(mediaResult)
    engineDiagnostic(job, `state=media_ready count=${job.imagePaths.length}`)
    engineDiagnostic(job, `publish candidates after media ${await composerDetector.publishDiagnostics()}`)

    await runtime.pace('media-to-publish')
    const publishResult = await new PublishAction(page, composerDetector).click(composer.container)
    if (publishResult.status !== 'success') return finish(publishResult)
    engineDiagnostic(job, 'state=publish_click sent; sweeping posted>pending>declined>removed>posted')

    const confirmed = await resultDetector.detect(job.content, publishBaseline)
    if (confirmed.status !== 'success' || !job.session.validateAfterRun) return finish(confirmed)

    const after = await runtime.validateAfterTask()
    return finish({
      ...confirmed,
      ...(after.messageSuffix ? { message: `${confirmed.message} ${after.messageSuffix}` } : {}),
      sessionValidation: after.sessionValidation
    })
  } catch (error) {
    return finish(failure('unexpected_error', error instanceof Error ? error.message : String(error)))
  } finally {
    await runtime?.close()
  }
}
