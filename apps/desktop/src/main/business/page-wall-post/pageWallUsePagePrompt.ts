import type { Locator } from 'playwright-core'
import type { FacebookCommonStepResult } from '../../facebook/facebookCommonRuntime'
import type { PreparedPageWallRuntime } from './pageWallTask'

const PAGE_WALL_USE_PAGE_PATTERN = /^(?:use page|use this page|dùng trang|dùng trang này|sử dụng trang|sử dụng trang này)$/i
const PAGE_WALL_USE_PAGE_GRACE_MS = 1_000
const PAGE_WALL_USE_PAGE_DISMISS_MS = 3_000
const PAGE_WALL_USE_PAGE_POLL_MS = 100

export interface PageWallUsePageResolution {
  button: Locator | null
  visibleDialogCount: number
  candidateCount: number
}

export type PageWallUsePageDecision = 'skip' | 'click' | 'ambiguous'

export function isPageWallUsePageAccessibleName(value: string): boolean {
  return PAGE_WALL_USE_PAGE_PATTERN.test(value.replace(/\s+/g, ' ').trim())
}

export function resolvePageWallUsePageDecision(candidateCount: number): PageWallUsePageDecision {
  if (candidateCount === 1) return 'click'
  if (candidateCount > 1) return 'ambiguous'
  return 'skip'
}

export interface PageWallUsePageProbeOptions {
  resolve: () => Promise<PageWallUsePageResolution>
  wait: (delayMs: number) => Promise<void>
  graceMs?: number
  pollMs?: number
}

/**
 * Facebook can render the optional Use Page interstitial shortly after the
 * wall DOM has already settled. Probe for a short bounded window even when
 * the first sample has no dialog; otherwise a late popup is missed entirely.
 */
export async function probePageWallUsePagePrompt(
  options: PageWallUsePageProbeOptions
): Promise<PageWallUsePageResolution> {
  const graceMs = Math.max(0, Math.floor(options.graceMs ?? PAGE_WALL_USE_PAGE_GRACE_MS))
  const pollMs = Math.max(1, Math.floor(options.pollMs ?? PAGE_WALL_USE_PAGE_POLL_MS))
  let resolution = await options.resolve()
  if (resolution.candidateCount > 0 || graceMs === 0) return resolution

  const attempts = Math.max(1, Math.ceil(graceMs / pollMs))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await options.wait(Math.min(pollMs, graceMs))
    resolution = await options.resolve()
    if (resolution.candidateCount > 0) return resolution
  }
  return resolution
}

export async function waitForPageWallUsePageDismissal(
  options: PageWallUsePageProbeOptions
): Promise<boolean> {
  const graceMs = Math.max(0, Math.floor(options.graceMs ?? PAGE_WALL_USE_PAGE_DISMISS_MS))
  const pollMs = Math.max(1, Math.floor(options.pollMs ?? PAGE_WALL_USE_PAGE_POLL_MS))
  let resolution = await options.resolve()
  if (resolution.candidateCount === 0) return true

  const attempts = Math.max(1, Math.ceil(graceMs / pollMs))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await options.wait(Math.min(pollMs, graceMs))
    resolution = await options.resolve()
    if (resolution.candidateCount === 0) return true
  }
  return false
}

async function visibleItems(candidate: Locator): Promise<Locator[]> {
  const items: Locator[] = []
  const count = await candidate.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const item = candidate.nth(index)
    if (await item.isVisible().catch(() => false)) items.push(item)
  }
  return items
}

async function enabledVisibleItems(candidate: Locator): Promise<Locator[]> {
  const items: Locator[] = []
  for (const item of await visibleItems(candidate)) {
    if (await item.isEnabled().catch(() => false)) items.push(item)
  }
  return items
}

async function usePageCandidates(dialog: Locator): Promise<Locator[]> {
  const buttonItems = await enabledVisibleItems(
    dialog.getByRole('button', { name: PAGE_WALL_USE_PAGE_PATTERN })
  )
  if (buttonItems.length > 0) return buttonItems

  const linkItems = await enabledVisibleItems(
    dialog.getByRole('link', { name: PAGE_WALL_USE_PAGE_PATTERN })
  )
  if (linkItems.length > 0) return linkItems

  return enabledVisibleItems(
    dialog.locator(
      '[role="button"][aria-label="Use Page" i], '
      + '[role="button"][aria-label="Use this Page" i], '
      + '[role="button"][aria-label="Dùng Trang" i], '
      + '[role="button"][aria-label="Dùng Trang này" i], '
      + '[role="button"][aria-label="Sử dụng Trang" i], '
      + '[role="button"][aria-label="Sử dụng Trang này" i]'
    )
  )
}

