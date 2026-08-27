import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import type { EmailCodeWorkerResponseMessage } from '../../shared/emailCode'
import type { FacebookPostWorkerRequestMessage } from '../../shared/facebookTasks'
import { createEmailCodeWorkerRpc } from '../email/emailCodeWorkerRpc'
import { clearEmailCodeProvider, setEmailCodeProvider } from '../services/emailCodeProviderRegistry'
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
const emailCodeRpc = createEmailCodeWorkerRpc((message) => parentPort.postMessage(message))
setEmailCodeProvider(emailCodeRpc.provider)
const postTaskDispatcher = import('../facebook/facebookPostTaskDispatcher')
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
  if (emailCodeRpc.handleMessage(event.data)) return
  const payload = event.data as FacebookPostWorkerRequestMessage | RetileRequest | EmailCodeWorkerResponseMessage | { type?: string }
  if (payload?.type === 'shutdown') {
    if (shuttingDown) return
    shuttingDown = true
    queue = queue.finally(async () => {
      let exitCode = 0
      try {
        await closeManagedPostingBrowser()
        console.info('[PAGE-AUTO browser-close] posting worker confirmed browser shutdown')
      } catch (error) {
        exitCode = 1
        console.error(
          '[PAGE-AUTO browser-close] posting worker failed to close browser:',
          error instanceof Error ? error.message : String(error)
        )
      } finally {
        clearEmailCodeProvider(emailCodeRpc.provider)
        emailCodeRpc.dispose()
      }
      setTimeout(() => process.exit(exitCode), 25)
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

  const message = payload as FacebookPostWorkerRequestMessage
  queue = queue.then(async () => {
    setManagedBrowserPlacement(message.job.browserPlacement ?? null)
    const result = await postTaskDispatcher
      .then(({ executeFacebookPostTaskJob }) => executeFacebookPostTaskJob(message.job))
      .catch((error) => ({
        status: 'failed' as const,
        code: 'unexpected_error' as const,
        message: error instanceof Error ? error.message : String(error)
      }))
    parentPort.postMessage({ type: 'result', result })
  })
})

parentPort.postMessage({ type: 'ready' })
