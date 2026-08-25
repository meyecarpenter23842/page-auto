import { chromium, type BrowserContext, type Locator, type Page } from 'playwright-core'
import type { BrowserSettings } from '../../../shared/appSettings'
import type { PostingJobRequest, PostingJobResult } from '../../../shared/posting'
import { inspectFacebookAccountIdentity } from '../facebookAccountIdentity'
import { readFacebookDisplayName } from '../facebookProfileInfo'
import {
  bootstrapFacebookSession,
  validateFacebookSession,
  type FacebookSessionResult
} from '../facebookSession'
import { applyBrowserContextSettings, buildBrowserLaunchOptions, waitForBrowserStartupDelay } from '../browserRuntime'
import { effectiveNavigationTimeoutMs, probeFacebookThroughProxy } from '../proxyPreflight'
import {
  COMPOSER_MEDIA_PATTERN,
  COMPOSER_TITLE_PATTERN,
  COMPOSER_TRIGGER_PATTERN,
  formatComposerDiagnostics
} from './composerSurface'
import { PageIdentitySwitcher } from './pageIdentitySwitcher'
import { detectFacebookAccessBlock } from './pageState'
import { finishPostingEvidence, startPostingTrace } from './postingEvidence'
import {
  isMediaAttachmentReady,
  pollForReady,
  readinessAttempts,
  type MediaReadinessSnapshot
} from './postingReadiness'
import {
  capturePublishBaseline,
  findNewPublishedPost,
  groupMyPostedContentUrl,
  publishContentFingerprint,
  type PublishBaseline
} from './publishVerification'

type PostingCode = NonNullable<PostingJobResult['code']>

const ACTION_SETTLE_MS = 850
const READINESS_POLL_MS = 250
const COMPOSER_READY_TIMEOUT_MS = 18_000
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

function beforeRunSessionFailure(session: FacebookSessionResult): PostingJobResult {
  const verificationRequired = session.reason === 'checkpoint'
  return {
    status: 'needs_login',
    code: verificationRequired ? 'verification_required' : 'needs_login',
    message: session.message,
    sessionValidation: {
      phase: 'before_run',
      state: verificationRequired ? 'verification_required' : 'needs_login',
      message: session.message
    }
  }
}

