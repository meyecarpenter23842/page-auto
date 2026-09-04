import type { Locator } from 'playwright-core'
import type { PostingJobResult } from '../../../shared/posting'
import { PublishAction } from '../../browser/posting/postingEngine'
import {
  formatPublishCandidateDiagnostics,
  waitForComposerStage,
  type RobustComposerDetector
} from '../../browser/posting/robustComposerDetector'
import type { PreparedPageWallRuntime } from './pageWallTask'

const PAGE_WALL_ADVANCE_PATTERN = /^(next|tiếp|tiếp theo)$/i
const PAGE_WALL_OPTIONAL_CTA_TITLE_PATTERN = /^(speak to people directly|nói chuyện trực tiếp với mọi người)$/i
const PAGE_WALL_OPTIONAL_CTA_ADD_PATTERN = /^(add button|thêm nút)$/i
const PAGE_WALL_OPTIONAL_CTA_DISMISS_PATTERN = /^(not now|để sau|lúc khác|không phải bây giờ)$/i

type PageWallAdvanceCandidateStrategy =
  | 'scoped-role'
  | 'scoped-aria'
  | 'page-unique-role'
  | 'page-unique-aria'
  | 'none'

interface PageWallAdvanceCandidateCounts {
  scopedRoleVisible: number
  scopedAriaVisible: number
  pageRoleVisible: number
  pageAriaVisible: number
  scopedRoleEnabled: number
  scopedAriaEnabled: number
  pageRoleEnabled: number
  pageAriaEnabled: number
}

export interface PageWallAdvanceCandidateResolution {
  button: Locator | null
  strategy: PageWallAdvanceCandidateStrategy
  counts: PageWallAdvanceCandidateCounts
}

export interface PageWallOptionalCtaPromptResolution {
  dismissButton: Locator | null
  titleVisible: number
  addButtonEnabled: number
  dismissButtonEnabled: number
}

export type PageWallPublishStage =
  | { kind: 'publish' }
  | { kind: 'advance'; resolution: PageWallAdvanceCandidateResolution }

export type PageWallFinalPublishStage =
  | { kind: 'publish' }
  | { kind: 'optional-cta'; resolution: PageWallOptionalCtaPromptResolution }

function failure(message: string): PostingJobResult {
  return { status: 'failed', code: 'publish_action_failed', message }
}

function commonResult(result: Awaited<ReturnType<PreparedPageWallRuntime['checkAccessBlock']>>): PostingJobResult {
  return {
    status: result.status,
    ...(result.code ? { code: result.code } : {}),
    message: result.message,
    ...(result.sessionValidation ? { sessionValidation: result.sessionValidation } : {})
  }
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
  const enabled: Locator[] = []
  for (const item of await visibleItems(candidate)) {
    if (await item.isEnabled().catch(() => false)) enabled.push(item)
  }
  return enabled
}

async function firstEnabledVisibleSet(primary: Locator, fallback: Locator): Promise<Locator[]> {
  const primaryItems = await enabledVisibleItems(primary)
  if (primaryItems.length > 0) return primaryItems
  return enabledVisibleItems(fallback)
}

function advanceRoleCandidates(root: Locator): Locator {
  return root.getByRole('button', { name: PAGE_WALL_ADVANCE_PATTERN })
}

function advanceAriaCandidates(root: Locator): Locator {
  return root.locator('[aria-label="Next" i], [aria-label="Tiếp" i], [aria-label="Tiếp theo" i]')
}

export function choosePageWallAdvanceCandidateStrategy(
  scopedRoleEnabled: number,
  scopedAriaEnabled: number,
  pageRoleEnabled: number,
  pageAriaEnabled: number
): PageWallAdvanceCandidateStrategy {
  if (scopedRoleEnabled === 1) return 'scoped-role'
  if (scopedRoleEnabled > 1) return 'none'
  if (scopedAriaEnabled === 1) return 'scoped-aria'
  if (scopedAriaEnabled > 1) return 'none'
  if (pageRoleEnabled === 1) return 'page-unique-role'
  if (pageRoleEnabled > 1) return 'none'
  if (pageAriaEnabled === 1) return 'page-unique-aria'
  return 'none'
}

export function isPageWallOptionalCtaPromptOwned(
  titleVisible: number,
  addButtonEnabled: number,
  dismissButtonEnabled: number
): boolean {
  return titleVisible === 1 && addButtonEnabled === 1 && dismissButtonEnabled === 1
}

export function formatPageWallAdvanceDiagnostics(resolution: PageWallAdvanceCandidateResolution): string {
  const { counts } = resolution
  return [
    `strategy=${resolution.strategy}`,
    `scoped{role=${counts.scopedRoleVisible}/${counts.scopedRoleEnabled},aria=${counts.scopedAriaVisible}/${counts.scopedAriaEnabled}}`,
    `page{role=${counts.pageRoleVisible}/${counts.pageRoleEnabled},aria=${counts.pageAriaVisible}/${counts.pageAriaEnabled}}`
  ].join(' ')
}

