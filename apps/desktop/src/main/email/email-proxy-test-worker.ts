import { chromium } from 'playwright-core'

interface ProxyConfig { server: string; username?: string; password?: string }
interface TestCommand { type: 'test-proxy'; executablePath?: string; proxy: ProxyConfig | null }

function commandFrom(event: unknown): TestCommand | null {
  const raw = event && typeof event === 'object' && 'data' in event ? (event as { data?: unknown }).data : event
  if (!raw || typeof raw !== 'object' || (raw as Partial<TestCommand>).type !== 'test-proxy') return null
  return raw as TestCommand
}

process.parentPort?.once('message', (event) => {
  const command = commandFrom(event)
  if (!command) return
  void (async () => {
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
    try {
      browser = await chromium.launch({
        headless: true,
        ...(command.executablePath ? { executablePath: command.executablePath } : {}),
        ...(command.proxy ? { proxy: command.proxy } : {})
      })
      const context = await browser.newContext()
      const page = await context.newPage()
      const response = await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded', timeout: 20_000 })
      const text = await response?.text() ?? ''
      let publicIp: string | null = null
      try {
        const parsed = JSON.parse(text) as { ip?: unknown }
        publicIp = typeof parsed.ip === 'string' ? parsed.ip : null
      } catch { /* ignored */ }
      process.parentPort?.postMessage({ type: 'proxy-test-result', ok: Boolean(publicIp), publicIp, message: publicIp ? `Public IP: ${publicIp}` : 'Không đọc được public IP.' })
    } catch (error) {
      process.parentPort?.postMessage({ type: 'proxy-test-result', ok: false, publicIp: null, message: error instanceof Error ? error.message : String(error) })
    } finally {
      await browser?.close().catch(() => undefined)
      setTimeout(() => process.exit(0), 25)
    }
  })()
})
