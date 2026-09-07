import type { Locator, Page } from 'playwright-core'
import type { ActionConfig, ActionResult } from '../../../../shared/actionRegistry'
import { ACTION_VERIFICATION_UNCERTAIN_CODE } from '../../../../shared/actionRuntime'
import type { ActionExecutor, ActionExecutorContext } from '../../../services/actionRunner'
import { browserUnavailable, configString, type BaseViewActionDependencies } from './actionSupport'

const BIO_DETAILS_URL = 'https://www.facebook.com/me?sk=about_details'
const DETAILS_TAB_NAME = 'Details about you'
const EMPTY_BIO_TRIGGER_NAME = 'Write some details about yourself'
const SAVE_NAME = /^(?:Save|Lưu)$/i
const CANCEL_NAME = /^(?:Cancel|Hủy)$/i

export interface ProfileBioActionDependencies extends BaseViewActionDependencies {}

function stopped(): ActionResult {
  return { status: 'stopped', code: 'action_stopped', message: 'Đổi Tiểu sử đã dừng trước khi Save.' }
}

function uncertain(message: string): ActionResult {
  return { status: 'failed', code: ACTION_VERIFICATION_UNCERTAIN_CODE, message }
}

async function uniqueVisible(locator: Locator): Promise<Locator | null> {
  const count = await locator.count().catch(() => 0)
  if (count !== 1) return null
  const candidate = locator.first()
  return await candidate.isVisible().catch(() => false) ? candidate : null
}

async function confirmDetailsTab(page: Page): Promise<boolean> {
  return Boolean(await uniqueVisible(page.getByRole('tab', { name: DETAILS_TAB_NAME, exact: true })))
}