export function formatPageWallOptionalCtaDiagnostics(resolution: PageWallOptionalCtaPromptResolution): string {
  return `title=${resolution.titleVisible} add=${resolution.addButtonEnabled} dismiss=${resolution.dismissButtonEnabled}`
}

async function resolvePageWallAdvanceCandidate(page: Locator, container: Locator): Promise<PageWallAdvanceCandidateResolution> {
  const scopedRole = advanceRoleCandidates(container)
  const scopedAria = advanceAriaCandidates(container)
  const pageRole = advanceRoleCandidates(page)
  const pageAria = advanceAriaCandidates(page)

  const scopedRoleEnabled = await enabledVisibleItems(scopedRole)
  const scopedAriaEnabled = await enabledVisibleItems(scopedAria)
  const pageRoleEnabled = await enabledVisibleItems(pageRole)
  const pageAriaEnabled = await enabledVisibleItems(pageAria)
  const counts: PageWallAdvanceCandidateCounts = {
    scopedRoleVisible: (await visibleItems(scopedRole)).length,
    scopedAriaVisible: (await visibleItems(scopedAria)).length,
    pageRoleVisible: (await visibleItems(pageRole)).length,
    pageAriaVisible: (await visibleItems(pageAria)).length,
    scopedRoleEnabled: scopedRoleEnabled.length,
    scopedAriaEnabled: scopedAriaEnabled.length,
    pageRoleEnabled: pageRoleEnabled.length,
    pageAriaEnabled: pageAriaEnabled.length
  }
  const strategy = choosePageWallAdvanceCandidateStrategy(
    counts.scopedRoleEnabled,
    counts.scopedAriaEnabled,
    counts.pageRoleEnabled,
    counts.pageAriaEnabled
  )

  if (strategy === 'scoped-role') return { button: scopedRoleEnabled[0] ?? null, strategy, counts }
  if (strategy === 'scoped-aria') return { button: scopedAriaEnabled[0] ?? null, strategy, counts }
  if (strategy === 'page-unique-role') return { button: pageRoleEnabled[0] ?? null, strategy, counts }
  if (strategy === 'page-unique-aria') return { button: pageAriaEnabled[0] ?? null, strategy, counts }
  return { button: null, strategy: 'none', counts }
}

export async function resolvePageWallOptionalCtaPrompt(pageRoot: Locator): Promise<PageWallOptionalCtaPromptResolution> {
  const empty: PageWallOptionalCtaPromptResolution = {
    dismissButton: null,
    titleVisible: 0,
    addButtonEnabled: 0,
    dismissButtonEnabled: 0
  }
  const dialogs = pageRoot.locator('[role="dialog"], [aria-modal="true"]')
  const dialogCount = await dialogs.count().catch(() => 0)

  for (let index = dialogCount - 1; index >= 0; index -= 1) {
    const dialog = dialogs.nth(index)
    if (!await dialog.isVisible().catch(() => false)) continue

    const headingItems = await visibleItems(dialog.getByRole('heading', { name: PAGE_WALL_OPTIONAL_CTA_TITLE_PATTERN }))
    const titleItems = headingItems.length > 0
      ? headingItems
      : await visibleItems(dialog.getByText(PAGE_WALL_OPTIONAL_CTA_TITLE_PATTERN))
    const addButtons = await firstEnabledVisibleSet(
      dialog.getByRole('button', { name: PAGE_WALL_OPTIONAL_CTA_ADD_PATTERN }),
      dialog.locator('[aria-label="Add Button" i], [aria-label="Thêm nút" i]')
    )
    const dismissButtons = await firstEnabledVisibleSet(
      dialog.getByRole('button', { name: PAGE_WALL_OPTIONAL_CTA_DISMISS_PATTERN }),
      dialog.locator('[aria-label="Not now" i], [aria-label="Để sau" i], [aria-label="Lúc khác" i], [aria-label="Không phải bây giờ" i]')
    )
    const resolution: PageWallOptionalCtaPromptResolution = {
      dismissButton: null,
      titleVisible: titleItems.length,
      addButtonEnabled: addButtons.length,
      dismissButtonEnabled: dismissButtons.length
    }

    if (isPageWallOptionalCtaPromptOwned(
      resolution.titleVisible,
      resolution.addButtonEnabled,
      resolution.dismissButtonEnabled
    )) {
      return { ...resolution, dismissButton: dismissButtons[0] ?? null }
    }
  }

  return empty
}

export function waitForPageWallPublishStage(
  probePublish: () => Promise<boolean>,
  probeAdvance: () => Promise<PageWallAdvanceCandidateResolution>,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>
): Promise<PageWallPublishStage | null> {
  return waitForComposerStage(async () => {
    if (await probePublish()) return { kind: 'publish' }
    const resolution = await probeAdvance()
    if (resolution.button) return { kind: 'advance', resolution }
    return null
  }, timeoutMs, sleep)
}

