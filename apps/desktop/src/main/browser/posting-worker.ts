import type { PostingWorkerRequestMessage } from '../../shared/posting'
import { executePostingJob } from './posting/postingEngine'

const parentPort = process.parentPort
if (!parentPort) {
  throw new Error('Posting worker phải chạy dưới Electron utilityProcess.')
}

parentPort.once('message', (event) => {
  const message = event.data as PostingWorkerRequestMessage
  if (message.type !== 'execute') {
    parentPort.postMessage({
      type: 'result',
      result: { status: 'failed', code: 'unexpected_error', message: 'Posting worker nhận message không hợp lệ.' }
    })
    return
  }

  void executePostingJob(message.job)
    .then((result) => parentPort.postMessage({ type: 'result', result }))
    .catch((error) => parentPort.postMessage({
      type: 'result',
      result: {
        status: 'failed',
        code: 'unexpected_error',
        message: error instanceof Error ? error.message : String(error)
      }
    }))
    .finally(() => setTimeout(() => process.exit(0), 25))
})

parentPort.postMessage({ type: 'ready' })
