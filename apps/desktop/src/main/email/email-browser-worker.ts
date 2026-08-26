import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { friendlyEmailBrowserError, isEmailProfileInUseError } from './emailBrowserLifecycle'

interface ProxyConfig {
  server: string
  username?: string
  password?: string
}

interface OpenCommand {
  type: 'open-mail'
  accountId: number
  profileDirectory: string
  executablePath?: string
  proxy?: ProxyConfig
}

interface OpenResult {
  type: 'open-result'
  accountId: number
  status: 'started' | 'already_open' | 'profile_in_use' | 'error'
  attached: boolean
  proxyManagedExternally: boolean
  message: string
}

function unwrapMessage(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function parseCommand(event: unknown): OpenCommand | null {
  const payload = unwrapMessage(event)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<OpenCommand>
  if (candidate.type !== 'open-mail' || typeof candidate.accountId !== 'number' || typeof candidate.profileDirectory !== 'string') return null
  return candidate as OpenCommand
}

async function readCdpEndpoint(profileDirectory: string): Promise<string | null> {
  try {
    const [portText] = (await readFile(join(profileDirectory, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
    if (portText && /^\d+$/.test(portText)) return `http://127.0.0.1:${portText}`
  } catch {
    // Not a CDP-enabled running browser.
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

async function readLiveCdpEndpoint(profileDirectory: string): Promise<string | null> {
  const endpoint = await readCdpEndpoint(profileDirectory)
  return endpoint && await probeCdpEndpoint(endpoint) ? endpoint : null
}

async function openOutlook(context: BrowserContext): Promise<void> {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto('https://outlook.live.com/mail/0/', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined)
  await page.bringToFront().catch(() => undefined)
}

async function launchProfile(command: OpenCommand): Promise<BrowserContext> {
  if (!command.executablePath?.trim()) throw new Error('Browser executable not found')
  return await chromium.launchPersistentContext(command.profileDirectory, {
    headless: false,
    viewport: null,
    executablePath: command.executablePath,
    ...(command.proxy ? { proxy: command.proxy } : {})
  })
}

async function launchOrInUse(command: OpenCommand): Promise<{ context: BrowserContext | null; result: OpenResult | null }> {
  try {
    const context = await launchProfile(command)
    await openOutlook(context)
    return { context, result: null }
  } catch (error) {
    if (isEmailProfileInUseError(error)) {
      return {
        context: null,
        result: {
          type: 'open-result',
          accountId: command.accountId,
          status: 'profile_in_use',
          attached: false,
          proxyManagedExternally: true,
          message: friendlyEmailBrowserError(error)
        }
      }
    }
    throw error
  }
}

async function run(): Promise<void> {
  let launchedContext: BrowserContext | null = null
  let attachedBrowser: Browser | null = null
  let closing = false

  process.parentPort?.on('message', (event) => {
    const command = parseCommand(event)
    if (!command || closing) return

    void (async () => {
      let result: OpenResult
      try {
        if (launchedContext) {
          await openOutlook(launchedContext)
          result = {
            type: 'open-result', accountId: command.accountId, status: 'already_open', attached: false,
            proxyManagedExternally: false, message: 'Email browser đang mở bằng đúng profile UID này.'
          }
        } else if (attachedBrowser) {
          const context = attachedBrowser.contexts()[0]
          if (!context) throw new Error('Browser CDP đang chạy nhưng không có context khả dụng.')
          await openOutlook(context)
          result = {
            type: 'open-result', accountId: command.accountId, status: 'already_open', attached: true,
            proxyManagedExternally: true, message: 'Đã attach browser Email đang chạy; proxy do process sở hữu browser quản lý.'
          }
        } else {
          const endpoint = await readLiveCdpEndpoint(command.profileDirectory)
          if (endpoint) {
            try {
              attachedBrowser = await chromium.connectOverCDP(endpoint)
              const context = attachedBrowser.contexts()[0]
              if (!context) throw new Error('Không tìm thấy browser context qua CDP.')
              await openOutlook(context)
              result = {
                type: 'open-result', accountId: command.accountId, status: 'already_open', attached: true,
                proxyManagedExternally: true, message: 'Đã attach browser Email đang chạy; không thay proxy giữa phiên.'
              }
            } catch {
              attachedBrowser = null
              const relaunched = await launchOrInUse(command)
              if (relaunched.result) {
                result = relaunched.result
              } else {
                launchedContext = relaunched.context
                result = {
                  type: 'open-result', accountId: command.accountId, status: 'started', attached: false,
                  proxyManagedExternally: false, message: 'CDP cũ/attach lỗi; đã mở lại đúng profile Email theo UID mà không xóa lock.'
                }
              }
            }
          } else {
            const launched = await launchOrInUse(command)
            if (launched.result) {
              result = launched.result
            } else {
              launchedContext = launched.context
              result = {
                type: 'open-result', accountId: command.accountId, status: 'started', attached: false,
                proxyManagedExternally: false, message: 'Đã mở trực tiếp profile Email có sẵn theo UID.'
              }
            }
          }

          if (launchedContext) {
            launchedContext.once('close', () => {
              launchedContext = null
              if (!closing) {
                closing = true
                setTimeout(() => process.exit(0), 25)
              }
            })
          }
        }
      } catch (error) {
        result = {
          type: 'open-result', accountId: command.accountId, status: 'error', attached: false,
          proxyManagedExternally: false, message: friendlyEmailBrowserError(error)
        }
      }
      process.parentPort?.postMessage(result)
    })()
  })
}

void run().catch((error) => {
  console.error('[PAGE-AUTO email browser worker]', friendlyEmailBrowserError(error))
  process.exitCode = 1
})
