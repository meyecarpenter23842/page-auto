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
import {
  shouldAutoReleasePostingBrowserForOneShot,
  shouldRetainPostingBrowserForManualSession
} from './postingWorkerLifecycle'

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

async function closeWorkerBrowser(reason: string): Promise<number> {
  try {
    await closeManagedPostingBrowser()
    console.info(`[PAGE-AUTO browser-close] ${reason} → posting worker confirmed browser shutdown`)
    return 0
  } catch (error) {
    console.error(
      `[PAGE-AUTO browser-close] ${reason} → posting worker failed to close browser:`,
      error instanceof Error ? error.message : String(error)
    )
    return 1
  }
}

function disposeWorkerSupport(): void {
  clearEmailCodeProvider(emailCodeRpc.provider)
  emailCodeRpc.dispose()
}

function exitSoon(exitCode: number): void {
  disposeWorkerSupport()
  setTimeout(() => process.exit(exitCode), 25)
}

parentPort.on('message', (event) => {
  if (emailCodeRpc.handleMessage(event.data)) return
  const payload = event.data as FacebookPostWorkerRequestMessage | RetileRequest | EmailCodeWorkerResponseMessage | { type?: string }
  if (payload?.type === 'shutdown') {
    if (shuttingDown) return
    shuttingDown = true
    queue = queue.finally(async () => {
      const exitCode = await closeWorkerBrowser('shutdown requested by Main')
      exitSoon(exitCode)
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

    const autoRelease = shouldAutoReleasePostingBrowserForOneShot(message.job)
      && !shouldRetainPostingBrowserForManualSession(result)
    if (autoRelease) {
      shuttingDown = true
      const exitCode = await closeWorkerBrowser('one-shot Page Wall complete')
      parentPort.postMessage({ type: 'result', result })
      exitSoon(exitCode)
      return
    }

    parentPort.postMessage({ type: 'result', result })
  })
})

parentPort.postMessage({ type: 'ready' })
