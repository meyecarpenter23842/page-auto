import type { Locator, Page } from 'playwright-core'
import { zaloActionResult, type ZaloActionInput, type ZaloActionResult } from '../../../shared/zalo'
import type { ZaloActionControl } from './zaloActionControl'
import { resolveZaloTarget } from './zaloTargetResolver'

type AddFriendInput = Extract<ZaloActionInput, { type: 'add_friend' }>

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const candidate = locator.first()
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  return null
}

async function friendshipEvidence(page: Page): Promise<'friend' | 'pending' | null> {
  const friend = await firstVisible([
    page.getByText(/Hủy kết bạn/i),
    page.getByText(/^Bạn bè$/i)
  ])
  if (friend) return 'friend'
  const pending = await firstVisible([
    page.getByText(/Đã gửi lời mời/i),
    page.getByText(/Hủy lời mời/i),
    page.getByText(/Thu hồi lời mời/i),
    page.getByText(/Chờ đồng ý/i)
  ])
  return pending ? 'pending' : null
}

export async function addZaloFriend(
  accountId: number,
  page: Page,
  input: AddFriendInput,
  control: ZaloActionControl
): Promise<ZaloActionResult> {
  const target = await resolveZaloTarget(page, input.targetPhone, control, { requireConversation: false })
  if (!target.ok) {
    return zaloActionResult(accountId, input.type, input.targetPhone, 'failed', target.code, target.message)
  }

  const existing = await friendshipEvidence(page)
  if (existing === 'friend') {
    return zaloActionResult(accountId, input.type, target.targetPhone, 'success', 'already_friend', 'Target Zalo đã là bạn bè; không gửi thêm lời mời.', {
      verifiedTarget: true,
      targetDisplayName: target.displayName
    })
  }
  if (existing === 'pending') {
    return zaloActionResult(accountId, input.type, target.targetPhone, 'success', 'success', 'Lời mời kết bạn Zalo đã ở trạng thái chờ; không gửi trùng.', {
      verifiedTarget: true,
      targetDisplayName: target.displayName,
      data: { alreadyPending: true }
    })
  }

  const addFriend = await firstVisible([
    page.getByRole('button', { name: /^Kết bạn$/i }),
    page.getByText(/^Kết bạn$/i),
    page.locator('[aria-label*="Kết bạn" i]')
  ])
  if (!addFriend) {
    return zaloActionResult(accountId, input.type, target.targetPhone, 'failed', 'friend_control_missing', 'Không xác định được nút Kết bạn trong target đã verify.', {
      verifiedTarget: true,
      targetDisplayName: target.displayName
    })
  }

  await control.checkpoint()
  await addFriend.click({ timeout: 5_000 })
  await control.sleep(300)

  const dialog = await firstVisible([
    page.getByRole('dialog'),
    page.locator('[role="dialog"]')
  ])
  if (dialog) {
    if (input.message) {
      const messageInput = await firstVisible([
        dialog.locator('textarea[placeholder*="lời nhắn" i]'),
        dialog.locator('textarea[placeholder*="tin nhắn" i]'),
        dialog.locator('input[placeholder*="lời nhắn" i]'),
        dialog.locator('[contenteditable="true"][data-placeholder*="lời nhắn" i]')
      ])
      if (messageInput) await messageInput.fill(input.message)
    }

    const confirm = await firstVisible([
      dialog.getByRole('button', { name: /Gửi lời mời/i }),
      dialog.getByRole('button', { name: /^Kết bạn$/i }),
      dialog.getByRole('button', { name: /^Gửi$/i })
    ])
    if (confirm && await confirm.isEnabled().catch(() => false)) {
      await control.checkpoint()
      await confirm.click({ timeout: 5_000 })
    }
  }

  for (let attempt = 0; attempt < 32; attempt += 1) {
    await control.sleep(250)
    const evidence = await friendshipEvidence(page)
    if (evidence === 'friend' || evidence === 'pending') {
      return zaloActionResult(accountId, input.type, target.targetPhone, 'success', 'success', evidence === 'friend'
        ? 'Zalo xác minh target đã ở trạng thái bạn bè.'
        : 'Zalo xác minh lời mời kết bạn đã được gửi/chờ phản hồi.', {
        verifiedTarget: true,
        targetDisplayName: target.displayName
      })
    }
  }

  return zaloActionResult(accountId, input.type, target.targetPhone, 'failed', 'verification_uncertain', 'Đã thao tác Kết bạn nhưng không đủ bằng chứng hậu thao tác; không báo success giả.', {
    verifiedTarget: true,
    targetDisplayName: target.displayName
  })
}
