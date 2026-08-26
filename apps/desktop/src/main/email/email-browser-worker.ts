import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import type { HotmailNeedsAttentionReason, HotmailRecoveryOperation } from '../../shared/hotmail'
import { friendlyEmailBrowserError, isEmailProfileInUseError } from './emailBrowserLifecycle'

interface ProxyConfig {
  server: string
  username?: string
  password?: string
}

interface BrowserCommandBase {
  accountId: number
  profileDirectory: string
  executablePath?: string
  proxy?: ProxyConfig
}

interface OpenCommand extends BrowserCommandBase {
  type: 'open-mail'
}

interface RecoveryCommand extends BrowserCommandBase {
  type: 'recovery-action'
  operation: HotmailRecoveryOperation
  confirmCompleted: boolean
}

type WorkerCommand = OpenCommand | RecoveryCommand

interface OpenResult {
  type: 'open-result'
  accountId: number
  status: 'started' | 'already_open' | 'profile_in_use' | 'error'
  attached: boolean
  proxyManagedExternally: boolean
  message: string
}

interface RecoveryResult {
  type: 'recovery-result'
  accountId: number
  operation: HotmailRecoveryOperation
  status: 'success' | 'needs_attention' | 'profile_in_use' | 'error'
  needsAttentionReason?: HotmailNeedsAttentionReason
  proxyManagedExternally: boolean
  message: string
}