export function waitForPageWallFinalPublishStage(
  probeOptionalCta: () => Promise<PageWallOptionalCtaPromptResolution>,
  probePublish: () => Promise<boolean>,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>
): Promise<PageWallFinalPublishStage | null> {
  return waitForComposerStage(async () => {
    const optionalCta = await probeOptionalCta()
    if (optionalCta.dismissButton) return { kind: 'optional-cta', resolution: optionalCta }
    if (await probePublish()) return { kind: 'publish' }
    return null
  }, timeoutMs, sleep)
}

export class PageWallPublishAction {
  constructor(
    private readonly runtime: PreparedPageWallRuntime,
    private readonly composerDetector: RobustComposerDetector,
    private readonly networkTimeoutMs: number
  ) {}

  private diagnostic(message: string): void {
    console.info(`[PAGE-AUTO page-wall-publish] ${message}`)
  }

  private async settle(): Promise<void> {
    if (this.runtime.browser.pageSettleDelayMs > 0) {
      await this.runtime.page.waitForTimeout(this.runtime.browser.pageSettleDelayMs).catch(() => undefined)
    }
  }

  async click(container: Locator): Promise<PostingJobResult> {
    let lastAdvanceDiagnostics = 'strategy=not-probed'
    const pageRoot = this.runtime.page.locator('body')
    const ready = await waitForPageWallPublishStage(
      async () => Boolean((await this.composerDetector.publishCandidates()).button),
      async () => {
        const resolution = await resolvePageWallAdvanceCandidate(pageRoot, container)
        lastAdvanceDiagnostics = formatPageWallAdvanceDiagnostics(resolution)
        return resolution
      },
      this.networkTimeoutMs,
      (milliseconds) => this.runtime.page.waitForTimeout(milliseconds).catch(() => undefined)
    )

    if (!ready) {
      const publishDiagnostics = formatPublishCandidateDiagnostics(await this.composerDetector.publishCandidates())
      return failure(
        `Không tìm thấy bước Next/Tiếp theo hoặc nút Đăng/Post sẵn sàng trong composer Tường. `
        + `advance{${lastAdvanceDiagnostics}} publish{${publishDiagnostics}}`
      )
    }

    if (ready.kind === 'advance') {
      const { button } = ready.resolution
      if (!button) return failure('Bước Next/Tiếp theo biến mất trước khi click.')

      this.diagnostic(`stage=advance_ready ${formatPageWallAdvanceDiagnostics(ready.resolution)}`)
      await this.settle()
      if (!await button.isEnabled().catch(() => false)) {
        return failure(`Nút Next/Tiếp theo vừa chuyển sang trạng thái chưa sẵn sàng. ${formatPageWallAdvanceDiagnostics(ready.resolution)}`)
      }

      await button.click({ timeout: this.networkTimeoutMs })
      this.diagnostic('stage=advance_click sent')
      await this.settle()

      const access = await this.runtime.checkAccessBlock('sau khi chuyển bước Next của composer Đăng Tường')
      if (access.status !== 'success') return commonResult(access)
      this.diagnostic('stage=advance_access ready')
    } else {
      this.diagnostic('stage=final_publish_already_visible')
    }

    const finalStage = await waitForPageWallFinalPublishStage(
      () => resolvePageWallOptionalCtaPrompt(pageRoot),
      async () => Boolean((await this.composerDetector.publishCandidates()).button),
      this.networkTimeoutMs,
      (milliseconds) => this.runtime.page.waitForTimeout(milliseconds).catch(() => undefined)
    )
    if (!finalStage) {
      const publishDiagnostics = formatPublishCandidateDiagnostics(await this.composerDetector.publishCandidates())
      return failure(`Không thấy nút Đăng/Post cuối hoặc CTA tùy chọn hợp lệ sau bước Next. publish{${publishDiagnostics}}`)
    }

    if (finalStage.kind === 'optional-cta') {
      const { dismissButton } = finalStage.resolution
      if (!dismissButton) return failure('CTA tùy chọn biến mất trước khi có thể chọn Not now/Để sau.')

      this.diagnostic(`stage=optional_cta_ready ${formatPageWallOptionalCtaDiagnostics(finalStage.resolution)}`)
      await this.settle()
      if (!await dismissButton.isEnabled().catch(() => false)) {
        return failure(`Nút Not now/Để sau vừa chuyển sang trạng thái chưa sẵn sàng. ${formatPageWallOptionalCtaDiagnostics(finalStage.resolution)}`)
      }
      await dismissButton.click({ timeout: this.networkTimeoutMs })
      this.diagnostic('stage=optional_cta_dismiss sent')
      await this.settle()

      const access = await this.runtime.checkAccessBlock('sau khi bỏ qua CTA tùy chọn của composer Đăng Tường')
      if (access.status !== 'success') return commonResult(access)
      this.diagnostic('stage=optional_cta_access ready')
    }

    this.diagnostic('stage=final_publish_wait')
    return new PublishAction(
      this.runtime.page,
      this.composerDetector,
      this.networkTimeoutMs,
      this.runtime.browser.pageSettleDelayMs
    ).click(container)
  }
}
