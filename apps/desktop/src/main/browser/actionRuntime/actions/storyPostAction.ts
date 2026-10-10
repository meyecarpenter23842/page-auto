import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import type { ActionRunControl } from '../../../../shared/actionRuntime'
import type { StoryRecord, StoryRuntimeData } from '../../../../shared/story'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import {
  browserUnavailable,
  configNumber,
  configString,
  firstVisible,
  navigationFailed,
  pickRange,
  shuffled,
  sleepWithControl,
  type BaseViewActionDependencies
} from './actionSupport'

const STORY_CREATE_URL = 'https://www.facebook.com/stories/create/'
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm'])
const STORY_SURFACE_TIMEOUT_MS = 30_000
const STORY_MEDIA_READY_TIMEOUT_MS = 75_000
const STORY_PUBLISH_READY_TIMEOUT_MS = 45_000
const STORY_PUBLISH_VERIFY_TIMEOUT_MS = 30_000

export const STORY_POST_SELECTORS = {
  textStory: [
    '[role="button"]:has-text("Create a text story")',
    '[role="button"]:has-text("Tạo tin dạng văn bản")',
    'a:has-text("Create a text story")',
    'a:has-text("Tạo tin dạng văn bản")'
  ],
  photoStory: [
    '[role="button"]:has-text("Create a photo story")',
    '[role="button"]:has-text("Tạo tin ảnh")',
    'a:has-text("Create a photo story")',
    'a:has-text("Tạo tin ảnh")'
  ],
  fileInput: ['input[type="file"]'],
  textEditor: [
    'textarea[placeholder*="Start typing" i]',
    'textarea[placeholder*="Bắt đầu" i]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]'
  ],
  addText: [
    '[role="button"][aria-label*="Add text" i]',
    '[role="button"][aria-label*="Thêm văn bản" i]',
    '[role="button"]:has-text("Text")',
    '[role="button"]:has-text("Văn bản")'
  ],
  share: [
    '[role="button"]:has-text("Share to Story")',
    '[role="button"]:has-text("Share to story")',
    '[role="button"]:has-text("Chia sẻ lên tin")',
    '[role="button"]:has-text("Chia sẻ")'
  ],
  trimSurface: [
    '[role="heading"]:has-text("Trim video")',
    '[role="heading"]:has-text("Cắt video")',
    'text=Trim video',
    'text=Cắt video'
  ],
  trimConfirm: [
    '[role="button"][aria-label*="Done" i]',
    '[role="button"][aria-label*="Save" i]',
    '[role="button"][aria-label*="Apply" i]',
    '[role="button"][aria-label*="Confirm" i]',
    '[role="button"][aria-label*="Xong" i]',
    '[role="button"][aria-label*="Lưu" i]',
    '[role="button"]:has-text("Done")',
    '[role="button"]:has-text("Save")',
    '[role="button"]:has-text("Next")',
    '[role="button"]:has-text("Xong")',
    '[role="button"]:has-text("Lưu")',
    '[role="button"]:has-text("Tiếp")'
  ],
  backgroundButtons: [
    '[role="button"][aria-label*="background" i]',
    '[role="button"][aria-label*="nền" i]'
  ],
  fontButtons: [
    '[role="button"][aria-label*="font" i]',
    '[role="button"][aria-label*="phông" i]'
  ],
  stickerButton: [
    '[role="button"][aria-label*="sticker" i]',
    '[role="button"][aria-label*="nhãn dán" i]',
    '[role="button"]:has-text("Stickers")',
    '[role="button"]:has-text("Nhãn dán")'
  ],
  linkButton: [
    '[role="button"][aria-label*="link" i]',
    '[role="button"][aria-label*="liên kết" i]',
    '[role="button"]:has-text("Link")',
    '[role="button"]:has-text("Liên kết")'
  ],
  linkInput: [
    'input[placeholder*="link" i]',
    'input[placeholder*="URL" i]',
    'input[placeholder*="liên kết" i]'
  ],
  publishSuccess: [
    '[role="alert"]:has-text("shared")',
    '[role="alert"]:has-text("đã chia sẻ")',
    'text=Your story was shared',
    'text=Tin của bạn đã được chia sẻ'
  ]
} as const

export interface StoryPostDependencies extends BaseViewActionDependencies {}

