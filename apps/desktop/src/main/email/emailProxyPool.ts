import { Buffer } from 'node:buffer'
import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import type { EmailProxyMode, HotmailProxyResult, HotmailSettings } from '../../shared/hotmail'

export interface ParsedEmailProxy {
  raw: string
  server: string
  host: string
  port: number
  username: string | null
  password: string | null
}

export interface EmailProxySettingsStore {
  getSettings: () => HotmailSettings
  setCurrentProxy: (proxy: string | null) => HotmailSettings
}

function normalizeProxyLine(value: string): string | null {
  const normalized = value.trim()
  return normalized ? normalized : null
}

export function parseEmailProxy(rawValue: string): ParsedEmailProxy {
  const raw = rawValue.trim()
  if (!raw) throw new Error('Proxy rỗng.')

  if (/^[a-z]+:\/\//i.test(raw)) {
    const url = new URL(raw)
    if (url.protocol !== 'http:') throw new Error('Proxy Mail hiện hỗ trợ HTTP proxy.')
    if (!url.hostname || !url.port) throw new Error('Proxy URL phải có host và port.')
    return {
      raw,
      server: `http://${url.hostname}:${url.port}`,
      host: url.hostname,
      port: Number(url.port),
      username: url.username ? decodeURIComponent(url.username) : null,
      password: url.password ? decodeURIComponent(url.password) : null
    }
  }

  const parts = raw.split(':')
  if (parts.length < 2 || parts.length > 4) throw new Error('Proxy phải có dạng host:port hoặc host:port:user:pass.')
  const host = parts[0]?.trim() ?? ''
  const portText = parts[1]?.trim() ?? ''
  if (!host || !/^\d+$/.test(portText)) throw new Error('Proxy host/port không hợp lệ.')
  const port = Number(portText)
  if (port < 1 || port > 65535) throw new Error('Proxy port không hợp lệ.')
  return {
    raw,
    server: `http://${host}:${port}`,
    host,
    port,
    username: parts[2]?.trim() || null,
    password: parts[3]?.trim() || null
  }
}

function connectSocket(proxy: ParsedEmailProxy): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host: proxy.host, port: proxy.port })
    const timer = setTimeout(() => socket.destroy(new Error('Proxy connect timeout.')), 15_000)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function resolveExternalIpViaProxy(proxy: ParsedEmailProxy): Promise<string> {
  const socket = await connectSocket(proxy)
  const authorization = proxy.username
    ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64')}\r\n`
    : ''
  socket.write(
    `CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\n${authorization}Connection: keep-alive\r\n\r\n`
  )

  const responseHead = await new Promise<string>((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('Proxy CONNECT timeout.')), 15_000)
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('latin1')
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      clearTimeout(timer)
      socket.off('data', onData)
      resolve(buffer.slice(0, end + 4))
    }
    socket.on('data', onData)
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })

  if (!/^HTTP\/1\.[01] 200\b/.test(responseHead)) {
    socket.destroy()
    throw new Error(`Proxy CONNECT thất bại: ${responseHead.split('\r\n')[0] ?? 'unknown'}.`)
  }

  const secure = connectTls({ socket, servername: 'api.ipify.org' })
  const body = await new Promise<string>((resolve, reject) => {
    let response = ''
    const timer = setTimeout(() => secure.destroy(new Error('IP probe timeout.')), 15_000)
    secure.once('secureConnect', () => {
      secure.write('GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n')
    })
    secure.on('data', (chunk: Buffer) => { response += chunk.toString('utf8') })
    secure.once('end', () => {
      clearTimeout(timer)
      const separator = response.indexOf('\r\n\r\n')
      resolve(separator >= 0 ? response.slice(separator + 4) : response)
    })
    secure.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    throw new Error('IP probe trả dữ liệu không hợp lệ.')
  }
  const ip = parsed && typeof parsed === 'object' && 'ip' in parsed ? (parsed as { ip?: unknown }).ip : undefined
  if (typeof ip !== 'string' || !ip.trim()) throw new Error('IP probe không trả IP hợp lệ.')
  return ip.trim()
}

async function resolveExternalIp(proxy: ParsedEmailProxy | null): Promise<string> {
  if (proxy) return resolveExternalIpViaProxy(proxy)
  const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`IP probe HTTP ${response.status}.`)
  const body = await response.json() as { ip?: unknown }
  if (typeof body.ip !== 'string' || !body.ip.trim()) throw new Error('IP probe không trả IP hợp lệ.')
  return body.ip.trim()
}

export class EmailProxyPool {
  constructor(private readonly store: EmailProxySettingsStore) {}

  getCurrent(): ParsedEmailProxy | null {
    const settings = this.store.getSettings()
    if (settings.proxyMode === 'direct' || !settings.currentProxy) return null
    return parseEmailProxy(settings.currentProxy)
  }

  rotate(): HotmailProxyResult {
    const settings = this.store.getSettings()
    if (settings.proxyMode === 'direct') {
      this.store.setCurrentProxy(null)
      return {
        ok: true,
        mode: 'direct',
        currentProxy: null,
        externalIp: null,
        message: 'Proxy Mail đang ở Direct; không đổi IP pool.'
      }
    }

    const pool = settings.proxyList.map(normalizeProxyLine).filter((item): item is string => item !== null)
    if (pool.length === 0) {
      return {
        ok: false,
        mode: settings.proxyMode,
        currentProxy: settings.currentProxy,
        externalIp: null,
        message: 'Proxy pool chưa có IPv4/proxy nào.'
      }
    }

    const alternatives = pool.length > 1 && settings.currentProxy
      ? pool.filter((item) => item !== settings.currentProxy)
      : pool
    const index = Math.floor(Math.random() * alternatives.length)
    const selected = alternatives[index] ?? pool[0]
    if (!selected) throw new Error('Không thể chọn proxy từ pool.')
    parseEmailProxy(selected)
    this.store.setCurrentProxy(selected)
    return {
      ok: true,
      mode: settings.proxyMode,
      currentProxy: selected,
      externalIp: null,
      message: 'Đã chọn proxy mới cho phiên Email kế tiếp.'
    }
  }

  async test(): Promise<HotmailProxyResult> {
    const settings = this.store.getSettings()
    try {
      const current = settings.proxyMode === 'direct'
        ? null
        : settings.currentProxy
          ? parseEmailProxy(settings.currentProxy)
          : null
      if (settings.proxyMode === 'random_ipv4' && !current) {
        return {
          ok: false,
          mode: settings.proxyMode,
          currentProxy: null,
          externalIp: null,
          message: 'Chưa chọn proxy hiện tại. Hãy bấm Đổi IP trước.'
        }
      }
      const externalIp = await resolveExternalIp(current)
      return {
        ok: true,
        mode: settings.proxyMode,
        currentProxy: settings.currentProxy,
        externalIp,
        message: `Kết nối Email hoạt động; IP hiện tại ${externalIp}.`
      }
    } catch (error) {
      return {
        ok: false,
        mode: settings.proxyMode,
        currentProxy: settings.currentProxy,
        externalIp: null,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export function isEmailProxyMode(value: string): value is EmailProxyMode {
  return value === 'direct' || value === 'random_ipv4'
}
