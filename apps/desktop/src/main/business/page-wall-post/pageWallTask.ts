import type { Page } from 'playwright-core'
import type { BrowserSettings } from '../../../shared/appSettings'
import type { PageWallPostTaskDescriptor } from '../../../shared/facebookTasks'
import type { FacebookCommonStepResult } from '../../facebook/facebookCommonRuntime'

export interface PreparedPageWallRuntime {
  page: Page
  browser: Pick<BrowserSettings, 'navigationTimeoutMs' | 'pageSettleDelayMs'>
  pace(boundary: string): Promise<void>
  checkAccessBlock(messageContext?: string): Promise<FacebookCommonStepResult>
}

export function pageWallUrl(pageUid: string): string {
  return `https://www.facebook.com/profile.php?id=${encodeURIComponent(pageUid.trim())}`
}

export class PageWallTask {
  constructor(
    private readonly runtime: PreparedPageWallRuntime,
    private readonly task: PageWallPostTaskDescriptor
  ) {}

  async prepare(): Promise<FacebookCommonStepResult> {
    const pageUid = this.task.target.pageUid.trim()
    if (!pageUid) {
      return {
        status: 'failed',
        code: 'page_navigation_failed',
        message: 'page_wall_post không có Page UID hợp lệ.'
      }
    }

    await this.runtime.pace('page-to-wall')
    try {
      await this.runtime.page.goto(pageWallUrl(pageUid), {
        waitUntil: 'domcontentloaded',
        timeout: this.runtime.browser.navigationTimeoutMs
      })
      if (this.runtime.browser.pageSettleDelayMs > 0) {
        await this.runtime.page.waitForTimeout(this.runtime.browser.pageSettleDelayMs)
      }
    } catch (error) {
      return {
        status: 'failed',
        code: 'page_navigation_failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }

    const access = await this.runtime.checkAccessBlock('sau khi mở Tường Page')
    if (access.status !== 'success') return access
    return {
      status: 'success',
      message: 'Đã mở Tường Page bằng prepared Facebook runtime; chưa thực hiện publish ở Batch 5A.'
    }
  }
}
