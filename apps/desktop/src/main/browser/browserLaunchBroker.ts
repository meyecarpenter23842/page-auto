import { utilityProcess, type UtilityProcess } from 'electron'
import { DEFAULT_APP_SETTINGS, type RuntimeSettings } from '../../shared/appSettings'
import {
  browserLaunchPermitPayload,
  isBrowserLaunchPermitRequest,
  type BrowserLaunchPermitResultMessage
} from '../../shared/browserLaunchPermit'
import { globalBrowserLaunchGate } from './runtimeLaunchGate'

let runtimeSettingsProvider: () => RuntimeSettings = () => ({ ...DEFAULT_APP_SETTINGS.runtime })
let installed = false

function sendPermitResult(worker: UtilityProcess, result: BrowserLaunchPermitResultMessage): void {
  try {
    worker.postMessage(result)
  } catch {
    // Worker lifecycle owns cleanup if it exits while queued for a launch permit.
  }
}

function attachLaunchPermitListener(worker: UtilityProcess): void {
  worker.on('message', (raw: unknown) => {
    const payload = browserLaunchPermitPayload(raw)
    if (!isBrowserLaunchPermitRequest(payload)) return

    let spacingMs: number
    try {
      spacingMs = runtimeSettingsProvider().browserLaunchSpacingMs
    } catch (error) {
      sendPermitResult(worker, {
        type: 'browser_launch_permit_result',
        requestId: payload.requestId,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
      return
    }

    void globalBrowserLaunchGate.wait(spacingMs).then(() => {
      sendPermitResult(worker, {
        type: 'browser_launch_permit_result',
        requestId: payload.requestId,
        status: 'granted'
      })
    }).catch((error) => {
      sendPermitResult(worker, {
        type: 'browser_launch_permit_result',
        requestId: payload.requestId,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
    })
  })
}

function installGlobalBrowserLaunchBroker(): void {
  if (installed) return
  installed = true

  const originalFork = utilityProcess.fork.bind(utilityProcess)
  const wrappedFork = ((...args: Parameters<typeof utilityProcess.fork>) => {
    const worker = originalFork(...args)
    attachLaunchPermitListener(worker)
    return worker
  }) as typeof utilityProcess.fork

  Object.defineProperty(utilityProcess, 'fork', {
    configurable: true,
    value: wrappedFork
  })
}

/**
 * Configure the app-wide runtime setting source and install the Main-process permit broker.
 * Calling this from multiple Main services is safe; all workers still share one gate instance.
 */
export function configureGlobalBrowserLaunchBroker(getRuntimeSettings: () => RuntimeSettings): void {
  runtimeSettingsProvider = getRuntimeSettings
  installGlobalBrowserLaunchBroker()
}
