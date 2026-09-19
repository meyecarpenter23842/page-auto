import type { Locator, Page } from 'playwright-core'
import type { PostingJobResult } from '../../../shared/posting'
import type { RobustComposerDetector } from '../../browser/posting/robustComposerDetector'

const PAGE_WALL_SUGGESTION_DISMISS_TIMEOUT_MS = 1_500
const PAGE_WALL_SUGGESTION_POLL_MS = 100
const FALLBACK_SUGGESTION_SELECTOR = [
  '[role="listbox"]:visible:has([role="option"])',
  '[role="menu"]:visible:has([role="option"])',
  '[role="menu"]:visible:has([role="menuitem"])'
].join(', ')

export interface PageWallSuggestionOwnershipSignals {
  controlledVisible: number
  ariaExpanded: boolean
  textboxFocused: boolean
  fallbackVisible: number
}

export function shouldTreatPageWallComposerSuggestionAsOwned(
  signals: PageWallSuggestionOwnershipSignals
): boolean {
  if (signals.controlledVisible > 0) return true
  if (signals.fallbackVisible <= 0) return false
  return signals.ariaExpanded || signals.textboxFocused
}

export function normalizePageWallComposerText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
}

function failure(code: 'content_failed' | 'publish_action_failed', message: string): PostingJobResult {
  return { status: 'failed', code, message }
}

function success(message: string): PostingJobResult {
  return { status: 'success', message }
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function visibleCount(locator: Locator): Promise<number> {
  const count = await locator.count().catch(() => 0)
  let visible = 0
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) visible += 1
  }
  return visible
}

async function readTextboxText(textbox: Locator): Promise<string> {
  const innerText = await textbox.innerText().catch(() => '')
  if (innerText) return innerText
  return await textbox.textContent().catch(() => null) ?? ''
}

async function textboxControls(textbox: Locator): Promise<string[]> {
  const [controls, owns] = await Promise.all([
    textbox.getAttribute('aria-controls').catch(() => null),
    textbox.getAttribute('aria-owns').catch(() => null)
  ])
  return Array.from(new Set(
    [controls, owns]
      .flatMap((value) => value?.split(/\s+/g) ?? [])
      .map((value) => value.trim())
      .filter(Boolean)
  ))
}

export class PageWallComposerSuggestionGuard {
  constructor(
    private readonly page: Page,
    private readonly networkTimeoutMs: number
  ) {}

  private diagnostic(message: string): void {
    console.info(`[PAGE-AUTO page-wall-suggestion] ${message}`)
  }

  private async controlledVisible(textbox: Locator): Promise<number> {
    let total = 0
    for (const id of await textboxControls(textbox)) {
      const escaped = escapeAttributeValue(id)
      total += await visibleCount(this.page.locator([
        `[id="${escaped}"][role="listbox"]`,
        `[id="${escaped}"][role="menu"]`,
        `[id="${escaped}"]:has([role="option"])`,
        `[id="${escaped}"]:has([role="menuitem"])`
      ].join(', ')))
    }
    return total
  }

  private async ownershipSignals(textbox: Locator): Promise<PageWallSuggestionOwnershipSignals> {
    const [controlledVisible, expanded, textboxFocused, fallbackVisible] = await Promise.all([
      this.controlledVisible(textbox),
      textbox.getAttribute('aria-expanded').then((value) => value === 'true').catch(() => false),
      textbox.evaluate((element) => (
        document.activeElement === element || element.contains(document.activeElement)
      )).catch(() => false),
      visibleCount(this.page.locator(FALLBACK_SUGGESTION_SELECTOR))
    ])
    return {
      controlledVisible,
      ariaExpanded: expanded,
      textboxFocused,
      fallbackVisible
    }
  }

  private async ownedSuggestionCount(textbox: Locator): Promise<number> {
    const signals = await this.ownershipSignals(textbox)
    if (!shouldTreatPageWallComposerSuggestionAsOwned(signals)) return 0
    return signals.controlledVisible > 0 ? signals.controlledVisible : signals.fallbackVisible
  }

  async dismissIfPresent(
    composerDetector: RobustComposerDetector,
    stage: string
  ): Promise<PostingJobResult> {
    const handle = await composerDetector.resolve().catch(() => null)
    if (!handle) {
      return success(`Không có editor Tường Page cần cleanup suggestion tại ${stage}.`)
    }

    const textbox = handle.textbox
    const initialCount = await this.ownedSuggestionCount(textbox)
    if (initialCount === 0) {
      return success(`Không có dropdown hashtag/mention tại ${stage}.`)
    }

    const before = normalizePageWallComposerText(await readTextboxText(textbox))
    this.diagnostic(`stage=${stage} action=escape candidates=${initialCount}`)

    try {
      await this.page.keyboard.press('Escape')
    } catch (error) {
      return failure(
        'publish_action_failed',
        `Có dropdown hashtag/mention nhưng không gửi được Escape tại ${stage}: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    const timeoutMs = Math.max(
      500,
      Math.min(PAGE_WALL_SUGGESTION_DISMISS_TIMEOUT_MS, this.networkTimeoutMs)
    )
    const deadline = Date.now() + timeoutMs
    let remaining = await this.ownedSuggestionCount(textbox)
    while (remaining > 0 && Date.now() < deadline) {
      await this.page.waitForTimeout(PAGE_WALL_SUGGESTION_POLL_MS).catch(() => undefined)
      remaining = await this.ownedSuggestionCount(textbox)
    }
    if (remaining > 0) {
      return failure(
        'publish_action_failed',
        `Dropdown hashtag/mention vẫn còn sau Escape tại ${stage}; dừng có kiểm soát thay vì click lệch.`
      )
    }

    const after = normalizePageWallComposerText(await readTextboxText(textbox))
    if (before !== after) {
      return failure(
        'content_failed',
        `Nội dung composer thay đổi sau khi đóng dropdown hashtag/mention tại ${stage}; không publish.`
      )
    }

    this.diagnostic(`stage=${stage} action=escape_complete`)
    return success(`Đã đóng dropdown hashtag/mention tại ${stage} mà không đổi nội dung.`)
  }
}
