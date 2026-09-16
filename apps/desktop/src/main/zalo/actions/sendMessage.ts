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
  await composer.fill(input.content)
  const send = await firstVisible([
    page.getByRole('button', { name: /^Gửi$/i }),
    page.locator('button[aria-label*="Gửi" i]'),
    page.locator('[role="button"][aria-label*="Gửi" i]')
  ])
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