interface StoryWaitOptions {
  timeoutMs: number
  intervalMs?: number
  control?: ActionRunControl
  now?: () => number
  sleep?: (delayMs: number) => Promise<void>
}

export async function waitForStoryCondition<T>(
  probe: () => Promise<T | null>,
  options: StoryWaitOptions
): Promise<T | null> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)))
  const intervalMs = Math.max(50, options.intervalMs ?? 250)
  const startedAt = now()

  while (now() - startedAt <= options.timeoutMs) {
    if (options.control?.isStopped()) return null
    await options.control?.waitIfPaused()
    if (options.control?.isStopped()) return null

    const value = await probe()
    if (value !== null) return value

    if (now() - startedAt >= options.timeoutMs) break
    if (options.control) await options.control.sleep(intervalMs)
    else await sleep(intervalMs)
  }
  return null
}

export type StoryMediaUiState = 'trim' | 'ready' | 'waiting'

export function classifyStoryMediaUi(trimVisible: boolean, shareReady: boolean, editReady: boolean): StoryMediaUiState {
  if (trimVisible) return 'trim'
  if (shareReady || editReady) return 'ready'
  return 'waiting'
}

function runtimeStories(value: unknown): StoryRecord[] {
  if (!value || typeof value !== 'object') return []
  const data = value as Partial<StoryRuntimeData>
  return Array.isArray(data.stories) ? data.stories : []
}

export function expandStorySpintax(text: string, random: () => number = Math.random): string {
  return text.replace(/\{([^{}]+)\}/g, (_whole, group: string) => {
    const choices = group.split('|').map((item) => item.trim()).filter(Boolean)
    if (!choices.length) return ''
    return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))] ?? ''
  })
}

function storyMediaKind(path: string): 'image' | 'video' | null {
  const extension = extname(path).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return null
}

export async function resolveStoryMediaPath(story: StoryRecord, ordinal: number): Promise<string | null> {
  if (story.mediaSourceType === 'none') return null
  if (story.mediaSourceType === 'file') {
    const kind = storyMediaKind(story.mediaPath)
    return kind && (story.mediaKind === 'auto' || story.mediaKind === kind) ? story.mediaPath : null
  }

  let names: string[]
  try {
    names = (await readdir(story.mediaPath, { withFileTypes: true }))
      .filter((entry) => {
        if (!entry.isFile()) return false
        const kind = storyMediaKind(entry.name)
        return Boolean(kind && (story.mediaKind === 'auto' || story.mediaKind === kind))
      })
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  } catch {
    return null
  }
  if (!names.length) return null
  const index = story.folderMode === 'random'
    ? Math.floor(Math.random() * names.length)
    : ordinal % names.length
  const name = names[index]
  return name ? join(story.mediaPath, name) : null
}

async function waitForVisible(
  page: Page,
  selectors: readonly string[],
  timeoutMs: number,
  context: ActionExecutorContext
): Promise<Locator | null> {
  return waitForStoryCondition(
    () => firstVisible(page, selectors),
    { timeoutMs, control: context.control }
  )
}

async function waitForEnabled(
  page: Page,
  selectors: readonly string[],
  timeoutMs: number,
  context: ActionExecutorContext
): Promise<Locator | null> {
  return waitForStoryCondition(async () => {
    const locator = await firstVisible(page, selectors)
    if (!locator) return null
    return await locator.isEnabled().catch(() => false) ? locator : null
  }, { timeoutMs, control: context.control })
}

async function firstAttachedFileInput(page: Page, context: ActionExecutorContext): Promise<Locator | null> {
  return waitForStoryCondition(async () => {
    for (const selector of STORY_POST_SELECTORS.fileInput) {
      const input = page.locator(selector).first()
      if (await input.count().catch(() => 0)) return input
    }
    return null
  }, { timeoutMs: 12_000, control: context.control })
}

async function clickRandomVisible(page: Page, selectors: readonly string[]): Promise<void> {
  for (const selector of selectors) {
    const locators = page.locator(selector)
    const count = await locators.count().catch(() => 0)
    const visible: Locator[] = []
    for (let index = 0; index < Math.min(count, 24); index += 1) {
      const item = locators.nth(index)
      if (await item.isVisible().catch(() => false)) visible.push(item)
    }
    if (!visible.length) continue
    const item = visible[Math.floor(Math.random() * visible.length)]
    if (item) await item.click({ timeout: 3000 }).catch(() => undefined)
    return
  }
}

