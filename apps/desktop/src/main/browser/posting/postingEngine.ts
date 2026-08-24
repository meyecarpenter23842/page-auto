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
import { activeFacebookProfileId, detectFacebookAccessBlock } from './pageState'
import { finishPostingEvidence, startPostingTrace } from './postingEvidence'
import {
  capturePublishBaseline,
  findNewPublishedPost,
  publishContentFingerprint,
  type PublishBaseline
} from './publishVerification'

type PostingCode = NonNullable<PostingJobResult['code']>

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

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function settlePage(page: Page, settings: BrowserSettings): Promise<void> {
  if (settings.pageSettleDelayMs > 0) await page.waitForTimeout(settings.pageSettleDelayMs)
}

export class PageIdentitySwitcher {
  constructor(private readonly page: Page, private readonly context: BrowserContext, private readonly browser: BrowserSettings) {}

  async switchTo(pageUid: string): Promise<PostingJobResult> {
    try {
      await this.page.goto(`https://www.facebook.com/${encodeURIComponent(pageUid)}`, {
        waitUntil: 'domcontentloaded',
        timeout: this.browser.navigationTimeoutMs
      })
      await settlePage(this.page, this.browser)
    } catch (error) {
      return failure('page_navigation_failed', error instanceof Error ? error.message : String(error))
    }

    const blocked = await detectFacebookAccessBlock(this.page)
    if (blocked === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại.')
    if (blocked === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh thủ công.')
    if ((await activeFacebookProfileId(this.context)) === pageUid) return { status: 'success', message: 'Page identity đã active.' }

    const switchControl = await firstVisible([
      this.page.getByRole('button', { name: /switch now|chuyển ngay/i }).first(),
      this.page.getByRole('button', { name: /switch into|chuyển sang/i }).first(),
      this.page.getByText(/switch into this page|chuyển sang trang này/i).first()
    ])
    if (!switchControl) return failure('page_identity_unconfirmed', 'Không tìm thấy control chuyển sang Page và không xác minh được Page identity hiện tại.')

    try {
      await switchControl.click({ timeout: Math.min(this.browser.navigationTimeoutMs, 15_000) })
      await settlePage(this.page, this.browser)
    } catch (error) {
      return failure('page_identity_unconfirmed', error instanceof Error ? error.message : String(error))
    }

    const afterSwitchBlock = await detectFacebookAccessBlock(this.page)
    if (afterSwitchBlock === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại sau khi switch Page.')
    if (afterSwitchBlock === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh sau khi switch Page.')
    if ((await activeFacebookProfileId(this.context)) !== pageUid) return failure('page_identity_unconfirmed', 'Đã bấm switch nhưng chưa xác minh được Page identity bằng session hiện tại.')
    return { status: 'success', message: 'Đã chuyển sang Page identity.' }
  }
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

  async open(): Promise<ComposerHandle | null> {
    const trigger = await firstVisible([
      this.page.getByRole('button', { name: /write something|bạn viết gì|create post|tạo bài viết/i }).first(),
      this.page.getByText(/write something|bạn viết gì/i).first()
    ])
    if (trigger) await trigger.click({ timeout: 15_000 }).catch(() => undefined)

    const dialogs = this.page.getByRole('dialog')
    const dialogCount = await dialogs.count()
    for (let index = dialogCount - 1; index >= 0; index -= 1) {
      const dialog = dialogs.nth(index)
      if (!await dialog.isVisible().catch(() => false)) continue
      const textbox = dialog.locator('[role="textbox"][contenteditable="true"]').first()
      if (await textbox.isVisible().catch(() => false)) return { container: dialog, textbox }
    }

    const textbox = this.page.locator('[role="textbox"][contenteditable="true"]').first()
    if (!await textbox.isVisible().catch(() => false)) return null
    const container = textbox.locator('xpath=ancestor::*[@role="dialog"][1]')
    return await container.isVisible().catch(() => false) ? { container, textbox } : null
  }
}

export class PostComposer {
  async fill(textbox: Locator, content: string): Promise<PostingJobResult> {
    const normalized = content.trim()
    if (!normalized) return failure('no_content', 'Content Set không có nội dung hợp lệ cho job này.')
    try {
      await textbox.fill(normalized, { timeout: 15_000 })
      return { status: 'success', message: 'Đã điền nội dung.' }
    } catch (error) {
      return failure('content_failed', error instanceof Error ? error.message : String(error))
    }
  }
}

export class MediaUploader {
  async upload(container: Locator, imagePaths: string[]): Promise<PostingJobResult> {
    if (imagePaths.length === 0) return { status: 'success', message: 'Job không có ảnh cần upload.' }
    try {
      let input = container.locator('input[type="file"]').first()
      if (await input.count() === 0) {
        const mediaButton = container.getByRole('button', { name: /photo|video|ảnh/i }).first()
        if (await mediaButton.isVisible().catch(() => false)) {
          await mediaButton.click({ timeout: 10_000 }).catch(() => undefined)
          input = container.locator('input[type="file"]').first()
        }
      }
      if (await input.count() === 0) return failure('media_failed', 'Không tìm thấy file input trong composer.')
      await input.setInputFiles(imagePaths, { timeout: 30_000 })
      return { status: 'success', message: `Đã chọn ${imagePaths.length} ảnh.` }
    } catch (error) {
      return failure('media_failed', error instanceof Error ? error.message : String(error))
    }
  }
}

export class PublishAction {
  async click(container: Locator): Promise<PostingJobResult> {
    try {
      const button = container.getByRole('button', { name: /^(post|đăng)$/i }).last()
      if (!await button.isVisible().catch(() => false)) return failure('publish_action_failed', 'Không tìm thấy nút Đăng/Post trong composer.')
      if (!await button.isEnabled().catch(() => false)) return failure('publish_action_failed', 'Nút Đăng/Post chưa sẵn sàng.')
      await button.click({ timeout: 15_000 })
      return { status: 'success', message: 'Đã gửi hành động publish; đang chờ xác minh kết quả.' }
    } catch (error) {
      return failure('publish_action_failed', error instanceof Error ? error.message : String(error))
    }
  }
}

export const contentFingerprint = publishContentFingerprint

export class PublishResultDetector {
  constructor(private readonly page: Page) {}

  captureBaseline(): Promise<PublishBaseline> {
    return capturePublishBaseline(this.page)
  }

  async detect(container: Locator, content: string, baseline: PublishBaseline): Promise<PostingJobResult> {
    const deadline = Date.now() + 25_000
    while (Date.now() < deadline) {
      const blocked = await detectFacebookAccessBlock(this.page)
      if (blocked === 'login_required') return failure('needs_login', 'Facebook yêu cầu đăng nhập lại sau publish.')
      if (blocked === 'verification_required') return failure('verification_required', 'Facebook yêu cầu checkpoint/xác minh sau publish.')
      const successToast = this.page.getByText(/your post is now published|your post was shared|bài viết của bạn.*(?:đã được đăng|đã được chia sẻ|đã chia sẻ)/i).first()
      if (await successToast.isVisible().catch(() => false)) return { status: 'success', message: 'Facebook hiển thị trạng thái publish thành công.' }

      const composerClosed = !await container.isVisible().catch(() => false)
      if (composerClosed) {
        const publishedPost = await findNewPublishedPost(this.page, content, baseline).catch(() => null)
        if (publishedPost) {
          return {
            status: 'success',
            message: 'Đã xác minh một post mới có permalink và nội dung khớp xuất hiện sau publish.',
            publishedUrl: publishedPost.publishedUrl
          }
        }
      }
      await this.page.waitForTimeout(1_000)
    }
    return failure('publish_unconfirmed', 'Đã bấm Đăng nhưng chưa có đủ bằng chứng xác minh publish thành công; run item không được consume success.')
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
    const composer = await new ComposerDetector(page).open()
    if (!composer) return finish(failure('composer_not_found', 'Không phát hiện được composer đăng bài trong Group.'))
    const contentResult = await new PostComposer().fill(composer.textbox, job.content)
    if (contentResult.status !== 'success') return finish(contentResult)
    const mediaResult = await new MediaUploader().upload(composer.container, job.imagePaths)
    if (mediaResult.status !== 'success') return finish(mediaResult)

    const resultDetector = new PublishResultDetector(page)
    const publishBaseline = await resultDetector.captureBaseline()
    const publishResult = await new PublishAction().click(composer.container)
    if (publishResult.status !== 'success') return finish(publishResult)

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
