import type { Page } from 'playwright-core'
import type { PageWallPostTaskJobRequest } from '../../../shared/facebookTasks'
import type { PostingJobResult } from '../../../shared/posting'
import { finishPostingEvidence, startPostingTrace } from '../../browser/posting/postingEvidence'
import {
  FacebookCommonRuntime,
  type FacebookCommonStepResult
} from '../../facebook/facebookCommonRuntime'
import { PageWallTask, type PreparedPageWallRuntime } from './pageWallTask'

function wallDiagnostic(job: PageWallPostTaskJobRequest, message: string): void {
  console.info(`[PAGE-AUTO page-wall] run=${job.runId} item=${job.itemId} account=${job.accountId} ${message}`)
}

function commonResult(result: FacebookCommonStepResult): PostingJobResult {
  return {
    status: result.status,
    ...(result.code ? { code: result.code } : {}),
    message: result.message,
    ...(result.sessionValidation ? { sessionValidation: result.sessionValidation } : {})
  }
}

function unexpected(error: unknown): PostingJobResult {
  return {
    status: 'failed',
    code: 'unexpected_error',
    message: error instanceof Error ? error.message : String(error)
  }
}

export async function executePageWallPostJob(job: PageWallPostTaskJobRequest): Promise<PostingJobResult> {
  let runtime: FacebookCommonRuntime | null = null
  let page: Page | null = null
  let traceStarted = false
  let pendingFinish: Promise<PostingJobResult> | null = null

  const finish = async (result: PostingJobResult): Promise<PostingJobResult> => {
    let enriched = result
    const metadata = runtime?.metadata()
    if (metadata?.sessionValidated && !enriched.sessionValidation) {
      enriched = {
        ...enriched,
        sessionValidation: {
          phase: 'before_run',
          state: 'valid',
          message: 'Session Facebook đã được xác minh/phục hồi trước khi thực thi Đăng Tường.'
        }
      }
    }
    if (metadata?.accountName && !enriched.accountName) enriched = { ...enriched, accountName: metadata.accountName }
    if (metadata?.sessionCookie && !enriched.sessionCookie) enriched = { ...enriched, sessionCookie: metadata.sessionCookie }

    const completion = page
      ? finishPostingEvidence(page, job, enriched, traceStarted)
      : Promise.resolve(enriched)
    pendingFinish = completion
    return completion
  }

  try {
    const opened = await FacebookCommonRuntime.open({
      profileDirectory: job.profileDirectory,
      pageUid: job.pageUid,
      browser: job.browser,
      session: job.session,
      network: job.network,
      sessionAccount: job.sessionAccount,
      ...(job.userAgent ? { userAgent: job.userAgent } : {}),
      ...(job.proxy ? { proxy: job.proxy } : {}),
      diagnostic: (message) => wallDiagnostic(job, message)
    })
    if (opened.status !== 'ready') return commonResult(opened.result)

    runtime = opened.runtime
    page = runtime.page
    traceStarted = await startPostingTrace(runtime.context, job)
    wallDiagnostic(
      job,
      `task=page_wall_post timing networkTimeoutMs=${job.network.networkTimeoutMs} navigationTimeoutMs=${runtime.browser.navigationTimeoutMs} pageSettleDelayMs=${runtime.browser.pageSettleDelayMs}`
    )

    const prepared = await runtime.prepareForPage()
    if (prepared.status !== 'success') return finish(commonResult(prepared))
    wallDiagnostic(job, 'state=common_runtime ready account/page identity verified')

    const preparedWallRuntime: PreparedPageWallRuntime = {
      page: runtime.page,
      browser: runtime.browser,
      pace: (boundary) => runtime!.pace(boundary),
      checkAccessBlock: (messageContext) => runtime!.checkAccessBlock(messageContext)
    }

    const taskResult = await new PageWallTask(preparedWallRuntime, job.task).execute({
      content: job.content,
      imagePaths: job.imagePaths,
      networkTimeoutMs: job.network.networkTimeoutMs
    })
    if (taskResult.status !== 'success' || !job.session.validateAfterRun) return finish(taskResult)

    const after = await runtime.validateAfterTask()
    return finish({
      ...taskResult,
      ...(after.messageSuffix ? { message: `${taskResult.message} ${after.messageSuffix}` } : {}),
      sessionValidation: after.sessionValidation
    })
  } catch (error) {
    return finish(unexpected(error))
  } finally {
    await Promise.resolve(pendingFinish).catch(() => undefined)
    await runtime?.close()
  }
}
