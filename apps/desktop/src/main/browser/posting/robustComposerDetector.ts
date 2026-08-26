import type { Locator, Page } from 'playwright-core'
import {
  COMPOSER_MEDIA_PATTERN,
  COMPOSER_TITLE_PATTERN,
  COMPOSER_TRIGGER_PATTERN,
  formatComposerDiagnostics
} from './composerSurface'
import { pollForReady, readinessAttempts } from './postingReadiness'

const PUBLISH_PATTERN = /^(post|đăng)$/i
const POLL_MS = 250
const INITIAL_OBSERVE_MS = 1_500
const TRIGGER_TIMEOUT_MS = 18_000
const OPEN_TIMEOUT_MS = 18_000
const ACTION_SETTLE_MS = 850
const MAX_ANCESTOR_DEPTH = 48
const COMPOSER_BOUNDARY_ROLES = new Set(['banner', 'feed', 'main', 'navigation'])
const COMPOSER_BOUNDARY_TAGS = new Set(['body', 'html', 'header', 'main', 'nav'])

export type ComposerEditorStrategy = 'dialog-editor' | 'labeled-inline-editor'
export type ComposerContainerStrategy = 'dialog' | 'local-ancestor'
export type PublishCandidateStrategy = 'scoped-role' | 'scoped-aria' | 'page-unique-role' | 'page-unique-aria' | 'none'

export interface RobustComposerHandle {
  container: Locator
  textbox: Locator
  editorStrategy: ComposerEditorStrategy
  containerStrategy: ComposerContainerStrategy
}

export interface ComposerContainerSignals {
  textboxVisible: boolean
  textboxLabelMatches: boolean
  visibleTextboxCount: number
  titleVisible: boolean
  triggerVisible: boolean
  publishVisible: boolean
  mediaVisible: boolean
  fileInputCount: number
  inDialog: boolean
}

export interface PublishCandidateCounts {
  scopedRoleVisible: number
  scopedAriaVisible: number
  pageRoleVisible: number
  pageAriaVisible: number
  scopedRoleEnabled: number
  scopedAriaEnabled: number
  pageRoleEnabled: number
  pageAriaEnabled: number
}

export interface PublishCandidateResolution {
  button: Locator | null
  strategy: PublishCandidateStrategy
  counts: PublishCandidateCounts
}

interface NamedLocator {
  strategy: string
  locator: Locator
}

type ComposerTriggerOutcome =
  | { kind: 'handle'; handle: RobustComposerHandle }
  | { kind: 'clicked' }
  | { kind: 'footprint' }

export function isComposerContainerEvidence(signals: ComposerContainerSignals): boolean {
  if (!signals.textboxVisible) return false

  const actionEvidence = signals.publishVisible || signals.mediaVisible || signals.fileInputCount > 0
  if (!actionEvidence) return false

  if (signals.inDialog) {
    if (signals.textboxLabelMatches || signals.titleVisible) return true
    return signals.publishVisible
      && (signals.mediaVisible || signals.fileInputCount > 0)
      && signals.visibleTextboxCount === 1
  }

  // Inline composer ownership must stay tied to the editor itself. A generic comment
  // textbox is not allowed to borrow Create-post/media evidence from a shared ancestor.
  return signals.textboxLabelMatches && signals.visibleTextboxCount === 1
}

export function choosePublishCandidateStrategy(
  scopedRoleEnabled: number,
  scopedAriaEnabled: number,
  pageRoleEnabled: number,
  pageAriaEnabled: number
): PublishCandidateStrategy {
  if (scopedRoleEnabled > 0) return 'scoped-role'
  if (scopedAriaEnabled > 0) return 'scoped-aria'
  if (pageRoleEnabled === 1) return 'page-unique-role'
  if (pageRoleEnabled === 0 && pageAriaEnabled === 1) return 'page-unique-aria'
  return 'none'
}

export function formatPublishCandidateDiagnostics(resolution: PublishCandidateResolution): string {
  const { counts } = resolution
  return [
    `strategy=${resolution.strategy}`,
    `scoped{role=${counts.scopedRoleVisible}/${counts.scopedRoleEnabled},aria=${counts.scopedAriaVisible}/${counts.scopedAriaEnabled}}`,
    `page{role=${counts.pageRoleVisible}/${counts.pageRoleEnabled},aria=${counts.pageAriaVisible}/${counts.pageAriaEnabled}}`
  ].join(' ')
}

export function isComposerAncestorBoundary(tagName: string, role: string | null): boolean {
  const normalizedTag = tagName.trim().toLowerCase()
  const normalizedRole = role?.trim().toLowerCase() ?? ''
  return COMPOSER_BOUNDARY_TAGS.has(normalizedTag) || COMPOSER_BOUNDARY_ROLES.has(normalizedRole)
}