function unwrapMessage(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function parseCommand(event: unknown): WorkerCommand | null {
  const payload = unwrapMessage(event)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<WorkerCommand>
  if (typeof candidate.accountId !== 'number' || typeof candidate.profileDirectory !== 'string') return null
  if (candidate.type === 'open-mail') return candidate as OpenCommand
  if (candidate.type === 'recovery-action' && (candidate.operation === 'add' || candidate.operation === 'remove' || candidate.operation === 'replace')) {
    return candidate as RecoveryCommand
  }
  return null
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

async function openOutlook(context: BrowserContext, requireNavigation: boolean): Promise<void> {
  const page = context.pages()[0] ?? await context.newPage()
  const navigation = page.goto('https://outlook.live.com/mail/0/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  if (requireNavigation) await navigation
  else await navigation.catch(() => undefined)
  await page.bringToFront().catch(() => undefined)
}

async function launchProfile(command: BrowserCommandBase): Promise<BrowserContext> {
  if (!command.executablePath?.trim()) throw new Error('Browser executable not found')
  return await chromium.launchPersistentContext(command.profileDirectory, {
    headless: false,
    viewport: null,
    executablePath: command.executablePath,
    ...(command.proxy ? { proxy: command.proxy } : {})
  })
}

function manualReasonMessage(reason: HotmailNeedsAttentionReason): string {
  if (reason === 'needs_login') return 'Microsoft yêu cầu đăng nhập lại trong đúng profile Email. PAGE-AUTO giữ phiên để anh xử lý thủ công.'
  if (reason === 'identity_review') return 'Microsoft đang yêu cầu xác minh danh tính. PAGE-AUTO dừng ở trạng thái cần xử lý thủ công.'
  if (reason === 'security_review') return 'Microsoft đang yêu cầu bước xác minh bảo mật. PAGE-AUTO không tự vượt bước này.'
  return 'Đã mở Microsoft Security bằng đúng profile Email. Hoàn tất thao tác trên browser rồi bấm Xác nhận hoàn tất.'
}

async function detectAttention(page: Page): Promise<HotmailNeedsAttentionReason | null> {
  const url = page.url().toLowerCase()
  let text = ''
  try {
    text = (await page.locator('body').innerText({ timeout: 3_000 })).toLowerCase()
  } catch {
    return null
  }

  if (/login\.live\.com|signin|oauth20_authorize/.test(url) || /sign in|đăng nhập/.test(text)) return 'needs_login'
  if (/verify your identity|confirm your identity|identity verification|xác minh danh tính/.test(text)) return 'identity_review'
  if (/enter.*code|security code|verify.*account|help us protect|xác minh bảo mật|mã bảo mật/.test(text)) return 'security_review'
  return null
}

function recoveryInstruction(operation: HotmailRecoveryOperation): string {
  if (operation === 'add') return 'thêm Email khôi phục'
  if (operation === 'remove') return 'xóa Email khôi phục'
  return 'thay Email khôi phục'
}

async function openRecoverySecurityPage(context: BrowserContext): Promise<Page> {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto('https://account.live.com/proofs/manage/additional', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000
  })
  await page.bringToFront().catch(() => undefined)
  return page
}

async function runRecoveryAction(context: BrowserContext, command: RecoveryCommand, proxyManagedExternally: boolean): Promise<RecoveryResult> {
  const page = command.confirmCompleted
    ? (context.pages()[0] ?? await context.newPage())
    : await openRecoverySecurityPage(context)
  await page.bringToFront().catch(() => undefined)

  const attention = await detectAttention(page)
  if (attention) {
    return {
      type: 'recovery-result',
      accountId: command.accountId,
      operation: command.operation,
      status: 'needs_attention',
      needsAttentionReason: attention,
      proxyManagedExternally,
      message: manualReasonMessage(attention)
    }
  }

  if (!command.confirmCompleted) {
    return {
      type: 'recovery-result',
      accountId: command.accountId,
      operation: command.operation,
      status: 'needs_attention',
      needsAttentionReason: 'manual_completion_required',
      proxyManagedExternally,
      message: `${manualReasonMessage('manual_completion_required')} Nghiệp vụ: ${recoveryInstruction(command.operation)}.`
    }
  }

  const url = page.url().toLowerCase()
  if (!url.includes('account.live.com')) {
    return {
      type: 'recovery-result',
      accountId: command.accountId,
      operation: command.operation,
      status: 'needs_attention',
      needsAttentionReason: 'manual_completion_required',
      proxyManagedExternally,
      message: 'Phiên Email chưa quay lại trang Microsoft Security; chưa cập nhật dữ liệu account.'
    }
  }

  return {
    type: 'recovery-result',
    accountId: command.accountId,
    operation: command.operation,
    status: 'success',
    proxyManagedExternally,
    message: 'Đã xác nhận thao tác Microsoft Security hoàn tất trong cùng phiên Email.'
  }
}

async function run(): Promise<void> {
  let launchedContext: BrowserContext | null = null
  let attachedBrowser: Browser | null = null
  let attachedExternally = false
  let closing = false

  const resolveContext = async (command: BrowserCommandBase): Promise<{ context: BrowserContext; proxyManagedExternally: boolean } | OpenResult> => {
    if (launchedContext) return { context: launchedContext, proxyManagedExternally: false }
    if (attachedBrowser) {
      const context = attachedBrowser.contexts()[0]
      if (!context) throw new Error('Browser CDP đang chạy nhưng không có context khả dụng.')
      return { context, proxyManagedExternally: true }
    }

    const endpoint = await readLiveCdpEndpoint(command.profileDirectory)
    if (endpoint) {
      try {
        attachedBrowser = await chromium.connectOverCDP(endpoint)
        const context = attachedBrowser.contexts()[0]
        if (!context) throw new Error('Không tìm thấy browser context qua CDP.')
        attachedExternally = true
        return { context, proxyManagedExternally: true }
      } catch {
        attachedBrowser = null
        attachedExternally = false
      }
    }

    try {
      launchedContext = await launchProfile(command)
      launchedContext.once('close', () => {
        launchedContext = null
        if (!closing) {
          closing = true
          setTimeout(() => process.exit(0), 25)
        }
      })
      return { context: launchedContext, proxyManagedExternally: false }
    } catch (error) {
      if (isEmailProfileInUseError(error)) {
        return {
          type: 'open-result',
          accountId: command.accountId,
          status: 'profile_in_use',
          attached: false,
          proxyManagedExternally: true,
          message: friendlyEmailBrowserError(error)
        }
      }
      throw error
    }
  }

  process.parentPort?.on('message', (event) => {
    const command = parseCommand(event)
    if (!command || closing) return

    void (async () => {
      try {
        const resolved = await resolveContext(command)
        if ('type' in resolved) {
          if (command.type === 'open-mail') {
            process.parentPort?.postMessage(resolved)
          } else {
            const result: RecoveryResult = {
              type: 'recovery-result',
              accountId: command.accountId,
              operation: command.operation,
              status: 'profile_in_use',
              proxyManagedExternally: true,
              message: resolved.message
            }
            process.parentPort?.postMessage(result)
          }
          return
        }

        if (command.type === 'open-mail') {
          await openOutlook(resolved.context, Boolean(command.proxy) && !resolved.proxyManagedExternally)
          const result: OpenResult = {
            type: 'open-result',
            accountId: command.accountId,
            status: launchedContext ? 'started' : 'already_open',
            attached: resolved.proxyManagedExternally,
            proxyManagedExternally: resolved.proxyManagedExternally,
            message: resolved.proxyManagedExternally
              ? 'Đã attach browser Email đang chạy; proxy do process sở hữu browser quản lý.'
              : 'Đã mở trực tiếp profile Email có sẵn theo UID.'
          }
          process.parentPort?.postMessage(result)
          return
        }

        const result = await runRecoveryAction(resolved.context, command, resolved.proxyManagedExternally || attachedExternally)
        process.parentPort?.postMessage(result)
      } catch (error) {
        if (command.type === 'open-mail') {
          const result: OpenResult = {
            type: 'open-result',
            accountId: command.accountId,
            status: 'error',
            attached: false,
            proxyManagedExternally: false,
            message: friendlyEmailBrowserError(error)
          }
          process.parentPort?.postMessage(result)
        } else {
          const result: RecoveryResult = {
            type: 'recovery-result',
            accountId: command.accountId,
            operation: command.operation,
            status: 'error',
            proxyManagedExternally: false,
            message: 'Thao tác Mail khôi phục chưa hoàn tất trong browser Email.'
          }
          process.parentPort?.postMessage(result)
        }
      }
    })()
  })
}

void run().catch((error) => {
  console.error('[PAGE-AUTO email browser worker]', friendlyEmailBrowserError(error))
  process.exitCode = 1
})
