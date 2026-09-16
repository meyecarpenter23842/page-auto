import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { DEFAULT_APP_SETTINGS, type BrowserSettings } from '../../shared/appSettings'
import type { BrowserWindowPlacement } from '../../shared/browserWindowLayout'
import { wholeChromeScaleForLaunch } from '../../shared/browserWholeChromeScale'
import type { ZaloBrowserSettings, ZaloSessionStatus } from '../../shared/zalo'
import {
  applyBrowserContextSettings,
  applyBrowserPlacementToContext,
  buildBrowserLaunchOptions
} from '../browser/browserRuntime'

interface OpenCommand {
  type: 'open'
  accountId: number
  settings: ZaloBrowserSettings
  placement: BrowserWindowPlacement | null
}

interface ApplySettingsCommand {
  type: 'apply-settings'
  settings: ZaloBrowserSettings
  placement: BrowserWindowPlacement | null
}

interface ShutdownCommand { type: 'shutdown' }
type WorkerCommand = OpenCommand | ApplySettingsCommand | ShutdownCommand

interface WorkerResult {
  type: 'zalo-result'
  accountId: number
  status: ZaloSessionStatus
  message: string
  reused: boolean
}

interface WorkerClosed { type: 'zalo-closed'; accountId: number }

function payloadOf(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

function commandOf(event: unknown): WorkerCommand | null {
  const payload = payloadOf(event)
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<WorkerCommand>
  if (candidate.type === 'shutdown') return { type: 'shutdown' }
  if (candidate.type === 'open' && typeof (candidate as Partial<OpenCommand>).accountId === 'number' && (candidate as Partial<OpenCommand>).settings) {
    const open = candidate as OpenCommand
    return { type: 'open', accountId: open.accountId, settings: open.settings, placement: open.placement ?? null }
  }
  if (candidate.type === 'apply-settings' && (candidate as Partial<ApplySettingsCommand>).settings) {
    const apply = candidate as ApplySettingsCommand
    return { type: 'apply-settings', settings: apply.settings, placement: apply.placement ?? null }
  }
  return null
}

export interface ZaloSessionEvidence {
  authenticatedShell: boolean
  loginSurface: boolean
  qrSurface: boolean
  attentionSurface: boolean
}

export function classifyZaloSessionEvidence(evidence: ZaloSessionEvidence): ZaloSessionStatus {
  if (evidence.authenticatedShell) return 'ready'
  if (evidence.attentionSurface) return 'needs_attention'
  if (evidence.qrSurface) return 'qr_waiting'
  if (evidence.loginSurface) return 'login_required'
  return 'needs_attention'
}

async function inspectSession(page: Page): Promise<ZaloSessionEvidence> {
  // Read-only probes only. Batch 1 deliberately does not automate phone/password login.
  return page.evaluate(() => {
    const text = (document.body?.innerText ?? '').toLocaleLowerCase('vi-VN')
    const authenticatedShell = Boolean(
      document.querySelector('#app-page')
      && (text.includes('tin nhắn') || text.includes('danh bạ'))
    )
    const qrSurface = Boolean(
      document.querySelector('canvas, img[src*="qr" i]')
      && (text.includes('quét mã qr') || text.includes('mã qr'))
    )
    const loginSurface = text.includes('đăng nhập') || text.includes('số điện thoại')
    const attentionSurface = text.includes('xác minh') || text.includes('captcha') || text.includes('bất thường')
    return { authenticatedShell, loginSurface, qrSurface, attentionSurface }
  }).catch(() => ({ authenticatedShell: false, loginSurface: false, qrSurface: false, attentionSurface: true }))
}

function asBrowserSettings(settings: ZaloBrowserSettings): BrowserSettings {
  return {
    ...DEFAULT_APP_SETTINGS.browser,
    executablePath: settings.executablePath,
    windowWidth: settings.windowWidth,
    windowHeight: settings.windowHeight
  }
}

async function run(): Promise<void> {
  const profileDirectory = process.argv[2]
  const accountId = Number(process.argv[3])
  if (!profileDirectory || !Number.isInteger(accountId)) throw new Error('Missing Zalo profile/account worker arguments.')
  const parentPort = process.parentPort
  if (!parentPort) throw new Error('Zalo browser worker phải chạy dưới Electron utilityProcess.')

  let context: BrowserContext | null = null
  let currentScale: number | null = null
  let closing = false
  let queue = Promise.resolve()

  const post = (status: ZaloSessionStatus, message: string, reused: boolean): void => {
    const result: WorkerResult = { type: 'zalo-result', accountId, status, message, reused }
    parentPort.postMessage(result)
  }

  const ensureOpen = async (command: OpenCommand): Promise<void> => {
    const browserSettings = asBrowserSettings(command.settings)
    const requestedScale = wholeChromeScaleForLaunch(command.placement)
    const reused = context !== null

    if (!context) {
      const launchShape = buildBrowserLaunchOptions(browserSettings, command.placement)
      currentScale = requestedScale
      const opened = await chromium.launchPersistentContext(profileDirectory, {
        ...launchShape,
        args: [
          ...launchShape.args,
          ...(requestedScale !== null ? [`--force-device-scale-factor=${requestedScale}`] : [])
        ],
        viewport: null
      })
      context = opened
      await applyBrowserContextSettings(opened, browserSettings)
      opened.once('close', () => {
        context = null
        if (!closing) {
          const closed: WorkerClosed = { type: 'zalo-closed', accountId }
          parentPort.postMessage(closed)
          setTimeout(() => process.exit(0), 25)
        }
      })
    }

    const active = context
    if (!active) throw new Error('Zalo browser context không khả dụng.')
    if (currentScale === requestedScale) {
      await applyBrowserPlacementToContext(active, command.placement)
    }

    const page = active.pages()[0] ?? await active.newPage()
    if (!page.url().startsWith('https://chat.zalo.me')) {
      await page.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded', timeout: browserSettings.navigationTimeoutMs }).catch(() => undefined)
    }
    const evidence = await inspectSession(page)
    const status = classifyZaloSessionEvidence(evidence)
    const message = status === 'ready'
      ? 'Zalo session đã xác thực.'
      : status === 'qr_waiting'
        ? 'Đang chờ operator quét QR trên Zalo Web.'
        : status === 'login_required'
          ? 'Zalo yêu cầu đăng nhập thủ công.'
          : 'Zalo cần operator kiểm tra trạng thái đăng nhập/challenge.'
    post(status, message, reused)
  }

  const applySettings = async (command: ApplySettingsCommand): Promise<void> => {
    if (!context) return
    const requestedScale = wholeChromeScaleForLaunch(command.placement)
    if (currentScale === requestedScale) {
      await applyBrowserPlacementToContext(context, command.placement)
    }
    // Whole-Chrome scale is a Chrome launch flag. A changed scale is applied on the
    // next reopen; never fake a successful in-place scale change.
  }

  parentPort.on('message', (event) => {
    const command = commandOf(event)
    if (!command) return
    if (command.type === 'shutdown') {
      closing = true
      queue = queue.then(async () => {
        const active = context
        context = null
        if (active) await active.close().catch(() => undefined)
        const closed: WorkerClosed = { type: 'zalo-closed', accountId }
        parentPort.postMessage(closed)
        setTimeout(() => process.exit(0), 25)
      })
      return
    }
    queue = queue.then(() => command.type === 'open' ? ensureOpen(command) : applySettings(command)).catch((error) => {
      post('browser_error', error instanceof Error ? error.message : String(error), context !== null)
    })
  })
}

void run().catch((error) => {
  const parentPort = process.parentPort
  if (parentPort) {
    const result: WorkerResult = {
      type: 'zalo-result',
      accountId: Number(process.argv[3]) || 0,
      status: 'browser_error',
      message: error instanceof Error ? error.message : String(error),
      reused: false
    }
    parentPort.postMessage(result)
  }
  setTimeout(() => process.exit(1), 25)
})
