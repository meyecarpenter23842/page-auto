import type { Page } from 'playwright-core'
import { zaloActionResult, type ZaloActionInput, type ZaloActionResult } from '../../../shared/zalo'
import { addZaloFriend } from './addFriend'
import { sendZaloAttachment } from './sendAttachment'
import { sendZaloMessage } from './sendMessage'
import { ZaloActionControl, ZaloActionStoppedError } from './zaloActionControl'

export async function runZaloAction(
  accountId: number,
  page: Page,
  input: ZaloActionInput,
  control: ZaloActionControl
): Promise<ZaloActionResult> {
  try {
    await control.checkpoint()
    if (input.type === 'send_message') return await sendZaloMessage(accountId, page, input, control)
    if (input.type === 'send_attachment') return await sendZaloAttachment(accountId, page, input, control)
    return await addZaloFriend(accountId, page, input, control)
  } catch (error) {
    if (error instanceof ZaloActionStoppedError || control.isStopped()) {
      return zaloActionResult(accountId, input.type, input.targetPhone, 'stopped', 'stopped', 'Zalo action đã dừng theo yêu cầu operator.')
    }
    return zaloActionResult(
      accountId,
      input.type,
      input.targetPhone,
      'failed',
      'executor_exception',
      error instanceof Error ? error.message : String(error)
    )
  }
}
