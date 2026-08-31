import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
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
  ]
} as const

export interface StoryPostDependencies extends BaseViewActionDependencies {}

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


async function firstAttachedFileInput(page: Page): Promise<Locator | null> {
  for (const selector of STORY_POST_SELECTORS.fileInput) {
    const input = page.locator(selector).first()
    if (await input.count().catch(() => 0)) return input
    if (await input.waitFor({ state: 'attached', timeout: 2500 }).then(() => true).catch(() => false)) return input
  }
  return null
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

async function addLink(page: Page, link: string): Promise<boolean> {
  if (!link) return true
  let button = await firstVisible(page, STORY_POST_SELECTORS.linkButton)
  if (!button) {
    const sticker = await firstVisible(page, STORY_POST_SELECTORS.stickerButton)
    if (!sticker || !await sticker.click({ timeout: 4000 }).then(() => true).catch(() => false)) return false
    button = await firstVisible(page, STORY_POST_SELECTORS.linkButton)
  }
  if (!button || !await button.click({ timeout: 4000 }).then(() => true).catch(() => false)) return false
  const input = await firstVisible(page, STORY_POST_SELECTORS.linkInput)
  if (!input) return false
  if (!await input.fill(link, { timeout: 4000 }).then(() => true).catch(() => false)) return false
  const apply = await firstVisible(page, [
    '[role="button"]:has-text("Add")',
    '[role="button"]:has-text("Done")',
    '[role="button"]:has-text("Thêm")',
    '[role="button"]:has-text("Xong")'
  ])
  if (apply) await apply.click({ timeout: 4000 }).catch(() => undefined)
  return true
}

async function createTextStory(page: Page, story: StoryRecord, content: string): Promise<ActionResult | null> {
  const textStory = await firstVisible(page, STORY_POST_SELECTORS.textStory)
  if (textStory) await textStory.click({ timeout: 5000 }).catch(() => undefined)
  const editor = await firstVisible(page, STORY_POST_SELECTORS.textEditor)
  if (!editor) {
    return { status: 'failed', code: 'story_editor_unavailable', message: `Story “${story.name}”: không tìm thấy vùng nhập nội dung.` }
  }
  if (!await fillEditor(editor, content)) {
    return { status: 'failed', code: 'story_text_fill_failed', message: `Story “${story.name}”: không nhập được nội dung.` }
  }
  if (story.randomBackground) await clickRandomVisible(page, STORY_POST_SELECTORS.backgroundButtons)
  if (story.randomFont) await clickRandomVisible(page, STORY_POST_SELECTORS.fontButtons)
  return null
}

async function createMediaStory(page: Page, story: StoryRecord, mediaPath: string, content: string): Promise<ActionResult | null> {
  let input = await firstAttachedFileInput(page)
  if (!input) {
    const photoStory = await firstVisible(page, STORY_POST_SELECTORS.photoStory)
    if (photoStory) await photoStory.click({ timeout: 5000 }).catch(() => undefined)
    input = await firstAttachedFileInput(page)
  }
  if (!input) {
    return { status: 'failed', code: 'story_media_input_unavailable', message: `Story “${story.name}”: không tìm thấy input ảnh/video.` }
  }
  if (!await input.setInputFiles(mediaPath, { timeout: 15_000 }).then(() => true).catch(() => false)) {
    return { status: 'failed', code: 'story_media_upload_failed', message: `Story “${story.name}”: không nạp được media đã chọn.` }
  }
  if (content) {
    await new Promise<void>((resolve) => setTimeout(resolve, 800))
    const addTextButton = await firstVisible(page, STORY_POST_SELECTORS.addText)
    if (addTextButton) await addTextButton.click({ timeout: 4000 }).catch(() => undefined)
    const editor = await firstVisible(page, STORY_POST_SELECTORS.textEditor)
    if (!editor || !await fillEditor(editor, content)) {
      return { status: 'failed', code: 'story_text_overlay_failed', message: `Story “${story.name}”: media đã nạp nhưng không thêm được phần chữ.` }
    }
    if (story.randomFont) await clickRandomVisible(page, STORY_POST_SELECTORS.fontButtons)
  }
  return null
}

async function publishStory(page: Page, story: StoryRecord): Promise<ActionResult | null> {
  const share = await firstVisible(page, STORY_POST_SELECTORS.share)
  if (!share) {
    return { status: 'failed', code: 'story_publish_button_unavailable', message: `Story “${story.name}”: không tìm thấy nút Chia sẻ lên tin.` }
  }
  if (!await share.click({ timeout: 7000 }).then(() => true).catch(() => false)) {
    return { status: 'failed', code: 'story_publish_click_failed', message: `Story “${story.name}”: không bấm được nút Chia sẻ lên tin.` }
  }
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (!page.url().includes('/stories/create')) return null
    if (!await share.isVisible().catch(() => false)) return null
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
  }
  return { status: 'failed', code: 'story_publish_unconfirmed', message: `Story “${story.name}”: đã bấm chia sẻ nhưng chưa xác nhận được kết quả.` }
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
        return { status: 'failed', code: 'story_media_missing', message: `Story “${story.name}”: không tìm thấy ảnh/video hợp lệ.` }
      }

      try {
        await page.goto(STORY_CREATE_URL, {
          waitUntil: 'domcontentloaded',
          timeout: this.dependencies.navigationTimeoutMs ?? 45_000
        })
      } catch (error) {
        return navigationFailed(`Story “${story.name}”`, error)
      }

      const prepareError = mediaPath
        ? await createMediaStory(page, story, mediaPath, content)
        : await createTextStory(page, story, content)
      if (prepareError) return prepareError

      if (story.linkUrl && !await addLink(page, story.linkUrl)) {
        return {
          status: 'failed',
          code: 'story_link_unavailable',
          message: `Story “${story.name}”: Facebook không hiện control Link/Sticker phù hợp; không đăng để tránh thiếu link.`
        }
      }

      const publishError = await publishStory(page, story)
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