async function fillEditor(editor: Locator, content: string): Promise<boolean> {
  if (!content) return true
  if (await editor.fill(content, { timeout: 5000 }).then(() => true).catch(() => false)) return true
  return editor.click({ timeout: 3000 })
    .then(async () => {
      await editor.pressSequentially(content, { delay: 5 })
      return true
    })
    .catch(() => false)
}

function storyFailure(
  context: ActionExecutorContext,
  story: StoryRecord,
  code: string,
  message: string,
  stage: string
): ActionResult {
  context.log('warning', message, code, { storyId: story.id, stage })
  return { status: 'failed', code, message, data: { stage } }
}

async function waitForInitialSurface(page: Page, story: StoryRecord, context: ActionExecutorContext): Promise<ActionResult | null> {
  context.log('info', `Story “${story.name}”: đang chờ giao diện tạo Story.`, 'story_surface_waiting')
  const surface = await waitForVisible(page, [
    ...STORY_POST_SELECTORS.textStory,
    ...STORY_POST_SELECTORS.photoStory,
    ...STORY_POST_SELECTORS.textEditor
  ], STORY_SURFACE_TIMEOUT_MS, context)
  if (!surface && !await firstAttachedFileInput(page, context)) {
    return storyFailure(
      context,
      story,
      'story_surface_unavailable',
      `Story “${story.name}”: Facebook chưa sẵn sàng giao diện tạo Story.`,
      'surface'
    )
  }
  context.log('info', `Story “${story.name}”: giao diện tạo Story đã sẵn sàng.`, 'story_surface_ready')
  return null
}

async function addLink(page: Page, story: StoryRecord, context: ActionExecutorContext): Promise<boolean> {
  const link = story.linkUrl
  if (!link) return true
  context.log('info', `Story “${story.name}”: đang thêm link.`, 'story_link_opening')

  let button = await waitForVisible(page, STORY_POST_SELECTORS.linkButton, 8_000, context)
  if (!button) {
    const sticker = await waitForEnabled(page, STORY_POST_SELECTORS.stickerButton, 8_000, context)
    if (!sticker || !await sticker.click({ timeout: 4000 }).then(() => true).catch(() => false)) return false
    button = await waitForEnabled(page, STORY_POST_SELECTORS.linkButton, 8_000, context)
  }
  if (!button || !await button.click({ timeout: 4000 }).then(() => true).catch(() => false)) return false

  const input = await waitForVisible(page, STORY_POST_SELECTORS.linkInput, 8_000, context)
  if (!input || !await input.fill(link, { timeout: 4000 }).then(() => true).catch(() => false)) return false

  const apply = await waitForEnabled(page, [
    '[role="button"]:has-text("Add")',
    '[role="button"]:has-text("Done")',
    '[role="button"]:has-text("Thêm")',
    '[role="button"]:has-text("Xong")'
  ], 6_000, context)
  if (apply) await apply.click({ timeout: 4000 }).catch(() => undefined)
  context.log('info', `Story “${story.name}”: đã thêm link.`, 'story_link_ready')
  return true
}

async function createTextStory(
  page: Page,
  story: StoryRecord,
  content: string,
  context: ActionExecutorContext
): Promise<ActionResult | null> {
  context.log('info', `Story “${story.name}”: đang chuẩn bị Story văn bản.`, 'story_text_preparing')
  const existingEditor = await firstVisible(page, STORY_POST_SELECTORS.textEditor)
  if (!existingEditor) {
    const textStory = await waitForEnabled(page, STORY_POST_SELECTORS.textStory, 15_000, context)
    if (textStory && !await textStory.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
      return storyFailure(context, story, 'story_text_entry_failed', `Story “${story.name}”: không mở được trình soạn Story văn bản.`, 'text_entry')
    }
  }

  const editor = existingEditor ?? await waitForVisible(page, STORY_POST_SELECTORS.textEditor, 20_000, context)
  if (!editor) {
    return storyFailure(context, story, 'story_editor_unavailable', `Story “${story.name}”: không tìm thấy vùng nhập nội dung.`, 'text_editor')
  }
  context.log('info', `Story “${story.name}”: vùng nhập nội dung đã sẵn sàng.`, 'story_editor_ready')

  if (!await fillEditor(editor, content)) {
    return storyFailure(context, story, 'story_text_fill_failed', `Story “${story.name}”: không nhập được nội dung.`, 'text_fill')
  }
  if (story.randomBackground) await clickRandomVisible(page, STORY_POST_SELECTORS.backgroundButtons)
  if (story.randomFont) await clickRandomVisible(page, STORY_POST_SELECTORS.fontButtons)
  return null
}

