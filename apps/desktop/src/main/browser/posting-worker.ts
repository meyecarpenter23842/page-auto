import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import type { PostingWorkerRequestMessage } from '../../shared/posting'
import {
  closeManagedPostingBrowser,
  installManagedBrowserReuse,
  retileManagedPostingBrowser,
  setManagedBrowserPlacement
} from './managedBrowserBridge'

const parentPort = process.parentPort
if (!parentPort) {
  throw new Error('Posting worker phải chạy dưới Electron utilityProcess.')
}

installManagedBrowserReuse()
const postingEngine = import('./posting/postingEngine')
let queue = Promise.resolve()
let shuttingDown = false

interface RetileRequest {
  type: 'retile'
  placement: BrowserWindowPlacement | null
}

function isRetileRequest(payload: unknown): payload is RetileRequest {
  return Boolean(payload && typeof payload === 'object' && (payload as { type?: unknown }).type === 'retile')
}

parentPort.on('message', (event) => {
  const payload = event.data as PostingWorkerRequestMessage | RetileRequest | { type?: string }
  if (payload?.type === 'shutdown') {
    if (shuttingDown) return
    shuttingDown = true
    queue = queue.finally(async () => {
      await closeManagedPostingBrowser()
      setTimeout(() => process.exit(0), 25)
    })
    return
  }

  if (isRetileRequest(payload) && !shuttingDown) {
    queue = queue.then(() => retileManagedPostingBrowser(payload.placement))
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
    setManagedBrowserPlacement(message.job.browserPlacement ?? null)
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
