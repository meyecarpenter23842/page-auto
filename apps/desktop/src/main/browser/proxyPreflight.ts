import type { Page } from 'playwright-core'
import type { NetworkSettings } from '../../shared/appSettings'

export interface ProxyPreflightResult {
  status: 'skipped' | 'success' | 'failed'
  attempts: number
  message: string
}

export type ProxyProbeAttempt = (timeoutMs: number) => Promise<void>
export type ProxyProbeWait = (milliseconds: number) => Promise<void>

export function effectiveNavigationTimeoutMs(browserTimeoutMs: number, networkTimeoutMs: number): number {
  return Math.max(1_000, Math.min(browserTimeoutMs, networkTimeoutMs))
}

export async function runProxyPreflight(
  settings: NetworkSettings,
  probe: ProxyProbeAttempt,
  wait: ProxyProbeWait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<ProxyPreflightResult> {
  if (!settings.checkProxyBeforeRun) {
    return { status: 'skipped', attempts: 0, message: 'Đã bỏ qua kiểm tra proxy trước khi chạy.' }
  }

  const maxAttempts = settings.proxyRetryCount + 1
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await probe(settings.proxyConnectionTimeoutMs)
      return {
        status: 'success',
        attempts: attempt,
        message: attempt === 1
          ? 'Proxy phản hồi bình thường.'
          : `Proxy phản hồi sau ${attempt} lần thử.`
      }
    } catch {
      if (attempt < maxAttempts) await wait(250)
    }
  }

  return {
    status: 'failed',
    attempts: maxAttempts,
    message: `Proxy không kết nối được sau ${maxAttempts} lần kiểm tra.`
  }
}

export async function probeFacebookThroughProxy(
  page: Page,
  settings: NetworkSettings
): Promise<ProxyPreflightResult> {
  return runProxyPreflight(
    settings,
    async (timeoutMs) => {
      await page.goto('https://www.facebook.com/robots.txt', {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      })
    },
    (milliseconds) => page.waitForTimeout(milliseconds)
  )
}
