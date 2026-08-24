import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { DEFAULT_APP_SETTINGS, type RuntimeSettings } from '../../shared/appSettings'
import type {
  PostingJobRequest,
  PostingJobResult,
  PostingWorkerMessage,
  PostingWorkerRequestMessage
} from '../../shared/posting'
import { getManagedBrowserEndpoint } from './managedBrowserRegistry'
import { BrowserLaunchGate } from './runtimeLaunchGate'

const MANAGED_CDP_ARG_PREFIX = '--page-auto-managed-cdp='

export class PostingWorkerManager {
  private readonly workers = new Set<UtilityProcess>()
  private readonly launchGate = new BrowserLaunchGate()

  constructor(
    private readonly getRuntimeSettings: () => RuntimeSettings = () => ({ ...DEFAULT_APP_SETTINGS.runtime })
  ) {}

  async run(job: PostingJobRequest): Promise<PostingJobResult> {
    const runtime = { ...this.getRuntimeSettings() }
    await this.launchGate.wait(runtime.browserLaunchSpacingMs)

    return new Promise((resolve) => {
      const managedEndpoint = getManagedBrowserEndpoint(job.accountId)
      const workerArgs = managedEndpoint ? [`${MANAGED_CDP_ARG_PREFIX}${managedEndpoint}`] : []
      const worker = utilityProcess.fork(join(__dirname, 'posting-worker.js'), workerArgs, {
        serviceName: `PAGE-AUTO posting run ${job.runId} item ${job.itemId}`
      })
      this.workers.add(worker)

      let settled = false
      let started = false
      const finish = (result: PostingJobResult) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.workers.delete(worker)
        worker.kill()
        resolve(result)
      }

      const timeout = setTimeout(() => {
        finish({
          status: 'failed',
          code: 'worker_timeout',
          message: `Posting worker vượt giới hạn runtime ${runtime.maxAccountRuntimeSeconds}s; cần review trước khi retry để tránh đăng trùng.`
        })
      }, runtime.maxAccountRuntimeSeconds * 1000)

      worker.on('message', (raw: unknown) => {
        const message = raw as PostingWorkerMessage
        if (message.type === 'ready' && !started) {
          started = true
          const request: PostingWorkerRequestMessage = { type: 'execute', job }
          worker.postMessage(request)
          return
        }
        if (message.type === 'result') {
          finish(message.result)
        }
      })

      worker.once('exit', (code) => {
        if (!settled) {
          finish({
            status: 'failed',
            code: 'worker_crashed',
            message: `Posting worker thoát với code ${code}; trạng thái publish có thể chưa xác định, cần review trước khi retry.`
          })
        }
      })
    })
  }

  closeAll(): void {
    for (const worker of this.workers) worker.kill()
    this.workers.clear()
  }
}