function beforeRunIdentityFailure(message: string): PostingJobResult {
  return {
    status: 'needs_login',
    code: 'needs_login',
    message,
    sessionValidation: {
      phase: 'before_run',
      state: 'needs_login',
      message
    }
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

async function visibleCountAcross(candidates: Locator[]): Promise<number> {
  let total = 0
  for (const candidate of candidates) total += await visibleCount(candidate)
  return total
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

    const blocked = await detectFacebookAccessBlock(this.page)
    if (blocked === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại.')
    if (blocked === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh thủ công.')
    const unavailable = this.page.getByText(/content isn't available|nội dung này hiện không hiển thị|this content isn't available/i).first()
    if (await unavailable.isVisible().catch(() => false)) return failure('group_unavailable', 'Group không khả dụng với session hiện tại.')
    return { status: 'success', message: 'Đã mở Group.' }
  }
}

export interface ComposerHandle { container: Locator; textbox: Locator }

export class ComposerDetector {
  constructor(private readonly page: Page) {}

  private findTextbox(root: Locator): Promise<Locator | null> {
    return firstVisibleMatch([
      root.locator('[role="textbox"][contenteditable="true"]'),
      root.locator('[contenteditable="true"][data-lexical-editor="true"]'),
      root.locator('div[contenteditable="true"]'),
      root.locator('[contenteditable="true"]'),
      root.getByRole('textbox')
    ])
  }

  private triggerCandidates(): Locator[] {
    return [
      this.page.getByRole('button', { name: COMPOSER_TRIGGER_PATTERN }),
      this.page.locator('[role="button"]').filter({ hasText: COMPOSER_TRIGGER_PATTERN }),
      this.page.locator([
        '[role="button"][aria-label*="create post" i]',
        '[role="button"][aria-label*="create a public post" i]',
        '[role="button"][aria-label*="write something" i]',
        '[role="button"][aria-label*="tạo bài viết" i]',
        '[role="button"][aria-label*="bạn viết" i]',
        '[role="button"][aria-label*="viết gì" i]'
      ].join(', ')),
      this.page.getByText(COMPOSER_TRIGGER_PATTERN)
    ]
  }

  private async isComposerSurface(dialog: Locator): Promise<boolean> {
    const titleOrPlaceholder = await firstVisibleMatch([
      dialog.getByRole('heading', { name: COMPOSER_TITLE_PATTERN }),
      dialog.getByText(COMPOSER_TRIGGER_PATTERN)
    ])
    if (titleOrPlaceholder) return true

    const publishButton = await firstVisibleMatch([
      dialog.getByRole('button', { name: /^(post|đăng)$/i })
    ])
    if (!publishButton) return false

    return Boolean(await firstVisibleMatch([
      dialog.getByRole('button', { name: COMPOSER_MEDIA_PATTERN }),
      dialog.getByText(COMPOSER_MEDIA_PATTERN)
    ]))
  }

  private async findComposerDialog(allowTextboxFallback = false): Promise<Locator | null> {
    const dialogs = this.page.locator('[role="dialog"], [aria-modal="true"]')
    const count = await dialogs.count().catch(() => 0)
    for (let index = count - 1; index >= 0; index -= 1) {
      const dialog = dialogs.nth(index)
      if (!await dialog.isVisible().catch(() => false)) continue
      if (await this.isComposerSurface(dialog)) return dialog
      if (!allowTextboxFallback) continue

      const textbox = await this.findTextbox(dialog)
      if (!textbox) continue
      const publishButton = await firstVisibleMatch([
        dialog.getByRole('button', { name: /^(post|đăng)$/i })
      ])
      const mediaControl = await firstVisibleMatch([
        dialog.getByRole('button', { name: COMPOSER_MEDIA_PATTERN }),
        dialog.getByLabel(COMPOSER_MEDIA_PATTERN),
        dialog.getByText(COMPOSER_MEDIA_PATTERN)
      ])
      const fileInputCount = await dialog.locator('input[type="file"]').count().catch(() => 0)
      if (publishButton || mediaControl || fileInputCount > 0) return dialog
    }
    return null
  }

  private async findOpenComposer(allowTextboxFallback = false): Promise<ComposerHandle | null> {
    const dialog = await this.findComposerDialog(allowTextboxFallback)
    if (!dialog) return null
    const textbox = await this.findTextbox(dialog)
    return textbox ? { container: dialog, textbox } : null
  }

  private async focusComposerPlaceholder(): Promise<boolean> {
    const dialog = await this.findComposerDialog(true)
    if (!dialog) return false
    const placeholder = await firstVisibleMatch([
      dialog.getByText(COMPOSER_TRIGGER_PATTERN),
      dialog.locator('[data-lexical-editor="true"]'),
      dialog.locator('[role="textbox"][contenteditable="true"]'),
      dialog.locator('[contenteditable="true"]')
    ])
    if (!placeholder) return false
    return placeholder.click({ timeout: 5_000 }).then(() => true).catch(() => false)
  }

  async diagnostics(): Promise<string> {
    const dialogs = this.page.locator('[role="dialog"], [aria-modal="true"]')
    const textboxes = this.page.locator('[role="textbox"], [contenteditable="true"]')
    const publishButtons = this.page.getByRole('button', { name: /^(post|đăng)$/i })
    return formatComposerDiagnostics({
      dialogCount: await visibleCount(dialogs),
      textboxCount: await visibleCount(textboxes),
      triggerCount: await visibleCountAcross(this.triggerCandidates()),
      publishButtonCount: await visibleCount(publishButtons),
      fileInputCount: await this.page.locator('input[type="file"]').count().catch(() => 0),
      url: this.page.url()
    })
  }

  async open(): Promise<ComposerHandle | null> {
    const existing = await this.findOpenComposer(true)
    if (existing) return existing

    if (!await this.findComposerDialog(true)) {
      const trigger = await firstVisibleMatch(this.triggerCandidates())
      if (!trigger) return null
      if (!await trigger.click({ timeout: 15_000 }).then(() => true).catch(() => false)) return null
      await settleAction(this.page)
    }

    let probeCount = 0
    return pollPage(this.page, COMPOSER_READY_TIMEOUT_MS, async () => {
      const handle = await this.findOpenComposer(true)
      if (handle) return handle

      probeCount += 1
      if (probeCount === 6 || (probeCount > 6 && (probeCount - 6) % 8 === 0)) {
        if (await this.focusComposerPlaceholder()) await settleAction(this.page)
      }
      return null
    })
  }
}

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
  constructor(private readonly page: Page) {}

  private async setInputFiles(container: Locator, imagePaths: string[]): Promise<boolean> {
    const localInput = container.locator('input[type="file"]').last()
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
    const previews = container.locator('img[src^="blob:"], img[src*="scontent"], img[src*="fbcdn"]')
    const removeControls = container.getByRole('button', { name: /remove (photo|image)|xóa (ảnh|hình)|gỡ (ảnh|hình)/i })
    const busyMarkers = container.locator('[role="progressbar"], [aria-busy="true"]')
    const busyText = container.getByText(/uploading|processing|đang tải|đang xử lý/i)
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

      const mediaButton = await firstVisibleMatch([
        container.getByRole('button', { name: /photo\s*\/?\s*video|photo|video|ảnh/i }),
        container.getByLabel(/photo\s*\/?\s*video|photo|video|ảnh/i),
        container.getByText(/photo\s*\/?\s*video|ảnh\s*\/?\s*video/i)
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
  constructor(private readonly page: Page) {}

  async click(container: Locator): Promise<PostingJobResult> {
    try {
      let sawVisibleButton = false
      const button = await pollPage(this.page, PUBLISH_READY_TIMEOUT_MS, async () => {
        const candidate = await firstVisibleMatch([
          container.getByRole('button', { name: /^(post|đăng)$/i })
        ])
        if (!candidate) return null
        sawVisibleButton = true
        return await candidate.isEnabled().catch(() => false) ? candidate : null
      })

      if (!button) {
        return failure(
          'publish_action_failed',
          sawVisibleButton
            ? 'Nút Đăng/Post vẫn chưa sẵn sàng sau thời gian chờ Facebook xử lý composer/media.'
            : 'Không tìm thấy nút Đăng/Post trong composer.'
        )
      }

      await settleAction(this.page)
      if (!await button.isEnabled().catch(() => false)) {
        return failure('publish_action_failed', 'Nút Đăng/Post vừa chuyển về trạng thái chưa sẵn sàng trước khi click.')
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
    groupUid: string
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

  private async openVerificationPage(): Promise<PostingJobResult | null> {
    try {
      await this.page.goto(this.verificationUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.browser.navigationTimeoutMs
      })
      await settlePage(this.page, this.browser)
    } catch (error) {
      return failure('publish_unconfirmed', `Không mở được trang bài đã đăng để xác minh: ${error instanceof Error ? error.message : String(error)}`)
    }

    const blocked = await detectFacebookAccessBlock(this.page)
    if (blocked === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại khi xác minh bài đã đăng.')
    if (blocked === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh khi kiểm tra bài đã đăng.')
    return null
  }

  async detect(container: Locator, content: string, baseline: PublishBaseline): Promise<PostingJobResult> {
    const deadline = Date.now() + 45_000
    let verificationOpened = false
    let nextRefreshAt = 0
    let composerClosedAt: number | null = null
    let sawSuccessToast = false

    while (Date.now() < deadline) {
      const blocked = await detectFacebookAccessBlock(this.page)
      if (blocked === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại sau publish.')
      if (blocked === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh sau publish.')

      const pendingToast = this.page.getByText(
        /your post.*(?:submitted for approval|pending approval)|post.*(?:submitted for approval|pending approval)|bài viết của bạn.*(?:đã được gửi.*phê duyệt|đang chờ phê duyệt)/i
      ).first()
      if (await pendingToast.isVisible().catch(() => false)) {
        return {
          status: 'success',
          message: 'Facebook xác nhận bài đã được gửi và đang chờ phê duyệt.'
        }
      }

      const successToast = this.page.getByText(
        /your post is now published|your post was shared|post published|post shared|bài viết của bạn.*(?:đã được đăng|đã được chia sẻ|đã chia sẻ)/i
      ).first()
      if (await successToast.isVisible().catch(() => false)) sawSuccessToast = true

      const composerClosed = !await container.isVisible().catch(() => false)
      if (composerClosed && composerClosedAt === null) composerClosedAt = Date.now()
      if (!composerClosed) composerClosedAt = null

      if (composerClosed && sawSuccessToast) {
        return {
          status: 'success',
          message: 'Facebook xác nhận publish thành công và composer đã đóng.'
        }
      }

      if (composerClosed && !verificationOpened && composerClosedAt !== null && Date.now() - composerClosedAt >= 2_000) {
        const verificationFailure = await this.openVerificationPage()
        if (verificationFailure) return verificationFailure
        verificationOpened = true
        nextRefreshAt = Date.now() + 3_000
      }

      if (verificationOpened) {
        const publishedPost = await findNewPublishedPost(this.page, content, baseline, sawSuccessToast).catch(() => null)
        if (publishedPost) {
          return {
            status: 'success',
            message: sawSuccessToast
              ? 'Đã xác minh post mới theo Facebook success signal và post key mới trong đúng Group.'
              : 'Đã xác minh post mới theo content + post key mới trong my_posted_content của đúng Group.',
            publishedUrl: publishedPost.publishedUrl
          }
        }

        if (Date.now() >= nextRefreshAt) {
          await this.page.reload({ waitUntil: 'domcontentloaded', timeout: this.browser.navigationTimeoutMs }).catch(() => undefined)
          await settlePage(this.page, this.browser)
          nextRefreshAt = Date.now() + 3_000
        }
      }

      await this.page.waitForTimeout(1_000)
    }
    return failure(
      'publish_unconfirmed',
      sawSuccessToast
        ? 'Facebook có success signal nhưng chưa có đủ bằng chứng ổn định sau publish; run item chưa được consume để tránh đăng trùng.'
        : 'Đã bấm Đăng nhưng chưa xác minh được success signal hoặc post mới trong đúng Group; run item không được consume success.'
    )
  }
}

export async function executePostingJob(job: PostingJobRequest): Promise<PostingJobResult> {
  let context: BrowserContext | null = null
  let page: Page | null = null
  let lifetimeTimer: NodeJS.Timeout | null = null
  let traceStarted = false
  let accountName: string | null = job.sessionAccount.name?.trim() || null
  let sessionCookie: string | null = null
  let sessionValidated = false

  try {
    await waitForBrowserStartupDelay(job.browser)
    context = await chromium.launchPersistentContext(job.profileDirectory, {
      ...buildBrowserLaunchOptions(job.browser),
      viewport: null,
      ...(job.userAgent ? { userAgent: job.userAgent } : {}),
      ...(job.proxy ? { proxy: { server: job.proxy.server, ...(job.proxy.username ? { username: job.proxy.username } : {}), ...(job.proxy.password ? { password: job.proxy.password } : {}) } } : {})
    })
    await applyBrowserContextSettings(context, job.browser)
    lifetimeTimer = setTimeout(() => { void context?.close().catch(() => undefined) }, job.browser.maxLifetimeMinutes * 60_000)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const profileInUse = /processsingleton|profile.*in use|user data directory is already in use/i.test(message)
    return failure(profileInUse ? 'profile_in_use' : 'browser_launch_failed', profileInUse ? 'Browser profile đang được mở ở process khác.' : message)
  }

  const finish = async (result: PostingJobResult): Promise<PostingJobResult> => {
    let enriched = result
    if (sessionValidated && !enriched.sessionValidation) {
      enriched = {
        ...enriched,
        sessionValidation: {
          phase: 'before_run',
          state: 'valid',
          message: 'Session Facebook đã được xác minh/phục hồi trước khi thực thi bài đăng.'
        }
      }
    }
    if (accountName && !enriched.accountName) enriched = { ...enriched, accountName }
    if (sessionCookie && !enriched.sessionCookie) enriched = { ...enriched, sessionCookie }
    return page ? finishPostingEvidence(page, job, enriched, traceStarted) : enriched
  }

  try {
    page = context.pages()[0] ?? await context.newPage()
    const runtimeBrowser: BrowserSettings = {
      ...job.browser,
      navigationTimeoutMs: effectiveNavigationTimeoutMs(job.browser.navigationTimeoutMs, job.network.networkTimeoutMs)
    }
    page.setDefaultTimeout(job.network.networkTimeoutMs)
    page.setDefaultNavigationTimeout(runtimeBrowser.navigationTimeoutMs)
    traceStarted = await startPostingTrace(context, job)

    if (job.proxy && job.network.checkProxyBeforeRun) {
      const proxyCheck = await probeFacebookThroughProxy(page, job.network)
      if (proxyCheck.status === 'failed') return finish(failure('proxy_unavailable', proxyCheck.message))
    }

    const session = await bootstrapFacebookSession(context, page, job.sessionAccount, job.session.facebookLocale)
    if (session.status !== 'valid') return finish(beforeRunSessionFailure(session))
    sessionValidated = true
    sessionCookie = session.cookie

    const accountIdentity = await inspectFacebookAccountIdentity(context, job.sessionAccount.uid)
    if (accountIdentity.state === 'mismatch' || accountIdentity.state === 'missing') {
      sessionValidated = false
      return finish(beforeRunIdentityFailure(accountIdentity.message))
    }
    if (!accountName && accountIdentity.state === 'match') {
      accountName = await readFacebookDisplayName(page).catch(() => null)
    }

    const identity = await new PageIdentitySwitcher(page, context, runtimeBrowser).switchTo(job.pageUid)
    if (identity.status !== 'success') return finish(identity)
    const navigation = await new GroupNavigator(page, runtimeBrowser).open(job.groupUid)
    if (navigation.status !== 'success') return finish(navigation)

    engineDiagnostic(job, `material ready contentLength=${job.content.trim().length} imageCount=${job.imagePaths.length}`)
    const resultDetector = new PublishResultDetector(page, runtimeBrowser, job.groupUid)
    const publishBaseline = await resultDetector.captureBaseline()
    engineDiagnostic(job, `verification baseline captured=${publishBaseline.captured} posts=${publishBaseline.postKeys.size}`)

    const composerDetector = new ComposerDetector(page)
    const composer = await composerDetector.open()
    if (!composer) {
      const diagnostics = await composerDetector.diagnostics()
      engineDiagnostic(job, `composer detection failed ${diagnostics}`)
      return finish(failure('composer_not_found', `Không phát hiện được editor sẵn sàng trong modal Create post sau thời gian chờ. ${diagnostics}`))
    }
    engineDiagnostic(job, 'composer editor ready')

    const contentResult = await new PostComposer(page).fill(composer.textbox, job.content)
    if (contentResult.status !== 'success') return finish(contentResult)
    engineDiagnostic(job, `content confirmed length=${job.content.trim().length}`)

    const mediaResult = await new MediaUploader(page).upload(composer.container, job.imagePaths)
    if (mediaResult.status !== 'success') return finish(mediaResult)
    engineDiagnostic(job, `media ready count=${job.imagePaths.length}`)

    const publishResult = await new PublishAction(page).click(composer.container)
    if (publishResult.status !== 'success') return finish(publishResult)
    engineDiagnostic(job, 'publish clicked after readiness wait; verifying my_posted_content')

    const confirmed = await resultDetector.detect(composer.container, job.content, publishBaseline)
    if (confirmed.status !== 'success' || !job.session.validateAfterRun) return finish(confirmed)

    const afterSession = await validateFacebookSession(context, page)
    if (afterSession.state === 'valid') {
      return finish({
        ...confirmed,
        sessionValidation: { phase: 'after_run', state: 'valid', message: afterSession.message }
      })
    }

    if (afterSession.state === 'needs_login') {
      const recovered = await bootstrapFacebookSession(context, page, job.sessionAccount, job.session.facebookLocale)
      if (recovered.status === 'valid') {
        const recoveredIdentity = await inspectFacebookAccountIdentity(context, job.sessionAccount.uid)
        if (recoveredIdentity.state === 'match' || recoveredIdentity.state === 'unverifiable') {
          sessionCookie = recovered.cookie ?? sessionCookie
          sessionValidated = true
          if (!accountName && recoveredIdentity.state === 'match') {
            accountName = await readFacebookDisplayName(page).catch(() => null)
          }
          return finish({
            ...confirmed,
            message: `${confirmed.message} Session vừa hết đã được tự đăng nhập lại.`,
            sessionValidation: { phase: 'after_run', state: 'valid', message: 'Đã tự phục hồi session sau publish.' }
          })
        }
      }

      sessionValidated = false
      const verificationRequired = recovered.reason === 'checkpoint'
      return finish({
        ...confirmed,
        message: `${confirmed.message} ${recovered.message}`,
        sessionValidation: {
          phase: 'after_run',
          state: verificationRequired ? 'verification_required' : 'needs_login',
          message: recovered.message
        }
      })
    }

    sessionValidated = false
    return finish({
      ...confirmed,
      message: `${confirmed.message} ${afterSession.message}`,
      sessionValidation: { phase: 'after_run', state: afterSession.state, message: afterSession.message }
    })
  } catch (error) {
    return finish(failure('unexpected_error', error instanceof Error ? error.message : String(error)))
  } finally {
    if (lifetimeTimer) clearTimeout(lifetimeTimer)
    if (context) {
      if (job.browser.closeDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, job.browser.closeDelayMs))
      await context.close().catch(() => undefined)
    }
  }
}
