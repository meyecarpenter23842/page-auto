import { mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import type { PostingJobRequest, PostingJobResult } from '../../../shared/posting'
import { capturePostingFailureScreenshot } from './screenshotService'

function dataDirectoryFor(job: PostingJobRequest): string {
  return dirname(dirname(job.profileDirectory))
}

export function safeFailureUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().slice(0, 512)
  } catch {
    return null
  }
}

export async function startPostingTrace(context: BrowserContext, job: PostingJobRequest): Promise<boolean> {
  if (!job.logging.playwrightTrace) return false
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
    return true
  } catch {
    return false
  }
}

export async function finishPostingEvidence(
  page: Page,
  job: PostingJobRequest,
  result: PostingJobResult,
  traceStarted: boolean
): Promise<PostingJobResult> {
  const isFailure = result.status !== 'success' && result.status !== 'skipped'
  let next = result

  if (isFailure && job.logging.saveCurrentUrlOnFailure) {
    const currentUrl = safeFailureUrl(page.url())
    if (currentUrl) next = { ...next, message: `${next.message} URL: ${currentUrl}` }
  }

  if (isFailure && job.logging.screenshotOnFailure) {
    const screenshotPath = await capturePostingFailureScreenshot(page, job)
    if (screenshotPath) next = { ...next, screenshotPath }
  }

  if (traceStarted) {
    if (!isFailure) {
      await page.context().tracing.stop().catch(() => undefined)
      return next
    }

    const traceDirectory = join(dataDirectoryFor(job), 'traces')
    const tracePath = join(traceDirectory, `run-${job.runId}-item-${job.itemId}-${Date.now()}.zip`)
    try {
      await mkdir(traceDirectory, { recursive: true })
      await page.context().tracing.stop({ path: tracePath })
      next = { ...next, message: `${next.message} Trace: ${basename(tracePath)}` }
    } catch {
      await page.context().tracing.stop().catch(() => undefined)
    }
  }

  return next
}
