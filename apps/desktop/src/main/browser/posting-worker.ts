import type { PostingWorkerRequestMessage } from '../../shared/posting'
import { closeManagedPostingBrowser, installManagedBrowserReuse } from './managedBrowserBridge'

const parentPort = process.parentPort
if (!parentPort) {
  throw new Error('Posting worker phải chạy dưới Electron utilityProcess.')
}

installManagedBrowserReuse()
const postingEngine = import('./posting/postingEngine')
let queue = Promise.resolve()
let shuttingDown = false

parentPort.on('message', (event) => {
  const payload = event.data as PostingWorkerRequestMessage | { type?: string }
  if (payload?.type === 'shutdown') {
    if (shuttingDown) return
    shuttingDown = true
    queue = queue.finally(async () => {
      await closeManagedPostingBrowser()
      setTimeout(() => process.exit(0), 25)
    })
    return
  }

  if (payload?.type !== 'execute' || shuttingDown) {
    parentPort.postMessage({
      type: 'result',
      result: { status: 'failed', code: 'unexpected_error', message: 'Posting worker nhận message không hợp lệ.' }
    })
    return
  }

  const message = payload as PostingWorkerRequestMessage
  queue = queue.then(async () => {
    const result = await postingEngine
      .then(({ executePostingJob }) => executePostingJob(message.job))
      .catch((error) => ({
        status: 'failed' as const,
        code: 'unexpected_error' as const,
        message: error instanceof Error ? error.message : String(error)
      }))
    parentPort.postMessage({ type: 'result', result })
  })
})

parentPort.postMessage({ type: 'ready' })
