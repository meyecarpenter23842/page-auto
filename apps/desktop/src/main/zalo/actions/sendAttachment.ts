import { basename, extname } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { zaloActionResult, type ZaloActionInput, type ZaloActionResult } from '../../../shared/zalo'
import type { ZaloActionControl } from './zaloActionControl'
import { resolveZaloTarget } from './zaloTargetResolver'

type SendAttachmentInput = Extract<ZaloActionInput, { type: 'send_attachment' }>
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])

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

async function chooseFileInput(page: Page, image: boolean): Promise<Locator | null> {
  const inputs = await page.locator('input[type="file"]').all()
  for (const input of inputs) {
    const accept = ((await input.getAttribute('accept').catch(() => null)) ?? '').toLocaleLowerCase()
    if (image && accept.includes('image')) return input
    if (!image && accept && !accept.includes('image')) return input
  }
  return inputs[inputs.length - 1] ?? null
}

async function attachmentTrigger(page: Page, image: boolean): Promise<Locator | null> {
  return image
    ? firstVisible([
      page.getByRole('button', { name: /Ảnh|Hình ảnh|Photo/i }),
      page.locator('[aria-label*="Ảnh" i]'),
      page.locator('[title*="Ảnh" i]')
    ])
    : firstVisible([
      page.getByRole('button', { name: /Tài liệu|File/i }),
      page.locator('[aria-label*="Tài liệu" i]'),
      page.locator('[title*="Tài liệu" i]')
    ])
}

async function setZaloAttachmentFile(
  page: Page,
  path: string,
  image: boolean,
  control: ZaloActionControl
): Promise<boolean> {
  const directInput = await chooseFileInput(page, image)
  if (directInput) {
    await directInput.setInputFiles(path)
    return true
  }

  const trigger = await attachmentTrigger(page, image)
  if (!trigger) return false

  // Some live Zalo builds keep no file input in the DOM until the toolbar
  // control is clicked and instead emit a native filechooser event.
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 3_000 }).catch(() => null)
  const clicked = await trigger.click({ timeout: 5_000 }).then(() => true).catch(() => false)
  if (!clicked) return false

  const fileChooser = await chooserPromise
  if (fileChooser) {
    await fileChooser.setFiles(path)
    return true
  }

  await control.sleep(300)
  const revealedInput = await chooseFileInput(page, image)
  if (!revealedInput) return false
  await revealedInput.setInputFiles(path)
  return true
}

async function optionalSendButton(page: Page): Promise<Locator | null> {
  return firstVisible([
    page.getByRole('button', { name: /^Gửi$/i }),
    page.locator('button[aria-label*="Gửi" i]')
  ])
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
    if (!attached) {
      return zaloActionResult(accountId, input.type, target.targetPhone, 'failed', 'attachment_control_missing', 'Không xác định được control upload ảnh/file trong conversation đã verify.', {
        verifiedTarget: true,
        targetDisplayName: target.displayName,
        data: { sentCount, total: input.paths.length }
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
