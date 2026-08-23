import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type {
  PostingJobRequest,
  PostingJobResult,
  PostingWorkerMessage,
  PostingWorkerRequestMessage
} from '../../shared/posting'

const WORKER_TIMEOUT_MS = 180_000

export class PostingWorkerManager {
  private readonly workers = new Set<UtilityProcess>()

  run(job: PostingJobRequest): Promise<PostingJobResult> {
    return new Promise((resolve) => {
      const worker = utilityProcess.fork(join(__dirname, 'posting-worker.js'), [], {
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
        finish({ status: 'failed', code: 'worker_timeout', message: 'Posting worker vượt quá thời gian cho phép.' })
      }, WORKER_TIMEOUT_MS)

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
          finish({ status: 'failed', code: 'worker_crashed', message: `Posting worker thoát với code ${code}.` })
        }
      })
    })
  }

  closeAll(): void {
    for (const worker of this.workers) worker.kill()
    this.workers.clear()
  }
}
