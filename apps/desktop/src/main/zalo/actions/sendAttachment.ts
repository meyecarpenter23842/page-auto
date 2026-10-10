import { basename, extname } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { zaloActionResult, type ZaloActionInput, type ZaloActionResult } from '../../../shared/zalo'
import type { ZaloActionControl } from './zaloActionControl'
import { resolveZaloTarget } from './zaloTargetResolver'

type SendAttachmentInput = Extract<ZaloActionInput, { type: 'send_attachment' }>
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.bmp', '.avif', '.heic', '.heif'])

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const candidate = locator.first()
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function deliveryEvidenceCount(page: Page): Promise<number> {
  return page.getByText(/^(Đang gửi|Đã gửi|Đã nhận|Đã xem)$/i).count().catch(() => 0)
}

async function inputMatchesKind(input: Locator, image: boolean): Promise<boolean> {
  const accept = ((await input.getAttribute('accept').catch(() => null)) ?? '').toLocaleLowerCase()
  if (!accept) return true
  return image ? accept.includes('image') : !accept.includes('image')
}

async function revealedFileInput(
  page: Page,
  image: boolean,
  beforeCount: number
): Promise<Locator | null> {
  const chatInputs = await page.locator([
    '#chat-box-bar-id input[type="file"]',
    '#chat-input-container-id input[type="file"]'
  ].join(', ')).all()
  for (const input of chatInputs) {
    if (await inputMatchesKind(input, image)) return input
  }

  const allInputs = page.locator('input[type="file"]')
  const afterCount = await allInputs.count()
  for (let index = beforeCount; index < afterCount; index += 1) {
    const input = allInputs.nth(index)
    if (await inputMatchesKind(input, image)) return input
  }
  return null
}

async function attachmentTrigger(page: Page, image: boolean): Promise<Locator | null> {
  const locators = image
    ? [
      page.locator('#chat-box-bar-id [data-translate-title="STR_SEND_PHOTO"][icon="Photo_24_Line"]'),
      page.locator('#chat-box-bar-id [data-translate-title="STR_SEND_PHOTO"]'),
      page.locator('#chat-box-bar-id [icon="Photo_24_Line"]'),
      page.locator('#chat-box-bar-id i.fa-Photo_24_Line'),
      page.locator('[data-translate-title="STR_SEND_PHOTO"][title="Gửi hình ảnh"]'),
      page.locator('[icon="Photo_24_Line"][title="Gửi hình ảnh"]')
    ]
    : [
      page.locator('#chat-box-bar-id [data-translate-title="STR_SEND_FILE"]'),
      page.locator('#chat-box-bar-id [title*="Gửi file" i]'),
      page.locator('#chat-box-bar-id [title*="Tài liệu" i]'),
      page.locator('[data-translate-title="STR_SEND_FILE"]')
    ]

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const trigger = await firstVisible(locators)
    if (trigger) {
      const tagName = await trigger.evaluate((element) => element.tagName.toLowerCase()).catch(() => '')
      if (tagName === 'i' || tagName === 'svg' || tagName === 'span') {
        const parent = trigger.locator('xpath=ancestor::*[@data-translate-title or contains(@class,"chat-box-toolbar-button")][1]')
        if (await parent.isVisible().catch(() => false)) return parent
      }
      return trigger
    }
    await page.waitForTimeout(100)
  }
  return null
}

type AttachmentBindResult =
  | { ok: true; method: 'filechooser' | 'revealed_input' }
  | { ok: false; stage: 'trigger_missing' | 'trigger_click_failed' | 'chooser_missing' | 'set_files_failed' }

async function setZaloAttachmentFile(
  page: Page,
  path: string,
  image: boolean,
  control: ZaloActionControl
): Promise<AttachmentBindResult> {
  const trigger = await attachmentTrigger(page, image)
  if (!trigger) return { ok: false, stage: 'trigger_missing' }

  const beforeCount = await page.locator('input[type="file"]').count()
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 5_000 }).catch(() => null)
  const clicked = await trigger.click({ timeout: 5_000 }).then(() => true).catch(() => false)
  if (!clicked) return { ok: false, stage: 'trigger_click_failed' }

  const fileChooser = await chooserPromise
  if (fileChooser) {
    const set = await fileChooser.setFiles(path).then(() => true).catch(() => false)
    return set ? { ok: true, method: 'filechooser' } : { ok: false, stage: 'set_files_failed' }
  }

  await control.sleep(350)
  const revealedInput = await revealedFileInput(page, image, beforeCount)
  if (!revealedInput) return { ok: false, stage: 'chooser_missing' }
  const set = await revealedInput.setInputFiles(path).then(() => true).catch(() => false)
  return set ? { ok: true, method: 'revealed_input' } : { ok: false, stage: 'set_files_failed' }
}

