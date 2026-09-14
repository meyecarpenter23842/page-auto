import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright-core'
import type { HotmailNeedsAttentionReason } from '../../shared/hotmail'
import { friendlyEmailBrowserError, isEmailProfileInUseError } from './emailBrowserLifecycle'
import { adoptNewestMicrosoftFlowPage } from './emailMicrosoftPageOwnership'
import { runMicrosoftAuthV2WorkerController } from './microsoftAuthV2WorkerController'
import { parseMicrosoftOAuthLoopbackUrl, type MicrosoftOAuthLoopbackResult } from './microsoftOAuthAuthorization'

interface ProxyConfig {
  server: string
  username?: string
  password?: string
}

interface OAuthCommand {
  type: 'oauth-authorize'
  accountId: number
  profileDirectory: string
  executablePath: string
  authorizationUrl: string
  state: string
  proxy?: ProxyConfig
  loginEmail?: string
  loginPassword?: string
  backupEmail?: string
}

interface OAuthWorkerResult {
  type: 'oauth-result'
  accountId: number
  status: 'success' | 'needs_attention' | 'profile_in_use' | 'error'
  code?: string
  needsAttentionReason?: HotmailNeedsAttentionReason
  proxyManagedExternally: boolean
  message: string
}

function unwrapMessage(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function parseCommand(event: unknown): OAuthCommand | null {
  const value = unwrapMessage(event)
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<OAuthCommand>
  if (candidate.type !== 'oauth-authorize') return null
  if (typeof candidate.accountId !== 'number') return null
  if (typeof candidate.profileDirectory !== 'string') return null
  if (typeof candidate.executablePath !== 'string') return null
  if (typeof candidate.authorizationUrl !== 'string') return null
  if (typeof candidate.state !== 'string') return null
  return candidate as OAuthCommand
}

async function readCdpEndpoint(profileDirectory: string): Promise<string | null> {
  try {
    const [portText] = (await readFile(join(profileDirectory, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
    if (portText && /^\d+$/.test(portText)) return `http://127.0.0.1:${portText}`
  } catch {
    // No externally attachable Email browser.
  }
  return null
}

async function probeCdpEndpoint(endpoint: string, timeoutMs = 650): Promise<boolean> {
  return await new Promise<boolean>((resolveProbe) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolveProbe(value)
    }
    try {
      const req = request(new URL('/json/version', endpoint), { method: 'GET', timeout: timeoutMs }, (response) => {
        response.resume()
        finish((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 500)
      })
      req.once('timeout', () => {
        req.destroy()
        finish(false)
      })
      req.once('error', () => finish(false))
      req.end()
    } catch {
      finish(false)
    }
  })
}

async function liveCdpEndpoint(profileDirectory: string): Promise<string | null> {
  const endpoint = await readCdpEndpoint(profileDirectory)
  return endpoint && await probeCdpEndpoint(endpoint) ? endpoint : null
}

function isMicrosoftPageUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'login.live.com'
      || hostname === 'login.microsoftonline.com'
      || hostname === 'outlook.live.com'
      || hostname === 'account.live.com'
      || hostname === 'account.microsoft.com'
      || hostname === 'microsoft.com'
      || hostname.endsWith('.microsoft.com')
  } catch {
    return false
  }
}

function latestMicrosoftPage(context: BrowserContext): Page | null {
  const pages = context.pages().filter((page) => !page.isClosed() && isMicrosoftPageUrl(page.url()))
  return pages.at(-1) ?? null
}

async function openOutlookForAuth(context: BrowserContext): Promise<Page> {
  const current = latestMicrosoftPage(context)
  if (current && /login\.(?:live|microsoftonline)\.com/i.test(current.url())) {
    await current.bringToFront().catch(() => undefined)
    return current
  }

  const page = current ?? context.pages().find((candidate) => !candidate.isClosed()) ?? await context.newPage()
  try {
    await page.goto('https://outlook.live.com/mail/0/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  } catch (error) {
    if (!isMicrosoftPageUrl(page.url())) throw error
  }
  await page.bringToFront().catch(() => undefined)
  return page
}

async function hasConsentEvidence(page: Page): Promise<boolean> {
  const text = (await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')).replace(/\s+/g, ' ')
  return /permissions requested|review permissions|requested permissions|read(?: and write)? access to your mail|read your mail|mail\.read|allow this app/i.test(text)
}

async function clickConsentAccept(page: Page): Promise<boolean> {
  if (!isMicrosoftPageUrl(page.url()) || !await hasConsentEvidence(page)) return false
  const candidates = [
    page.getByRole('button', { name: /^(?:Accept|Chấp nhận)$/i }).first(),
    page.locator('input[type="submit"][value="Accept"]').first(),
    page.locator('input[type="submit"][value="Chấp nhận"]').first()
  ]
  for (const candidate of candidates) {
    if (!await candidate.isVisible().catch(() => false)) continue
    await candidate.click({ timeout: 5_000 })
    return true
  }
  return false
}

async function runOAuthAuthorize(
  context: BrowserContext,
  page: Page,
  command: OAuthCommand
): Promise<OAuthWorkerResult> {
  let callback: MicrosoftOAuthLoopbackResult | null = null
  let callbackError: string | null = null
  const onRequest = (requestValue: Request): void => {
    if (callback || callbackError) return
    try {
      const parsed = parseMicrosoftOAuthLoopbackUrl(requestValue.url(), command.state)
      if (parsed) callback = parsed
    } catch (error) {
      callbackError = error instanceof Error ? error.message : 'Microsoft OAuth callback không hợp lệ.'
    }
  }
  context.on('request', onRequest)

  try {
    try {
      await page.goto(command.authorizationUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    } catch (error) {
      if (!callback && !callbackError && !isMicrosoftPageUrl(page.url())) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/err_connection_refused|localhost/i.test(message)) throw error
      }
    }

    for (let step = 0; step < 8; step += 1) {
      if (callbackError) {
        return {
          type: 'oauth-result', accountId: command.accountId, status: 'error',
          proxyManagedExternally: false, message: callbackError
        }
      }
      if (callback?.kind === 'error') {
        return {
          type: 'oauth-result', accountId: command.accountId, status: 'error',
          proxyManagedExternally: false, message: `Microsoft OAuth ${callback.error}.`
        }
      }
      if (callback?.kind === 'code') {
        return {
          type: 'oauth-result', accountId: command.accountId, status: 'success', code: callback.code,
          proxyManagedExternally: false, message: 'Microsoft đã trả authorization code cho đúng Email profile.'
        }
      }

      page = await adoptNewestMicrosoftFlowPage(page, new Set())
      await page.bringToFront().catch(() => undefined)
      if (await clickConsentAccept(page)) {
        await page.waitForTimeout(1_000)
        continue
      }

      if (isMicrosoftPageUrl(page.url())) {
        const auth = await runMicrosoftAuthV2WorkerController(page, command, { maxSteps: 8 })
        page = await adoptNewestMicrosoftFlowPage(page, new Set())
        if (await clickConsentAccept(page)) {
          await page.waitForTimeout(1_000)
          continue
        }
        if (auth.status === 'needs_attention') {
          return {
            type: 'oauth-result',
            accountId: command.accountId,
            status: 'needs_attention',
            needsAttentionReason: auth.reason ?? 'needs_login',
            proxyManagedExternally: false,
            message: auth.message ?? 'Microsoft OAuth cần xử lý thủ công trong Email profile đang mở.'
          }
        }
      }
      await page.waitForTimeout(1_000)
    }

    if (callback?.kind === 'code') {
      return {
        type: 'oauth-result', accountId: command.accountId, status: 'success', code: callback.code,
        proxyManagedExternally: false, message: 'Microsoft đã trả authorization code cho đúng Email profile.'
      }
    }
    return {
      type: 'oauth-result',
      accountId: command.accountId,
      status: 'needs_attention',
      needsAttentionReason: 'manual_completion_required',
      proxyManagedExternally: false,
      message: 'Microsoft OAuth chưa trả callback. PAGE-AUTO giữ Email profile mở để anh hoàn tất bước Microsoft hiện tại.'
    }
  } finally {
    context.removeListener('request', onRequest)
  }
}

async function run(): Promise<void> {
  let launchedContext: BrowserContext | null = null
  let attachedBrowser: Browser | null = null
  let attachedExternally = false
  let busy = false

  const resolveContext = async (command: OAuthCommand): Promise<BrowserContext> => {
    if (launchedContext) return launchedContext
    if (attachedBrowser) {
      const context = attachedBrowser.contexts()[0]
      if (context) return context
      attachedBrowser = null
    }

    const endpoint = await liveCdpEndpoint(command.profileDirectory)
    if (endpoint) {
      attachedBrowser = await chromium.connectOverCDP(endpoint)
      const context = attachedBrowser.contexts()[0]
      if (!context) throw new Error('Browser Email qua CDP không có context khả dụng.')
      attachedExternally = true
      return context
    }

    launchedContext = await chromium.launchPersistentContext(command.profileDirectory, {
      headless: false,
      viewport: null,
      executablePath: command.executablePath,
      ...(command.proxy ? { proxy: command.proxy } : {})
    })
    return launchedContext
  }

  const finishOwnedBrowser = async (): Promise<void> => {
    if (!launchedContext) return
    const context = launchedContext
    launchedContext = null
    await context.close().catch(() => undefined)
  }

  process.parentPort?.on('message', (event) => {
    const command = parseCommand(event)
    if (!command || busy) return
    busy = true

    void (async () => {
      let result: OAuthWorkerResult
      try {
        const context = await resolveContext(command)
        const page = await openOutlookForAuth(context)
        const auth = await runMicrosoftAuthV2WorkerController(page, command)
        if (auth.status === 'needs_attention') {
          result = {
            type: 'oauth-result',
            accountId: command.accountId,
            status: 'needs_attention',
            needsAttentionReason: auth.reason ?? 'needs_login',
            proxyManagedExternally: attachedExternally,
            message: auth.message ?? 'Microsoft login chưa hoàn tất trong Email profile.'
          }
        } else {
          result = await runOAuthAuthorize(context, page, command)
          result.proxyManagedExternally = attachedExternally
        }
      } catch (error) {
        result = {
          type: 'oauth-result',
          accountId: command.accountId,
          status: isEmailProfileInUseError(error) ? 'profile_in_use' : 'error',
          proxyManagedExternally: attachedExternally,
          message: friendlyEmailBrowserError(error)
        }
      }

      if (result.status !== 'needs_attention') await finishOwnedBrowser()
      process.parentPort?.postMessage(result)
      busy = false
      if (result.status !== 'needs_attention') setTimeout(() => process.exit(0), 25)
    })()
  })
}

void run().catch((error) => {
  console.error('[PAGE-AUTO email oauth worker]', friendlyEmailBrowserError(error))
  process.exitCode = 1
})
