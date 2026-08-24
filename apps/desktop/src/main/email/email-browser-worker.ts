import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import type { ParsedEmailProxy } from './emailProxyPool'

interface OpenCommand {
  type: 'open'
  cdpEndpoint: string | null
  executablePath: string | null
  email: string | null
  proxy: ParsedEmailProxy | null
}

interface CloseCommand {
  type: 'close'
}

type WorkerCommand = OpenCommand | CloseCommand

interface OpenedMessage {
  type: 'opened'
  status: 'started' | 'attached' | 'error'
  proxyManagedExternally: boolean
  message: string
}

function commandFromEvent(event: unknown): WorkerCommand | null {
  const payload = event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
  if (!payload || typeof payload !== 'object' || !('type' in payload)) return null
  const candidate = payload as Partial<WorkerCommand>
  if (candidate.type === 'close') return { type: 'close' }
  if (candidate.type !== 'open') return null
  return candidate as OpenCommand
}

async function navigateMail(context: BrowserContext): Promise<void> {
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto('https://outlook.live.com/mail/', { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.bringToFront()
}

async function run(profileDirectory: string): Promise<void> {
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let ownsContext = false
  let opened = false

  const send = (message: OpenedMessage): void => { process.parentPort?.postMessage(message) }

  process.parentPort?.on('message', (event) => {
    const command = commandFromEvent(event)
    if (!command) return
    if (command.type === 'close') {
      if (ownsContext && context) {
        void context.close().finally(() => process.exit(0))
      } else {
        process.exit(0)
      }
      return
    }
    if (opened) return
    opened = true

    void (async () => {
      try {
        if (command.cdpEndpoint) {
          browser = await chromium.connectOverCDP(command.cdpEndpoint)
          context = browser.contexts()[0] ?? null
          if (!context) throw new Error('CDP browser không có context để mở mail.')
          await navigateMail(context)
          send({
            type: 'opened',
            status: 'attached',
            proxyManagedExternally: true,
            message: 'Đã attach vào MaxHotmail browser đang chạy; proxy do process ngoài quản lý.'
          })
          return
        }

        if (!command.executablePath) throw new Error('Chưa cấu hình browser executable cho Email profile.')
        const proxy = command.proxy
          ? {
              server: command.proxy.server,
              ...(command.proxy.username ? { username: command.proxy.username } : {}),
              ...(command.proxy.password ? { password: command.proxy.password } : {})
            }
          : undefined
        context = await chromium.launchPersistentContext(profileDirectory, {
          executablePath: command.executablePath,
          headless: false,
          viewport: null,
          args: ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
          ...(proxy ? { proxy } : {})
        })
        ownsContext = true
        context.once('close', () => process.exit(0))
        await navigateMail(context)
        send({
          type: 'opened',
          status: 'started',
          proxyManagedExternally: false,
          message: command.proxy
            ? `Đã mở profile MaxHotmail trực tiếp với Email Proxy pool (${command.proxy.server}).`
            : 'Đã mở profile MaxHotmail trực tiếp ở chế độ Direct.'
        })
      } catch (error) {
        send({
          type: 'opened',
          status: 'error',
          proxyManagedExternally: false,
          message: error instanceof Error ? error.message : String(error)
        })
        setTimeout(() => process.exit(1), 25)
      }
    })()
  })
}

const profileDirectory = process.argv[2]
if (!profileDirectory) throw new Error('Missing Email profile directory.')
void run(profileDirectory)
