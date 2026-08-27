import { mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import type { PostingJobRequest, PostingJobResult } from '../../../shared/posting'
import { detectFacebookCheckpointKind } from './facebookCheckpoint'
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

async function enrichSessionClassification(page: Page, result: PostingJobResult): Promise<PostingJobResult> {
  const validation = result.sessionValidation
  const verificationRequired = result.code === 'verification_required' || validation?.state === 'verification_required'
  if (verificationRequired) {
    const checkpointKind = validation?.checkpointKind
      ?? await detectFacebookCheckpointKind(page).catch(() => 'unknown' as const)
      ?? 'unknown'
    const message = validation?.state === 'verification_required'
      ? validation.message
      : result.message

    return {
      ...result,
      sessionValidation: {
        phase: validation?.phase ?? 'before_run',
        state: 'verification_required',
        message,
        checkpointKind
      }
    }
  }

  const needsLogin = result.code === 'needs_login'
    || result.status === 'needs_login'
    || validation?.state === 'needs_login'
  if (!needsLogin || validation?.state === 'needs_login') return result

  return {
    ...result,
    sessionValidation: {
      phase: validation?.phase ?? 'before_run',
      state: 'needs_login',
      message: result.message
    }
  }
}

export async function finishPostingEvidence(
  page: Page,
  job: PostingJobRequest,
  result: PostingJobResult,
  traceStarted: boolean
): Promise<PostingJobResult> {
  let next = await enrichSessionClassification(page, result)
  const isFailure = next.status !== 'success' && next.status !== 'skipped'

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
