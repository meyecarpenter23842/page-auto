import { chromium, type Browser } from 'playwright-core'
import type {
  BrowserTestResult,
  BrowserTestWorkerRequestMessage,
  BrowserTestWorkerResultMessage
} from '../../shared/browserSettings'
import { applyBrowserContextSettings, buildBrowserLaunchOptions, waitForBrowserStartupDelay } from './browserRuntime'

const parentPort = process.parentPort
if (!parentPort) throw new Error('Browser test worker phải chạy dưới Electron utilityProcess.')

function failure(message: string): BrowserTestResult {
  return {
    status: 'failed',
    code: 'launch_failed',
    executablePath: null,
    version: null,
    message
  }
}

parentPort.once('message', (event) => {
  const message = event.data as BrowserTestWorkerRequestMessage
  if (message.type !== 'test') {
    const result: BrowserTestWorkerResultMessage = {
      type: 'result',
      result: failure('Browser test worker nhận message không hợp lệ.')
    }
    parentPort.postMessage(result)
    return
  }

  void (async () => {
    let browser: Browser | null = null
    const startedAt = Date.now()
    try {
      await waitForBrowserStartupDelay(message.settings)
      browser = await chromium.launch(buildBrowserLaunchOptions(message.settings))
      const context = await browser.newContext({
        viewport: {
          width: message.settings.windowWidth,
          height: message.settings.windowHeight
        }
      })
      await applyBrowserContextSettings(context, message.settings)
      const page = await context.newPage()
      await page.goto('about:blank', { timeout: message.settings.navigationTimeoutMs })
      if (message.settings.pageSettleDelayMs > 0) {
        await page.waitForTimeout(Math.min(message.settings.pageSettleDelayMs, 2_000))
      }

      const result: BrowserTestWorkerResultMessage = {
        type: 'result',
        result: {
          status: 'success',
          executablePath: message.settings.executablePath,
          version: null,
          message: 'Chrome mở và phản hồi bình thường.',
          launchDurationMs: Date.now() - startedAt
        }
      }
      parentPort.postMessage(result)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      const result: BrowserTestWorkerResultMessage = {
        type: 'result',
        result: {
          status: 'failed',
          code: /timeout|timed out/i.test(text) ? 'timeout' : 'launch_failed',
          executablePath: message.settings.executablePath,
          version: null,
          message: text,
          launchDurationMs: Date.now() - startedAt
        }
      }
      parentPort.postMessage(result)
    } finally {
      if (browser) await browser.close().catch(() => undefined)
      setTimeout(() => process.exit(0), 25)
    }
  })()
})

parentPort.postMessage({ type: 'ready' })