export function waitForComposerStage<T>(
  probe: () => Promise<T | null>,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>
): Promise<T | null> {
  return pollForReady(probe, {
    attempts: readinessAttempts(timeoutMs, POLL_MS),
    intervalMs: POLL_MS,
    sleep
  })
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

async function visibleItems(candidate: Locator): Promise<Locator[]> {
  const items: Locator[] = []
  const count = await candidate.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const item = candidate.nth(index)
    if (await item.isVisible().catch(() => false)) items.push(item)
  }
  return items
}

async function visibleCount(candidate: Locator): Promise<number> {
  return (await visibleItems(candidate)).length
}

async function visibleCountAcross(candidates: Locator[]): Promise<number> {
  let total = 0
  for (const candidate of candidates) total += await visibleCount(candidate)
  return total
}

async function enabledVisibleItems(candidate: Locator): Promise<Locator[]> {
  const visible = await visibleItems(candidate)
  const enabled: Locator[] = []
  for (const item of visible) {
    if (await item.isEnabled().catch(() => false)) enabled.push(item)
  }
  return enabled
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

function sanitizeAttribute(value: string | null): string {
  if (!value) return 'missing'
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b\d{4,}\b/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96) || 'empty'
}

async function locatorDescriptor(locator: Locator): Promise<string> {
  const metadata = await locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    ariaLabel: element.getAttribute('aria-label')
  })).catch(() => null)
  if (!metadata) return 'tag=detached role=unknown aria-label=missing'
  return `tag=${metadata.tag} role=${metadata.role ?? 'implicit/none'} aria-label=${sanitizeAttribute(metadata.ariaLabel)}`
}

export class RobustComposerDetector {
  private lastTriggerStrategy = 'not-attempted'
  private lastTriggerDescriptor = 'tag=none role=none aria-label=missing'

  constructor(private readonly page: Page) {}

  private stage(message: string): void {
    console.info(`[PAGE-AUTO composer] ${message}`)
  }

  private sleep(milliseconds: number): Promise<void> {
    return this.page.waitForTimeout(milliseconds).catch(() => undefined)
  }

  private strongTriggerCandidates(): NamedLocator[] {
    return [
      {
        strategy: 'role-button-accessible-name',
        locator: this.page.getByRole('button', { name: COMPOSER_TRIGGER_PATTERN })
      },
      {
        strategy: 'role-button-visible-text',
        locator: this.page.locator('[role="button"]').filter({ hasText: COMPOSER_TRIGGER_PATTERN })
      }
    ]
  }

  private triggerCandidates(): Locator[] {
    return [
      ...this.strongTriggerCandidates().map((candidate) => candidate.locator),
      this.page.getByText(COMPOSER_TRIGGER_PATTERN)
    ]
  }

  private publishRoleCandidates(root: Locator): Locator {
    return root.getByRole('button', { name: PUBLISH_PATTERN })
  }

  private publishAriaCandidates(root: Locator): Locator {
    return root.locator('[aria-label="Post" i], [aria-label="Đăng" i]')
  }

  private async signals(container: Locator, textbox: Locator, inDialog: boolean): Promise<ComposerContainerSignals> {
    const titleVisible = Boolean(await firstVisibleMatch([
      container.getByRole('heading', { name: COMPOSER_TITLE_PATTERN }),
      container.getByText(COMPOSER_TITLE_PATTERN)
    ]))
    const triggerVisible = Boolean(await firstVisibleMatch([
      container.getByRole('button', { name: COMPOSER_TRIGGER_PATTERN }),
      container.getByText(COMPOSER_TRIGGER_PATTERN)
    ]))
    const publishVisible = Boolean(await firstVisibleMatch([
      this.publishRoleCandidates(container),
      this.publishAriaCandidates(container)
    ]))
    const mediaVisible = Boolean(await firstVisibleMatch([
      container.getByRole('button', { name: COMPOSER_MEDIA_PATTERN }),
      container.getByLabel(COMPOSER_MEDIA_PATTERN),
      container.getByText(COMPOSER_MEDIA_PATTERN)
    ]))

    return {
      textboxVisible: await textbox.isVisible().catch(() => false),
      textboxLabelMatches: await textboxLabelMatches(textbox),
      visibleTextboxCount: await visibleCount(composerTextboxes(container)),
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
      const visible: Locator[] = []
      const labeled: Locator[] = []
      for (let textboxIndex = 0; textboxIndex < textboxCount; textboxIndex += 1) {
        const textbox = textboxes.nth(textboxIndex)
        if (!await textbox.isVisible().catch(() => false)) continue
        visible.push(textbox)
        if (await textboxLabelMatches(textbox)) labeled.push(textbox)
      }

      // A dialog-level title/footer belongs to every descendant. Prefer an editor
      // whose own accessibility label says it is the composer; only use an
      // unlabeled editor when the dialog has exactly one visible textbox.
      const ownedCandidates = labeled.length > 0 ? labeled : visible.length === 1 ? visible : []
      for (let index = ownedCandidates.length - 1; index >= 0; index -= 1) {
        const textbox = ownedCandidates[index]!
        const signals = await this.signals(dialog, textbox, true)
        if (isComposerContainerEvidence(signals)) {
          return {
            container: dialog,
            textbox,
            editorStrategy: 'dialog-editor',
            containerStrategy: 'dialog'
          }
        }
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
      if (!await textboxLabelMatches(textbox)) continue

      let container = textbox
      for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        container = container.locator('xpath=..')
        const tagName = await container.evaluate((node) => node.tagName.toLowerCase()).catch(() => '')
        if (!tagName) break
        const role = await container.getAttribute('role').catch(() => null)
        if (isComposerAncestorBoundary(tagName, role)) break

        const ariaModal = await container.getAttribute('aria-modal').catch(() => null)
        const signals = await this.signals(container, textbox, role === 'dialog' || ariaModal === 'true')
        if (isComposerContainerEvidence(signals)) {
          return {
            container,
            textbox,
            editorStrategy: 'labeled-inline-editor',
            containerStrategy: 'local-ancestor'
          }
        }
      }
    }
    return null
  }

