import type { Locator, Page } from 'playwright-core'
import { zaloActionResult, type ZaloActionInput, type ZaloActionResult } from '../../../shared/zalo'
import type { ZaloActionControl } from './zaloActionControl'
import { resolveZaloTarget } from './zaloTargetResolver'

type SendMessageInput = Extract<ZaloActionInput, { type: 'send_message' }>

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const candidate = locator.first()
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function composerText(composer: Locator): Promise<string> {
  return composer.evaluate((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value
    return element.textContent ?? ''
  }).catch(() => '')
}

async function sendControl(page: Page): Promise<Locator | null> {
  const direct = await firstVisible([
    page.locator('#chatInput [data-translate-title="STR_SEND_MESSAGE"]'),
    page.locator('#chatInput [data-translate-title="STR_SEND"]'),
    page.locator('#chatInput [title="Gửi"]'),
    page.locator('#chatInput [icon*="Send" i]'),
    page.locator('#chatInput i[class*="Send"][class*="24"]'),
    page.getByRole('button', { name: /^Gửi$/i }),
    page.locator('button[aria-label*="Gửi" i]'),
    page.locator('[role="button"][aria-label*="Gửi" i]')
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

async function activateZaloComposer(
  page: Page,
  composer: Locator,
  control: ZaloActionControl
): Promise<void> {
  // The live Zalo DOM can expose #richInput as contenteditable="false" until the
  // chat input receives a real focus transition. Activate the container first,
  // then leave the final focus/click on #richInput; clicking the container last
  // can immediately blur/deactivate the editor again.
  await page.locator('#chat-input-container-id').click({ timeout: 2_000 }).catch(() => undefined)
  await control.sleep(80)
  await composer.click({ timeout: 5_000 }).catch(() => undefined)
  await composer.focus().catch(() => undefined)
}

async function typeIntoZaloComposer(
  page: Page,
  composer: Locator,
  content: string,
  control: ZaloActionControl
): Promise<boolean> {
  await activateZaloComposer(page, composer, control)

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (attempt > 0 && attempt % 10 === 0) {
      await activateZaloComposer(page, composer, control)
    }

    const editable = await composer.isEditable().catch(() => false)
    const contentEditable = await composer.getAttribute('contenteditable').catch(() => null)
    if (editable || contentEditable === 'true') {
      const filled = await composer.fill(content).then(() => true).catch(() => false)
      if (filled) {
        await control.sleep(80)
        if ((await composerText(composer)).trim().length > 0) return true
      }
    }
    await control.sleep(100)
  }

  await activateZaloComposer(page, composer, control)
  await page.keyboard.insertText(content)
  await control.sleep(150)
  return (await composerText(composer)).trim().length > 0
}

export async function sendZaloMessage(
  accountId: number,
  page: Page,
  input: SendMessageInput,
  control: ZaloActionControl
): Promise<ZaloActionResult> {
  const target = await resolveZaloTarget(page, input.targetPhone, control, { requireConversation: true })
  if (!target.ok) {
    return zaloActionResult(accountId, input.type, input.targetPhone, 'failed', target.code, target.message)
  }
  const composer = target.composer
  if (!composer) {
    return zaloActionResult(accountId, input.type, target.targetPhone, 'failed', 'composer_missing', 'Không tìm thấy composer sau khi đã verify target.', {
      verifiedTarget: true,
      targetDisplayName: target.displayName
    })
  }

  const baseline = await page.getByText(input.content, { exact: true }).count().catch(() => 0)
  await control.checkpoint()
  const typed = await typeIntoZaloComposer(page, composer, input.content, control)
  if (!typed) {
    return zaloActionResult(accountId, input.type, target.targetPhone, 'failed', 'composer_missing', 'Đã mở đúng conversation nhưng #richInput chưa chuyển sang trạng thái nhập được.', {
      verifiedTarget: true,
      targetDisplayName: target.displayName
    })
  }

  const send = await sendControl(page)
  if (!send) {
    return zaloActionResult(accountId, input.type, target.targetPhone, 'failed', 'send_control_missing', 'Không xác định được nút Gửi trong conversation đã verify; không gửi bằng phím tắt.', {
      verifiedTarget: true,
      targetDisplayName: target.displayName
    })
  }

  await control.checkpoint()
  await send.click({ timeout: 5_000 })

  for (let attempt = 0; attempt < 32; attempt += 1) {
    await control.sleep(250)
    const current = await page.getByText(input.content, { exact: true }).count().catch(() => baseline)
    const cleared = (await composerText(composer)).trim().length === 0
    if (current > baseline && cleared) {
      return zaloActionResult(accountId, input.type, target.targetPhone, 'success', 'success', 'Tin nhắn Zalo đã xuất hiện trong conversation đã verify.', {
        verifiedTarget: true,
        targetDisplayName: target.displayName
      })
    }
  }

  return zaloActionResult(accountId, input.type, target.targetPhone, 'failed', 'verification_uncertain', 'Đã bấm Gửi nhưng không đủ bằng chứng xác minh tin nhắn mới trong conversation.', {
    verifiedTarget: true,
    targetDisplayName: target.displayName
  })
}
