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
const launchAwareTimers = new WeakMap<UtilityProcess, NodeJS.Timeout>()
const TIMER_REFRESH_INTERVAL_MS = 1_000

function sendPermitResult(worker: UtilityProcess, result: BrowserLaunchPermitResultMessage): void {
  try {
    worker.postMessage(result)
  } catch {
    // Worker lifecycle owns cleanup if it exits while queued for a launch permit.
  }
}

function refreshLaunchAwareTimer(worker: UtilityProcess): void {
  launchAwareTimers.get(worker)?.refresh()
}

async function waitForLaunchPermit(worker: UtilityProcess, spacingMs: number): Promise<void> {
  // Operation/runtime budgets describe the work after Chrome is allowed to launch.
  // Keep the currently active worker timer alive while this worker is queued behind
  // other app-wide Chrome launches, then give it a fresh budget when permit is granted.
  refreshLaunchAwareTimer(worker)
  const timerRefresh = setInterval(() => refreshLaunchAwareTimer(worker), TIMER_REFRESH_INTERVAL_MS)
  timerRefresh.unref?.()
  try {
    await globalBrowserLaunchGate.wait(spacingMs)
  } finally {
    clearInterval(timerRefresh)
    refreshLaunchAwareTimer(worker)
  }
}

function attachLaunchPermitListener(worker: UtilityProcess): void {
  worker.once('exit', () => launchAwareTimers.delete(worker))
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

    void waitForLaunchPermit(worker, spacingMs).then(() => {
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

  // Vitest's Electron shim intentionally omits utilityProcess. Runtime services may
  // still be constructed there, so installing the Main-process interceptor must be a
  // safe no-op outside a real Electron Main process.
  if (!utilityProcess || typeof utilityProcess.fork !== 'function') return
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
 * Create the normal operation timeout for one utility worker while allowing the
 * global launch broker to keep that exact timer alive during permit queueing.
 */
export function setBrowserLaunchAwareTimeout(
  worker: UtilityProcess,
  callback: () => void,
  timeoutMs: number
): NodeJS.Timeout {
  const timer = setTimeout(callback, timeoutMs)
  launchAwareTimers.set(worker, timer)
  return timer
}

/**
 * Configure the app-wide runtime setting source and install the Main-process permit broker.
 * Calling this from multiple Main services is safe; all workers still share one gate instance.
 */
export function configureGlobalBrowserLaunchBroker(getRuntimeSettings: () => RuntimeSettings): void {
  runtimeSettingsProvider = getRuntimeSettings
  installGlobalBrowserLaunchBroker()
}