  async resolve(): Promise<RobustComposerHandle | null> {
    return await this.findInDialogs() ?? await this.findByTextboxAncestor()
  }

  private async hasOpenComposerFootprint(): Promise<boolean> {
    if (await this.resolve()) return true
    if (await firstVisibleMatch([
      this.page.getByRole('heading', { name: COMPOSER_TITLE_PATTERN }),
      this.page.getByText(COMPOSER_TITLE_PATTERN)
    ])) return true
    return false
  }

  private async waitForHandle(timeoutMs: number): Promise<RobustComposerHandle | null> {
    let dialogReported = false
    const handle = await waitForComposerStage(async () => {
      if (this.page.isClosed()) return null
      if (!dialogReported) {
        const dialogs = this.page.locator('[role="dialog"], [aria-modal="true"]')
        if (await visibleCount(dialogs) > 0) {
          dialogReported = true
          this.stage('stage=dialog_ready')
        }
      }
      return this.resolve()
    }, timeoutMs, (milliseconds) => this.sleep(milliseconds))

    if (handle) {
      this.stage(`stage=textbox_ready editor=${handle.editorStrategy} container=${handle.containerStrategy}`)
    }
    return handle
  }

  private async waitForTriggerOrComposer(timeoutMs: number): Promise<ComposerTriggerOutcome | null> {
    return waitForComposerStage(async () => {
      if (this.page.isClosed()) return null

      const handle = await this.resolve()
      if (handle) {
        this.lastTriggerStrategy = 'composer-opened-during-trigger-wait'
        this.lastTriggerDescriptor = 'tag=existing role=existing aria-label=not-applicable'
        return { kind: 'handle', handle }
      }

      if (await this.hasOpenComposerFootprint()) {
        this.lastTriggerStrategy = 'composer-footprint-during-trigger-wait'
        this.lastTriggerDescriptor = 'tag=surface role=unknown aria-label=not-applicable'
        return { kind: 'footprint' }
      }

      for (const candidate of this.strongTriggerCandidates()) {
        const count = await candidate.locator.count().catch(() => 0)
        for (let index = 0; index < count; index += 1) {
          const item = candidate.locator.nth(index)
          if (!await item.isVisible().catch(() => false)) continue
          if (!await item.isEnabled().catch(() => false)) continue

          this.lastTriggerStrategy = `${candidate.strategy}[${index}]`
          this.lastTriggerDescriptor = await locatorDescriptor(item)
          this.stage(`stage=trigger_ready strategy=${this.lastTriggerStrategy} triggerElement{${this.lastTriggerDescriptor}}`)
          const clicked = await item.click({ timeout: 8_000 }).then(() => true).catch(() => false)
          if (clicked) {
            this.stage(`stage=trigger_click sent strategy=${this.lastTriggerStrategy}`)
            return { kind: 'clicked' }
          }
          this.stage(`stage=trigger_click retry strategy=${this.lastTriggerStrategy}`)
        }
      }

      return null
    }, timeoutMs, (milliseconds) => this.sleep(milliseconds))
  }