async function optionalSendButton(page: Page): Promise<Locator | null> {
  const direct = await firstVisible([
    page.locator('#chatInput [data-translate-title="STR_SEND_MESSAGE"]'),
    page.locator('#chatInput [data-translate-title="STR_SEND"]'),
    page.locator('#chatInput [title="Gửi"]'),
    page.locator('#chatInput [icon*="Send" i]'),
    page.locator('#chatInput i[class*="Send"][class*="24"]'),
    page.getByRole('button', { name: /^Gửi$/i }),
    page.locator('button[aria-label*="Gửi" i]')
  ])
  if (!direct) return null
  const tagName = await direct.evaluate((element) => element.tagName.toLowerCase()).catch(() => '')
  if (tagName === 'i' || tagName === 'svg' || tagName === 'span') {
    const clickable = direct.locator('xpath=ancestor::*[self::button or @role="button" or contains(@class,"z--btn") or contains(@class,"chat-box")][1]')
    if (await clickable.isVisible().catch(() => false)) return clickable
    return direct.locator('xpath=..')
  }
  return direct
}

export async function sendZaloAttachment(
  accountId: number,
  page: Page,
  input: SendAttachmentInput,
  control: ZaloActionControl
): Promise<ZaloActionResult> {
  const target = await resolveZaloTarget(page, input.targetPhone, control, { requireConversation: true })
  if (!target.ok) {
    return zaloActionResult(accountId, input.type, input.targetPhone, 'failed', target.code, target.message)
  }

  let sentCount = 0
  for (const path of input.paths) {
    await control.checkpoint()
    const image = IMAGE_EXTENSIONS.has(extname(path).toLocaleLowerCase())
    const beforeDelivery = await deliveryEvidenceCount(page)
    const beforeName = await page.getByText(basename(path), { exact: false }).count().catch(() => 0)

    const attached = await setZaloAttachmentFile(page, path, image, control)
    if (!attached.ok) {
      const stageMessage: Record<typeof attached.stage, string> = {
        trigger_missing: 'Không thấy nút ảnh/file trong #chat-box-bar-id.',
        trigger_click_failed: 'Đã thấy nút ảnh/file nhưng click control thất bại.',
        chooser_missing: 'Đã click nút ảnh/file nhưng Zalo không mở filechooser hoặc input upload trong vùng chat.',
        set_files_failed: 'Đã mở control upload nhưng Playwright không set được file.'
      }
      return zaloActionResult(accountId, input.type, target.targetPhone, 'failed', 'attachment_control_missing', stageMessage[attached.stage], {
        verifiedTarget: true,
        targetDisplayName: target.displayName,
        data: { sentCount, total: input.paths.length, stage: attached.stage, file: basename(path) }
      })
    }
    await control.sleep(400)
    const send = await optionalSendButton(page)
    if (send && await send.isEnabled().catch(() => false)) {
      await control.checkpoint()
      await send.click({ timeout: 5_000 }).catch(() => undefined)
    }

    let verified = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await control.sleep(250)
      const delivery = await deliveryEvidenceCount(page)
      const fileNameCount = await page.getByText(basename(path), { exact: false }).count().catch(() => beforeName)
      if (delivery > beforeDelivery || fileNameCount > beforeName) {
        verified = true
        break
      }
    }
    if (!verified) {
      return zaloActionResult(accountId, input.type, target.targetPhone, 'failed', 'verification_uncertain', `Không đủ bằng chứng xác minh attachment ${basename(path)} đã được gửi.`, {
        verifiedTarget: true,
        targetDisplayName: target.displayName,
        data: { sentCount, total: input.paths.length, failedFile: basename(path) }
      })
    }
    sentCount += 1
  }

  return zaloActionResult(accountId, input.type, target.targetPhone, 'success', 'success', `Đã xác minh ${sentCount}/${input.paths.length} ảnh/file trong conversation đúng target.`, {
    verifiedTarget: true,
    targetDisplayName: target.displayName,
    data: { sentCount, total: input.paths.length }
  })
}