async function handleVideoTrim(
  page: Page,
  story: StoryRecord,
  context: ActionExecutorContext
): Promise<ActionResult | null> {
  const state = await waitForStoryCondition(async () => {
    const trimVisible = Boolean(await firstVisible(page, STORY_POST_SELECTORS.trimSurface))
    const share = await firstVisible(page, STORY_POST_SELECTORS.share)
    const shareReady = Boolean(share && await share.isEnabled().catch(() => false))
    const editReady = Boolean(await firstVisible(page, STORY_POST_SELECTORS.addText))
    const classified = classifyStoryMediaUi(trimVisible, shareReady, editReady)
    return classified === 'waiting' ? null : classified
  }, { timeoutMs: STORY_MEDIA_READY_TIMEOUT_MS, control: context.control })

  if (!state) {
    return storyFailure(context, story, 'story_media_preview_timeout', `Story “${story.name}”: Facebook xử lý media quá lâu, chưa vào được màn preview.`, 'media_preview')
  }
  if (state === 'ready') {
    context.log('info', `Story “${story.name}”: preview video đã sẵn sàng.`, 'story_preview_ready')
    return null
  }

  context.log('info', `Story “${story.name}”: phát hiện màn Trim video.`, 'story_trim_detected')
  const confirm = await waitForEnabled(page, STORY_POST_SELECTORS.trimConfirm, 30_000, context)
  if (!confirm) {
    return storyFailure(context, story, 'story_trim_confirm_unavailable', `Story “${story.name}”: đang ở màn Trim video nhưng không tìm thấy nút xác nhận.`, 'video_trim')
  }
  if (!await confirm.click({ timeout: 7000 }).then(() => true).catch(() => false)) {
    return storyFailure(context, story, 'story_trim_confirm_failed', `Story “${story.name}”: không xác nhận được màn Trim video.`, 'video_trim')
  }
  context.log('info', `Story “${story.name}”: đã xác nhận Trim video, đang chờ quay lại composer.`, 'story_trim_confirmed')

  const readyAfterTrim = await waitForStoryCondition(async () => {
    if (await firstVisible(page, STORY_POST_SELECTORS.trimSurface)) return null
    const share = await firstVisible(page, STORY_POST_SELECTORS.share)
    if (share && await share.isEnabled().catch(() => false)) return true
    if (await firstVisible(page, STORY_POST_SELECTORS.addText)) return true
    return null
  }, { timeoutMs: 45_000, control: context.control })

  if (!readyAfterTrim) {
    return storyFailure(context, story, 'story_trim_exit_timeout', `Story “${story.name}”: đã xác nhận Trim video nhưng Facebook chưa trở lại composer.`, 'video_trim_exit')
  }
  context.log('info', `Story “${story.name}”: preview video đã sẵn sàng sau Trim.`, 'story_preview_ready')
  return null
}

async function waitForImagePreview(page: Page, story: StoryRecord, context: ActionExecutorContext): Promise<ActionResult | null> {
  const ready = await waitForStoryCondition(async () => {
    const share = await firstVisible(page, STORY_POST_SELECTORS.share)
    if (share && await share.isEnabled().catch(() => false)) return true
    if (await firstVisible(page, STORY_POST_SELECTORS.addText)) return true
    if (await firstVisible(page, STORY_POST_SELECTORS.textEditor)) return true
    return null
  }, { timeoutMs: STORY_MEDIA_READY_TIMEOUT_MS, control: context.control })

  if (!ready) {
    return storyFailure(context, story, 'story_media_preview_timeout', `Story “${story.name}”: ảnh đã nạp nhưng Facebook chưa render xong preview.`, 'media_preview')
  }
  context.log('info', `Story “${story.name}”: preview ảnh đã sẵn sàng.`, 'story_preview_ready')
  return null
}