  async publishCandidates(): Promise<PublishCandidateResolution> {
    const handle = await this.resolve()
    const scopedRole = handle ? this.publishRoleCandidates(handle.container) : this.page.locator('__page_auto_no_scoped_publish__')
    const scopedAria = handle ? this.publishAriaCandidates(handle.container) : this.page.locator('__page_auto_no_scoped_publish__')
    const pageRole = this.publishRoleCandidates(this.page.locator('body'))
    const pageAria = this.publishAriaCandidates(this.page.locator('body'))

    const scopedRoleEnabled = await enabledVisibleItems(scopedRole)
    const scopedAriaEnabled = await enabledVisibleItems(scopedAria)
    const pageRoleEnabled = await enabledVisibleItems(pageRole)
    const pageAriaEnabled = await enabledVisibleItems(pageAria)
    const counts: PublishCandidateCounts = {
      scopedRoleVisible: await visibleCount(scopedRole),
      scopedAriaVisible: await visibleCount(scopedAria),
      pageRoleVisible: await visibleCount(pageRole),
      pageAriaVisible: await visibleCount(pageAria),
      scopedRoleEnabled: scopedRoleEnabled.length,
      scopedAriaEnabled: scopedAriaEnabled.length,
      pageRoleEnabled: pageRoleEnabled.length,
      pageAriaEnabled: pageAriaEnabled.length
    }
    const strategy = choosePublishCandidateStrategy(
      counts.scopedRoleEnabled,
      counts.scopedAriaEnabled,
      counts.pageRoleEnabled,
      counts.pageAriaEnabled
    )

    if (strategy === 'scoped-role') return { button: scopedRoleEnabled[0] ?? null, strategy, counts }
    if (strategy === 'scoped-aria') return { button: scopedAriaEnabled[0] ?? null, strategy, counts }

    // A footer can be portaled outside the editor/dialog. Only leave the resolved
    // composer scope when Facebook exposes one unique enabled publish control page-wide.
    if (strategy === 'page-unique-role') return { button: pageRoleEnabled[0] ?? null, strategy, counts }
    if (strategy === 'page-unique-aria') return { button: pageAriaEnabled[0] ?? null, strategy, counts }
    return { button: null, strategy: 'none', counts }
  }

  async publishDiagnostics(): Promise<string> {
    return formatPublishCandidateDiagnostics(await this.publishCandidates())
  }

  async selectionDiagnostics(handle: RobustComposerHandle): Promise<string> {
    const editorCount = await visibleCount(composerTextboxes(this.page.locator('body')))
    return [
      `trigger=${this.lastTriggerStrategy}`,
      `triggerElement{${this.lastTriggerDescriptor}}`,
      `editorCount=${editorCount}`,
      `editorStrategy=${handle.editorStrategy}`,
      `containerStrategy=${handle.containerStrategy}`
    ].join(' ')
  }

  async diagnostics(): Promise<string> {
    const dialogs = this.page.locator('[role="dialog"], [aria-modal="true"]')
    const textboxes = composerTextboxes(this.page.locator('body'))
    const publishButtons = this.page.getByRole('button', { name: PUBLISH_PATTERN })
    const surface = formatComposerDiagnostics({
      dialogCount: await visibleCount(dialogs),
      textboxCount: await visibleCount(textboxes),
      triggerCount: await visibleCountAcross(this.triggerCandidates()),
      publishButtonCount: await visibleCount(publishButtons),
      fileInputCount: await this.page.locator('input[type="file"]').count().catch(() => 0),
      url: this.page.url()
    })
    return `${surface} trigger=${this.lastTriggerStrategy} triggerElement{${this.lastTriggerDescriptor}}`
  }

  async open(): Promise<RobustComposerHandle | null> {
    this.stage(`stage=existing_editor_wait timeoutMs=${INITIAL_OBSERVE_MS}`)
    const existing = await this.waitForHandle(INITIAL_OBSERVE_MS)
    if (existing) {
      this.lastTriggerStrategy = 'existing-composer'
      this.lastTriggerDescriptor = 'tag=existing role=existing aria-label=not-applicable'
      return existing
    }

    this.stage(`stage=trigger_wait timeoutMs=${TRIGGER_TIMEOUT_MS}`)
    const triggerOutcome = await this.waitForTriggerOrComposer(TRIGGER_TIMEOUT_MS)
    if (!triggerOutcome) {
      this.stage('stage=trigger_timeout')
      return null
    }
    if (triggerOutcome.kind === 'handle') return triggerOutcome.handle
    if (triggerOutcome.kind === 'clicked') {
      await this.page.waitForTimeout(ACTION_SETTLE_MS).catch(() => undefined)
    }

    this.stage(`stage=editor_wait timeoutMs=${OPEN_TIMEOUT_MS}`)
    const handle = await this.waitForHandle(OPEN_TIMEOUT_MS)
    if (!handle) this.stage('stage=editor_timeout')
    return handle
  }
}
