import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext } from 'playwright-core'

interface ProxyConfig { server: string; username?: string; password?: string }
interface ProxyTestCommand { type: 'test-proxy'; executablePath: string; proxy: ProxyConfig | null }
interface BrowserTestCommand { type: 'test-browser'; executablePath: string }
type TestCommand = ProxyTestCommand | BrowserTestCommand

function commandFrom(event: unknown): TestCommand | null {
  const raw = event && typeof event === 'object' && 'data' in event ? (event as { data?: unknown }).data : event
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<TestCommand>
  if ((candidate.type !== 'test-proxy' && candidate.type !== 'test-browser') || typeof candidate.executablePath !== 'string') return null
  return candidate as TestCommand
}

function safeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/executable.*(doesn.t exist|not found)|enoent/i.test(message)) return 'Không tìm thấy file Browser Email đã cấu hình.'
  if (/proxy|tunnel|err_proxy|err_tunnel/i.test(message)) return 'Proxy Email không kết nối được trong lần kiểm tra.'
  if (/timeout|timed out/i.test(message)) return 'Browser Email kiểm tra quá thời gian chờ.'
  return 'Browser Email không mở được bằng persistent profile semantics.'
}

async function launchPersistent(command: TestCommand, profileDirectory: string): Promise<BrowserContext> {
  return await chromium.launchPersistentContext(profileDirectory, {
    headless: true,
    executablePath: command.executablePath,
    ...(command.type === 'test-proxy' && command.proxy ? { proxy: command.proxy } : {})
  })
}

process.parentPort?.once('message', (event) => {
  const command = commandFrom(event)
  if (!command) return
  void (async () => {
    const profileDirectory = await mkdtemp(join(tmpdir(), 'page-auto-email-browser-test-'))
    let context: BrowserContext | null = null
    try {
      context = await launchPersistent(command, profileDirectory)
      const page = context.pages()[0] ?? await context.newPage()

      if (command.type === 'test-browser') {
        await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10_000 })
        process.parentPort?.postMessage({
          type: 'browser-test-result',
          ok: true,
          message: 'Browser Email mở persistent profile tạm và phản hồi bình thường.'
        })
        return
      }

      const response = await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded', timeout: 20_000 })
      const text = await response?.text() ?? ''
      let publicIp: string | null = null
      try {
        const parsed = JSON.parse(text) as { ip?: unknown }
        publicIp = typeof parsed.ip === 'string' ? parsed.ip : null
      } catch { /* ignored */ }
      process.parentPort?.postMessage({
        type: 'proxy-test-result',
        ok: Boolean(publicIp),
        publicIp,
        message: publicIp ? `Public IP: ${publicIp}` : 'Không đọc được public IP.'
      })
    } catch (error) {
      if (command.type === 'test-browser') {
        process.parentPort?.postMessage({ type: 'browser-test-result', ok: false, message: safeFailureMessage(error) })
      } else {
        process.parentPort?.postMessage({ type: 'proxy-test-result', ok: false, publicIp: null, message: safeFailureMessage(error) })
      }
    } finally {
      await context?.close().catch(() => undefined)
      await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined)
      setTimeout(() => process.exit(0), 25)
    }
  })()
})
