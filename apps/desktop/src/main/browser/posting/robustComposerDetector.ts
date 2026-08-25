import type { Locator, Page } from 'playwright-core'
import {
  COMPOSER_MEDIA_PATTERN,
  COMPOSER_TITLE_PATTERN,
  COMPOSER_TRIGGER_PATTERN,
  formatComposerDiagnostics
} from './composerSurface'

const PUBLISH_PATTERN = /^(post|đăng)$/i
const POLL_MS = 250
const INITIAL_OBSERVE_MS = 1_500
const OPEN_TIMEOUT_MS = 18_000
const ACTION_SETTLE_MS = 850
const MAX_ANCESTOR_DEPTH = 48

export interface RobustComposerHandle {
  container: Locator
  textbox: Locator
}

export interface ComposerContainerSignals {
  textboxVisible: boolean
  textboxLabelMatches: boolean
  titleVisible: boolean
  triggerVisible: boolean
  publishVisible: boolean
  mediaVisible: boolean
  fileInputCount: number
  inDialog: boolean
}

export function isComposerContainerEvidence(signals: ComposerContainerSignals): boolean {
  if (!signals.textboxVisible) return false

  const textualEvidence = signals.textboxLabelMatches || signals.titleVisible || signals.triggerVisible
  const actionEvidence = signals.publishVisible || signals.mediaVisible || signals.fileInputCount > 0

  if (signals.publishVisible && (textualEvidence || signals.mediaVisible || signals.fileInputCount > 0)) return true
  if (textualEvidence && actionEvidence) return true
  return signals.inDialog && signals.textboxLabelMatches && actionEvidence
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

function composerTextboxes(root: Locator): Locator {
  return root.locator('[contenteditable="true"], [role="textbox"]')
}

async function textboxLabelMatches(textbox: Locator): Promise<boolean> {
  const values = await Promise.all([
    textbox.getAttribute('aria-label').catch(() => null),
    textbox.getAttribute('aria-placeholder').catch(() => null),
    textbox.getAttribute('data-placeholder').catch(() => null),
    textbox.getAttribute('placeholder').catch(() => null)
  ])
  return values.some((value) => Boolean(value && COMPOSER_TRIGGER_PATTERN.test(value)))
}

export class RobustComposerDetector {
  constructor(private readonly page: Page) {}

  private strongTriggerCandidates(): Locator[] {
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
      this.page.getByRole('textbox', { name: COMPOSER_TRIGGER_PATTERN })
    ]
  }

  private triggerCandidates(): Locator[] {
    return [
      ...this.strongTriggerCandidates(),
      this.page.getByText(COMPOSER_TRIGGER_PATTERN)
    ]
  }

  private async signals(container: Locator, textbox: Locator, inDialog: boolean): Promise<ComposerContainerSignals> {
    const titleVisible = Boolean(await firstVisibleMatch([
      container.getByRole('heading', { name: COMPOSER_TITLE_PATTERN }),
      container.getByText(COMPOSER_TITLE_PATTERN)
    ]))
    const triggerVisible = Boolean(await firstVisibleMatch([
      container.getByRole('button', { name: COMPOSER_TRIGGER_PATTERN }),
      container.getByRole('textbox', { name: COMPOSER_TRIGGER_PATTERN }),
      container.getByText(COMPOSER_TRIGGER_PATTERN)
    ]))
    const publishVisible = Boolean(await firstVisibleMatch([
      container.getByRole('button', { name: PUBLISH_PATTERN })
    ]))
    const mediaVisible = Boolean(await firstVisibleMatch([
      container.getByRole('button', { name: COMPOSER_MEDIA_PATTERN }),
      container.getByLabel(COMPOSER_MEDIA_PATTERN),
      container.getByText(COMPOSER_MEDIA_PATTERN)
    ]))

    return {
      textboxVisible: await textbox.isVisible().catch(() => false),
      textboxLabelMatches: await textboxLabelMatches(textbox),
      titleVisible,
      triggerVisible,
      publishVisible,
      mediaVisible,
      fileInputCount: await container.locator('input[type="file"]').count().catch(() => 0),
      inDialog
    }
  }

  private async findInDialogs(): Promise<RobustComposerHandle | null> {
    const dialogs = this.page.locator('[role="dialog"], [aria-modal="true"]')
    const dialogCount = await dialogs.count().catch(() => 0)
    for (let dialogIndex = dialogCount - 1; dialogIndex >= 0; dialogIndex -= 1) {
      const dialog = dialogs.nth(dialogIndex)
      if (!await dialog.isVisible().catch(() => false)) continue

      const textboxes = composerTextboxes(dialog)
      const textboxCount = await textboxes.count().catch(() => 0)
      for (let textboxIndex = textboxCount - 1; textboxIndex >= 0; textboxIndex -= 1) {
        const textbox = textboxes.nth(textboxIndex)
        const signals = await this.signals(dialog, textbox, true)
        if (isComposerContainerEvidence(signals)) return { container: dialog, textbox }
      }
    }
    return null
  }

  private async findByTextboxAncestor(): Promise<RobustComposerHandle | null> {
    const textboxes = composerTextboxes(this.page.locator('body'))
    const textboxCount = await textboxes.count().catch(() => 0)

    for (let textboxIndex = textboxCount - 1; textboxIndex >= 0; textboxIndex -= 1) {
      const textbox = textboxes.nth(textboxIndex)
      if (!await textbox.isVisible().catch(() => false)) continue

      let container = textbox
      for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        container = container.locator('xpath=..')
        const tagName = await container.evaluate((node) => node.tagName.toLowerCase()).catch(() => '')
        if (!tagName || tagName === 'html' || tagName === 'body') break

        const role = await container.getAttribute('role').catch(() => null)
        const ariaModal = await container.getAttribute('aria-modal').catch(() => null)
        const signals = await this.signals(container, textbox, role === 'dialog' || ariaModal === 'true')
        if (isComposerContainerEvidence(signals)) return { container, textbox }
      }
    }
    return null
  }

  private async findOpenComposer(): Promise<RobustComposerHandle | null> {
    return await this.findInDialogs() ?? await this.findByTextboxAncestor()
  }

  private async hasOpenComposerFootprint(): Promise<boolean> {
    const textboxes = composerTextboxes(this.page.locator('body'))
    const count = await textboxes.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const textbox = textboxes.nth(index)
      if (!await textbox.isVisible().catch(() => false)) continue
      if (await textboxLabelMatches(textbox)) return true
    }

    if (await firstVisibleMatch([this.page.getByRole('button', { name: PUBLISH_PATTERN })])) return true
    return Boolean(await firstVisibleMatch([
      this.page.getByRole('heading', { name: COMPOSER_TITLE_PATTERN }),
      this.page.getByText(COMPOSER_TITLE_PATTERN)
    ]))
  }

  private async waitForHandle(timeoutMs: number): Promise<RobustComposerHandle | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.page.isClosed()) return null
      const handle = await this.findOpenComposer()
      if (handle) return handle
      const slept = await this.page.waitForTimeout(POLL_MS).then(() => true).catch(() => false)
      if (!slept) return null
    }
    return null
  }

  async diagnostics(): Promise<string> {
    const dialogs = this.page.locator('[role="dialog"], [aria-modal="true"]')
    const textboxes = composerTextboxes(this.page.locator('body'))
    const publishButtons = this.page.getByRole('button', { name: PUBLISH_PATTERN })
    return formatComposerDiagnostics({
      dialogCount: await visibleCount(dialogs),
      textboxCount: await visibleCount(textboxes),
      triggerCount: await visibleCountAcross(this.triggerCandidates()),
      publishButtonCount: await visibleCount(publishButtons),
      fileInputCount: await this.page.locator('input[type="file"]').count().catch(() => 0),
      url: this.page.url()
    })
  }

  async open(): Promise<RobustComposerHandle | null> {
    const existing = await this.waitForHandle(INITIAL_OBSERVE_MS)
    if (existing) return existing

    // Keep the local OFF fix: always click a real composer entry control when
    // Facebook exposes one. Avoid generic text clicks because compact layouts can
    // render duplicate prompt text in unrelated regions and cause viewport jumps.
    const trigger = await firstVisibleMatch(this.strongTriggerCandidates())
    if (trigger) {
      await trigger.scrollIntoViewIfNeeded({ timeout: 4_000 }).catch(() => undefined)
      const clicked = await trigger.click({ timeout: 15_000 }).then(() => true).catch(() => false)
      if (!clicked) return null
      await this.page.waitForTimeout(ACTION_SETTLE_MS).catch(() => undefined)
    } else if (!await this.hasOpenComposerFootprint()) {
      return null
    }

    return this.waitForHandle(OPEN_TIMEOUT_MS)
  }
}
