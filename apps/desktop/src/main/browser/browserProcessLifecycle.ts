import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright-core'

const CDP_CLOSE_WAIT_MS = 2_000
const CDP_CLOSE_POLL_MS = 50

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function devToolsEndpointFromActivePort(raw: string): string | null {
  const [portText] = raw.trim().split(/\r?\n/)
  return portText && /^\d+$/.test(portText) ? `http://127.0.0.1:${portText}` : null
}

async function waitForBrowserDisconnect(browser: Browser): Promise<boolean> {
  const deadline = Date.now() + CDP_CLOSE_WAIT_MS
  while (browser.isConnected() && Date.now() < deadline) await sleep(CDP_CLOSE_POLL_MS)
  return !browser.isConnected()
}

/**
 * Browser.close() on a Playwright connection only disconnects from an existing
 * browser server. For a Chrome attached through connectOverCDP we must send the
 * CDP Browser.close command so the owning Chrome process actually terminates.
 */
export async function closeConnectedChromiumProcess(browser: Browser, label: string): Promise<void> {
  const session = await browser.newBrowserCDPSession()
  let closeError: unknown = null
  try {
    try {
      await session.send('Browser.close')
    } catch (error) {
      closeError = error
    }

    const disconnected = await waitForBrowserDisconnect(browser)
    if (!disconnected) {
      throw closeError instanceof Error
        ? closeError
        : new Error(`${label} không đóng sau lệnh CDP Browser.close.`)
    }
  } finally {
    await session.detach().catch(() => undefined)
    if (browser.isConnected()) await browser.close().catch(() => undefined)
  }
}

export async function closeChromiumAtEndpoint(endpoint: string, label: string): Promise<boolean> {
  const normalized = endpoint.trim()
  if (!normalized) return false

  let browser: Browser
  try {
    browser = await chromium.connectOverCDP(normalized, { timeout: 1_500 })
  } catch {
    return false
  }

  await closeConnectedChromiumProcess(browser, label)
  return true
}

export async function profileDevToolsEndpoint(profileDirectory: string): Promise<string | null> {
  try {
    return devToolsEndpointFromActivePort(await readFile(join(profileDirectory, 'DevToolsActivePort'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Best-effort crash/force-kill cleanup. The preferred endpoint is the managed
 * endpoint captured before worker start; the profile DevToolsActivePort is the
 * fallback for a persistent Chrome launched by the worker itself.
 */
export async function closeOrphanedProfileChrome(
  profileDirectory: string,
  preferredEndpoint?: string | null
): Promise<boolean> {
  const endpoints: string[] = []
  const preferred = preferredEndpoint?.trim()
  if (preferred) endpoints.push(preferred)
  const profileEndpoint = await profileDevToolsEndpoint(profileDirectory)
  if (profileEndpoint && !endpoints.includes(profileEndpoint)) endpoints.push(profileEndpoint)

  for (const endpoint of endpoints) {
    if (await closeChromiumAtEndpoint(endpoint, 'Chrome còn sót sau worker exit')) return true
  }
  return false
}
