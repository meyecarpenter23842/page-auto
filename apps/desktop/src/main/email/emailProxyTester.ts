import { utilityProcess } from 'electron'
import { join } from 'node:path'
import type { HotmailProxyTestResult } from '../../shared/hotmail'
import type { EmailProxyCandidate } from './emailProxyPool'

interface ProxyWorkerResult {
  type: 'proxy-test-result'
  ok: boolean
  publicIp: string | null
  message: string
}

function isResult(value: unknown): value is ProxyWorkerResult {
  return Boolean(value && typeof value === 'object' && (value as Partial<ProxyWorkerResult>).type === 'proxy-test-result')
}

export async function testEmailProxy(
  proxy: EmailProxyCandidate | null,
  executablePath: string
): Promise<HotmailProxyTestResult> {
  const worker = utilityProcess.fork(join(__dirname, 'email-proxy-test-worker.js'), [], { serviceName: 'PAGE-AUTO email proxy test' })
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
      if (!isResult(message)) return
      finish({ ok: message.ok, proxy: proxy?.display ?? null, publicIp: message.publicIp, message: message.message })
    })
    worker.once('exit', (code) => {
      if (!settled) finish({ ok: false, proxy: proxy?.display ?? null, publicIp: null, message: `Proxy test worker đã thoát (code ${code}).` })
    })
    worker.once('spawn', () => {
      worker.postMessage({
        type: 'test-proxy',
        ...(executablePath.trim() ? { executablePath: executablePath.trim() } : {}),
        proxy: proxy ? { server: proxy.server, ...(proxy.username ? { username: proxy.username } : {}), ...(proxy.password ? { password: proxy.password } : {}) } : null
      })
    })
  })
}