async function addMediaTextOverlay(
  page: Page,
  story: StoryRecord,
  content: string,
  context: ActionExecutorContext
): Promise<ActionResult | null> {
  if (!content) return null

  let editor = await firstVisible(page, STORY_POST_SELECTORS.textEditor)
  if (!editor) {
    const addTextButton = await waitForEnabled(page, STORY_POST_SELECTORS.addText, 15_000, context)
    if (addTextButton) await addTextButton.click({ timeout: 4000 }).catch(() => undefined)
    editor = await waitForVisible(page, STORY_POST_SELECTORS.textEditor, 15_000, context)
  }
  if (!editor || !await fillEditor(editor, content)) {
    return storyFailure(context, story, 'story_text_overlay_failed', `Story “${story.name}”: media đã nạp nhưng không thêm được phần chữ.`, 'media_text')
  }
  if (story.randomFont) await clickRandomVisible(page, STORY_POST_SELECTORS.fontButtons)
  context.log('info', `Story “${story.name}”: phần chữ trên media đã sẵn sàng.`, 'story_text_overlay_ready')
  return null
}

async function createMediaStory(
  page: Page,
  story: StoryRecord,
  mediaPath: string,
  content: string,
  context: ActionExecutorContext
): Promise<ActionResult | null> {
  let input = await firstAttachedFileInput(page, context)
  if (!input) {
    const photoStory = await waitForEnabled(page, STORY_POST_SELECTORS.photoStory, 15_000, context)
    if (photoStory) await photoStory.click({ timeout: 5000 }).catch(() => undefined)
    input = await firstAttachedFileInput(page, context)
  }
  if (!input) {
    return storyFailure(context, story, 'story_media_input_unavailable', `Story “${story.name}”: không tìm thấy input ảnh/video.`, 'media_input')
  }

  context.log('info', `Story “${story.name}”: đang nạp ảnh/video.`, 'story_uploading')
  if (!await input.setInputFiles(mediaPath, { timeout: 20_000 }).then(() => true).catch(() => false)) {
    return storyFailure(context, story, 'story_media_upload_failed', `Story “${story.name}”: không nạp được media đã chọn.`, 'media_upload')
  }

  const kind = storyMediaKind(mediaPath)
  const readyError = kind === 'video'
    ? await handleVideoTrim(page, story, context)
    : await waitForImagePreview(page, story, context)
  if (readyError) return readyError

  return addMediaTextOverlay(page, story, content, context)
}

async function publishStory(page: Page, story: StoryRecord, context: ActionExecutorContext): Promise<ActionResult | null> {
  const share = await waitForEnabled(page, STORY_POST_SELECTORS.share, STORY_PUBLISH_READY_TIMEOUT_MS, context)
  if (!share) {
    return storyFailure(context, story, 'story_publish_button_unavailable', `Story “${story.name}”: không tìm thấy nút Chia sẻ lên tin ở trạng thái sẵn sàng.`, 'publish_ready')
  }
  context.log('info', `Story “${story.name}”: nút Chia sẻ lên tin đã sẵn sàng.`, 'story_publish_ready')

  if (!await share.click({ timeout: 7000 }).then(() => true).catch(() => false)) {
    return storyFailure(context, story, 'story_publish_click_failed', `Story “${story.name}”: không bấm được nút Chia sẻ lên tin.`, 'publish_click')
  }
  context.log('info', `Story “${story.name}”: đang chờ Facebook xác nhận đăng.`, 'story_publishing')

  let hiddenStreak = 0
  const verified = await waitForStoryCondition(async () => {
    if (!page.url().includes('/stories/create')) return true
    if (await firstVisible(page, STORY_POST_SELECTORS.publishSuccess)) return true

    const visible = await share.isVisible().catch(() => false)
    if (!visible) hiddenStreak += 1
    else hiddenStreak = 0
    return hiddenStreak >= 6 ? true : null
  }, { timeoutMs: STORY_PUBLISH_VERIFY_TIMEOUT_MS, intervalMs: 500, control: context.control })

  if (!verified) {
    return storyFailure(context, story, 'story_publish_unconfirmed', `Story “${story.name}”: đã bấm chia sẻ nhưng chưa xác nhận được kết quả.`, 'publish_verify')
  }
  context.log('info', `Story “${story.name}”: Facebook đã xác nhận Story được đăng.`, 'story_publish_verified')
  return null
}

