import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Page } from 'playwright-core'
import type { PostingJobRequest } from '../../../shared/posting'

export async function capturePostingFailureScreenshot(
  page: Page,
  job: PostingJobRequest
): Promise<string | null> {
  const dataDirectory = dirname(dirname(job.profileDirectory))
  const screenshotDirectory = join(dataDirectory, 'screenshots')
  const screenshotPath = join(
    screenshotDirectory,
    `run-${job.runId}-item-${job.itemId}-${Date.now()}.png`
  )
  try {
    await mkdir(screenshotDirectory, { recursive: true })
    await page.screenshot({ path: screenshotPath, fullPage: true })
    return screenshotPath
  } catch {
    return null
  }
}