export async function resolvePageWallUsePagePrompt(pageRoot: Locator): Promise<PageWallUsePageResolution> {
  const dialogs = pageRoot.locator('[role="dialog"], [aria-modal="true"]')
  const dialogCount = await dialogs.count().catch(() => 0)
  let visibleDialogCount = 0

  for (let index = dialogCount - 1; index >= 0; index -= 1) {
    const dialog = dialogs.nth(index)
    if (!await dialog.isVisible().catch(() => false)) continue
    visibleDialogCount += 1

    const candidates = await usePageCandidates(dialog)
    if (candidates.length > 0) {
      return {
        button: candidates.length === 1 ? candidates[0] ?? null : null,
        visibleDialogCount,
        candidateCount: candidates.length
      }
    }
  }

  return { button: null, visibleDialogCount, candidateCount: 0 }
}

export class PageWallUsePagePrompt {
  constructor(private readonly runtime: PreparedPageWallRuntime) {}

  private diagnostic(message: string): void {
    console.info(`[PAGE-AUTO page-wall-use-page] ${message}`)
  }

  private async observe(): Promise<PageWallUsePageResolution> {
    const pageRoot = this.runtime.page.locator('body')
    return probePageWallUsePagePrompt({
      resolve: () => resolvePageWallUsePagePrompt(pageRoot),
      wait: async (delayMs) => {
        await this.runtime.page.waitForTimeout(delayMs).catch(() => undefined)
      },
      graceMs: Math.min(PAGE_WALL_USE_PAGE_GRACE_MS, this.runtime.browser.navigationTimeoutMs),
      pollMs: PAGE_WALL_USE_PAGE_POLL_MS
    })
  }

  async complete(): Promise<FacebookCommonStepResult> {
    const resolution = await this.observe()
    const decision = resolvePageWallUsePageDecision(resolution.candidateCount)

    if (decision === 'skip') {
      return {
        status: 'success',
        message: 'Không có popup Use Page cần xử lý trên Tường Page.'
      }
    }
    if (decision === 'ambiguous' || !resolution.button) {
      return {
        status: 'failed',
        code: 'page_navigation_failed',
        message: `Popup Use Page có ${resolution.candidateCount} CTA khả dụng; không click mơ hồ.`
      }
    }

    const button = resolution.button
    if (!await button.isVisible().catch(() => false) || !await button.isEnabled().catch(() => false)) {
      return {
        status: 'failed',
        code: 'page_navigation_failed',
        message: 'Popup Use Page vừa thay đổi trước khi có thể xác nhận.'
      }
    }

    await this.runtime.pace('page-wall-use-page')
    const clickTimeoutMs = Math.max(
      500,
      Math.min(5_000, this.runtime.browser.navigationTimeoutMs)
    )
    try {
      await button.click({ timeout: clickTimeoutMs })
      this.diagnostic('stage=click sent')
    } catch (error) {
      return {
        status: 'failed',
        code: 'page_navigation_failed',
        message: `Đã thấy popup Use Page nhưng click thất bại: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    if (this.runtime.browser.pageSettleDelayMs > 0) {
      await this.runtime.page.waitForTimeout(this.runtime.browser.pageSettleDelayMs).catch(() => undefined)
    }

    const pageRoot = this.runtime.page.locator('body')
    const dismissed = await waitForPageWallUsePageDismissal({
      resolve: () => resolvePageWallUsePagePrompt(pageRoot),
      wait: async (delayMs) => {
        await this.runtime.page.waitForTimeout(delayMs).catch(() => undefined)
      },
      graceMs: Math.min(PAGE_WALL_USE_PAGE_DISMISS_MS, this.runtime.browser.navigationTimeoutMs),
      pollMs: PAGE_WALL_USE_PAGE_POLL_MS
    })
    if (!dismissed) {
      return {
        status: 'failed',
        code: 'page_navigation_failed',
        message: 'Đã click Use Page nhưng popup vẫn còn; dừng có kiểm soát thay vì chờ vô hạn.'
      }
    }

    const access = await this.runtime.checkAccessBlock('sau khi xác nhận Use Page trên Tường Page')
    if (access.status !== 'success') return access

    this.diagnostic('stage=complete')
    return {
      status: 'success',
      message: 'Đã xác nhận Use Page và Tường Page tiếp tục sẵn sàng.'
    }
  }
}