async function renderedBioInAuditedSection(page: Page, target: string): Promise<boolean> {
  return page.evaluate((value) => {
    const normalize = (input: string | null | undefined): string => (input ?? '').replace(/\s+/g, ' ').trim()
    const expected = normalize(value)
    if (!expected) return false
    const visible = (element: Element): boolean => {
      const node = element as HTMLElement
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const isReadOnlyText = (element: Element): boolean => !element.closest([
      'textarea', 'input', '[contenteditable="true"]', '[role="textbox"]',
      'button', '[role="button"]', 'a', '[role="link"]', '[role="tab"]'
    ].join(','))
    const hasExactBio = (scope: Element): boolean => Array.from(scope.querySelectorAll('div,span,p'))
      .some((element) => visible(element) && isReadOnlyText(element) && normalize((element as HTMLElement).innerText || element.textContent) === expected)

    const labels = Array.from(document.querySelectorAll('div,span,h1,h2,h3,h4'))
      .filter((element) => visible(element) && normalize((element as HTMLElement).innerText || element.textContent) === 'About you')
    for (const label of labels) {
      let scope: Element | null = label
      for (let depth = 0; depth < 6 && scope; depth += 1) {
        if (hasExactBio(scope)) return true
        scope = scope.parentElement
      }
    }
    return false
  }, target).catch(() => false)
}

interface BioEditorContract {
  textarea: Locator
  save: Locator
  cancel: Locator
}

async function findAuditedEditor(page: Page): Promise<BioEditorContract | null> {
  const textarea = await uniqueVisible(page.locator('textarea:visible'))
  if (!textarea) return null
  let scope: Locator = textarea
  for (let depth = 0; depth < 7; depth += 1) {
    scope = scope.locator('xpath=..')
    const save = await uniqueVisible(scope.getByRole('button', { name: SAVE_NAME }))
    const cancel = await uniqueVisible(scope.getByRole('button', { name: CANCEL_NAME }))
    if (save && cancel) return { textarea, save, cancel }
  }
  return null
}

async function waitForControl(context: ActionExecutorContext): Promise<ActionResult | null> {
  if (context.control.isStopped()) return stopped()
  await context.control.waitIfPaused()
  return context.control.isStopped() ? stopped() : null
}

export class ProfileBioActionExecutor implements ActionExecutor {
  readonly actionType = 'profile.bio'

  constructor(private readonly dependencies: ProfileBioActionDependencies) {}

  async execute(context: ActionExecutorContext, config: ActionConfig): Promise<ActionResult> {
    const page = await this.dependencies.resolvePage(context.request)
    if (!page) return browserUnavailable('Đổi Tiểu sử')
    const target = configString(config, 'bio')
    if (!target.trim()) return { status: 'failed', code: 'profile_bio_value_required', message: 'Tiểu sử không được để trống.' }
    let saveAttempted = false

    try {
      let controlled = await waitForControl(context)
      if (controlled) return controlled
      await page.goto(BIO_DETAILS_URL, {
        waitUntil: 'domcontentloaded',
        timeout: this.dependencies.navigationTimeoutMs ?? 45_000
      })

      if (!await confirmDetailsTab(page)) {
        return {
          status: 'needs_attention',
          code: 'profile_bio_details_surface_unconfirmed',
          message: 'Không xác nhận được đúng tab “Details about you”; dừng để tránh sửa nhầm surface.'
        }
      }

      if (await renderedBioInAuditedSection(page, target)) {
        return {
          status: 'success',
          code: 'profile_bio_already_set',
          message: 'Tiểu sử đã đúng giá trị yêu cầu; không cần thay đổi.',
          data: { verified: true, mutated: false }
        }
      }

      const trigger = await uniqueVisible(page.getByRole('button', { name: EMPTY_BIO_TRIGGER_NAME, exact: true }))
      if (!trigger) {
        return {
          status: 'needs_attention',
          code: 'profile_bio_existing_edit_audit_required',
          message: 'Profile đang không ở empty-state Bio đã audit. Cần audit live đường Edit Bio hiện có trước khi cho phép thay đổi.'
        }
      }

      controlled = await waitForControl(context)
      if (controlled) return controlled
      await trigger.click()

      const editor = await findAuditedEditor(page)
      if (!editor) {
        return {
          status: 'needs_attention',
          code: 'profile_bio_editor_contract_changed',
          message: 'Không xác nhận được editor Tiểu sử với textarea + Save + Cancel như live audit.'
        }
      }

      controlled = await waitForControl(context)
      if (controlled) return controlled
      await editor.textarea.fill(target)
      const staged = await editor.textarea.inputValue().catch(() => '')
      if (staged !== target) {
        return {
          status: 'failed',
          code: 'profile_bio_fill_unverified',
          message: 'Đã nhập Tiểu sử nhưng giá trị trong textarea không khớp; chưa bấm Save.'
        }
      }
      if (!await editor.save.isEnabled().catch(() => false)) {
        return {
          status: 'failed',
          code: 'profile_bio_save_disabled',
          message: 'Nút Save chưa sẵn sàng; chưa commit thay đổi Tiểu sử.'
        }
      }

      controlled = await waitForControl(context)
      if (controlled) return controlled
      saveAttempted = true
      await editor.save.click()

      // From this point a consequential Save may already have committed. Never obey Stop by
      // abandoning verification and never retry blindly; read the post-state first.
      try {
        await page.goto(BIO_DETAILS_URL, {
          waitUntil: 'domcontentloaded',
          timeout: this.dependencies.navigationTimeoutMs ?? 45_000
        })
        if (!await confirmDetailsTab(page)) {
          return uncertain('Đã bấm Save nhưng không xác nhận lại được surface Tiểu sử; không retry tự động.')
        }
        if (!await renderedBioInAuditedSection(page, target)) {
          return uncertain('Đã bấm Save nhưng chưa đọc lại đúng Tiểu sử trong “About you”; không retry tự động.')
        }
        return {
          status: 'success',
          code: 'profile_bio_verified',
          message: 'Đã cập nhật và đọc lại đúng Tiểu sử.',
          data: { verified: true, mutated: true }
        }
      } catch {
        return uncertain('Đã bấm Save nhưng post-state verification gặp lỗi; không retry tự động.')
      }
    } catch (error) {
      if (saveAttempted) return uncertain('Save Tiểu sử đã được thử nhưng runtime mất xác nhận kết quả; không retry tự động.')
      return {
        status: 'failed',
        code: 'profile_bio_execution_failed',
        message: `Đổi Tiểu sử thất bại trước khi xác nhận Save: ${error instanceof Error ? error.name : 'runtime_error'}.`
      }
    }
  }
}