export class StoryPostActionExecutor implements ActionExecutor {
  readonly actionType = 'post_story'

  constructor(private readonly dependencies: StoryPostDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Đăng story')

    const hydrated = runtimeStories(context.request.runtimeData)
    if (!hydrated.length) {
      return {
        status: 'failed',
        code: 'story_runtime_data_missing',
        message: 'Đăng story: các Story đã chọn không còn tồn tại trong kho Story.'
      }
    }

    const orderMode = configString(config, 'orderMode') === 'random' ? 'random' : 'sequential'
    const count = Math.min(hydrated.length, Math.max(1, Math.floor(configNumber(config, 'storiesPerAccount', 1))))
    const stories = orderMode === 'random' ? shuffled(hydrated).slice(0, count) : hydrated.slice(0, count)
    const delayMin = configNumber(config, 'delayMinSeconds', 200)
    const delayMax = configNumber(config, 'delayMaxSeconds', 300)
    const pauseAfter = Math.max(0, Math.floor(configNumber(config, 'pauseAfterStories', 30)))
    const pauseMinutes = Math.max(0, configNumber(config, 'pauseMinutes', 15))
    let published = 0

    for (let index = 0; index < stories.length; index += 1) {
      if (context.control.isStopped()) {
        return { status: 'stopped', code: 'action_stopped', message: 'Đăng story đã dừng.', data: { published } }
      }
      await context.control.waitIfPaused()
      if (context.control.isStopped()) {
        return { status: 'stopped', code: 'action_stopped', message: 'Đăng story đã dừng.', data: { published } }
      }

      const story = stories[index]!
      const content = expandStorySpintax(story.content)
      const mediaPath = await resolveStoryMediaPath(story, index)
      if (story.mediaSourceType !== 'none' && !mediaPath) {
        return storyFailure(context, story, 'story_media_missing', `Story “${story.name}”: không tìm thấy ảnh/video hợp lệ.`, 'media_resolve')
      }

      context.log('info', `Story ${index + 1}/${stories.length} “${story.name}”: mở trình tạo Story.`, 'story_opening')
      try {
        await page.goto(STORY_CREATE_URL, {
          waitUntil: 'domcontentloaded',
          timeout: this.dependencies.navigationTimeoutMs ?? 45_000
        })
      } catch (error) {
        return navigationFailed(`Story “${story.name}”`, error)
      }

      const surfaceError = await waitForInitialSurface(page, story, context)
      if (surfaceError) return surfaceError

      const prepareError = mediaPath
        ? await createMediaStory(page, story, mediaPath, content, context)
        : await createTextStory(page, story, content, context)
      if (prepareError) return prepareError

      if (story.linkUrl && !await addLink(page, story, context)) {
        return storyFailure(
          context,
          story,
          'story_link_unavailable',
          `Story “${story.name}”: Facebook không hiện control Link/Sticker phù hợp; không đăng để tránh thiếu link.`,
          'link'
        )
      }

      const publishError = await publishStory(page, story, context)
      if (publishError) return publishError
      published += 1
      context.log('info', `Đã đăng Story ${published}/${stories.length}: ${story.name}.`, 'story_published')

      if (pauseAfter > 0 && published < stories.length && published % pauseAfter === 0 && pauseMinutes > 0) {
        if (!await sleepWithControl(context.control, Math.round(pauseMinutes * 60_000))) break
      } else if (published < stories.length) {
        const delaySeconds = pickRange(Math.round(delayMin), Math.round(delayMax))
        if (!await sleepWithControl(context.control, delaySeconds * 1000)) break
      }
    }

    if (context.control.isStopped()) {
      return { status: 'stopped', code: 'action_stopped', message: 'Đăng story đã dừng.', data: { published } }
    }
    return {
      status: 'success',
      code: 'story_publish_completed',
      message: `Đăng story hoàn tất: ${published}/${stories.length} Story.`,
      data: { published, orderMode }
    }
  }
}
