import { utilityProcess } from 'electron'
import { isIP } from 'node:net'
import { join } from 'node:path'
import type { HotmailProxyTestResult } from '../../shared/hotmail'
import { startEmailProxyAuthBridge } from './emailProxyAuthBridge'
import type { EmailProxyCandidate } from './emailProxyPool'

interface ProxyWorkerResult {
  type: 'proxy-test-result'
  ok: boolean
  publicIp: string | null
  message: string
}

interface BrowserWorkerResult {
  type: 'browser-test-result'
  ok: boolean
  message: string
}

function isProxyResult(value: unknown): value is ProxyWorkerResult {
  return Boolean(value && typeof value === 'object' && (value as Partial<ProxyWorkerResult>).type === 'proxy-test-result')
}

function isBrowserResult(value: unknown): value is BrowserWorkerResult {
  return Boolean(value && typeof value === 'object' && (value as Partial<BrowserWorkerResult>).type === 'browser-test-result')
}

export async function testEmailBrowserExecutable(executablePath: string): Promise<{ ok: boolean; message: string }> {
  const worker = utilityProcess.fork(join(__dirname, 'email-proxy-test-worker.js'), [], { serviceName: 'PAGE-AUTO email browser validation' })
  return await new Promise((resolve) => {
    let settled = false
    const finish = (result: { ok: boolean; message: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.kill()
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false, message: 'Browser Email persistent validation quá thời gian chờ.' }), 25_000)
    worker.on('message', (message) => {
      if (isBrowserResult(message)) finish({ ok: message.ok, message: message.message })
    })
    worker.once('exit', (code) => {
      if (!settled) finish({ ok: false, message: `Browser Email validation worker đã thoát (code ${code}).` })
    })
    worker.once('spawn', () => worker.postMessage({ type: 'test-browser', executablePath: executablePath.trim() }))
  })
}

export async function testEmailProxy(
  proxy: EmailProxyCandidate | null,
  executablePath: string
): Promise<HotmailProxyTestResult> {
  const bridge = proxy ? await startEmailProxyAuthBridge(proxy) : null
  const browserProxy = proxy
    ? bridge
      ? { server: bridge.server }
      : { server: proxy.server, username: proxy.username, password: proxy.password }
    : null
  const worker = utilityProcess.fork(join(__dirname, 'email-proxy-test-worker.js'), [], { serviceName: 'PAGE-AUTO email proxy test' })

  try {
    return await new Promise<HotmailProxyTestResult>((resolve) => {
      let settled = false
      const finish = (result: HotmailProxyTestResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        worker.kill()
        resolve(result)
      }
      const timer = setTimeout(() => finish({ ok: false, proxy: proxy?.display ?? null, publicIp: null, message: 'Proxy test quá thời gian chờ.' }), 30_000)
      worker.on('message', (message) => {
        if (!isProxyResult(message)) return
        const publicIp = message.publicIp
        const ipv4Required = Boolean(proxy)
        const ok = message.ok && (!ipv4Required || (publicIp !== null && isIP(publicIp) === 4))
        finish({
          ok,
          proxy: proxy?.display ?? null,
          publicIp,
          message: ok
            ? message.message
            : ipv4Required && publicIp && isIP(publicIp) !== 4
              ? 'Proxy Email không trả về public IPv4 như yêu cầu.'
              : message.message
        })
      })
      worker.once('exit', (code) => {
        if (!settled) finish({ ok: false, proxy: proxy?.display ?? null, publicIp: null, message: `Proxy test worker đã thoát (code ${code}).` })
      })
      worker.once('spawn', () => {
        worker.postMessage({ type: 'test-proxy', executablePath: executablePath.trim(), proxy: browserProxy })
      })
    })
  } finally {
    await bridge?.close().catch(() => undefined)
  }
}
