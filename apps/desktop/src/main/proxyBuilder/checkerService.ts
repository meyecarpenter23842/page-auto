import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createConnection, isIP, type Socket } from 'node:net'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import type {
  ProxyBuilderCheckerResult,
  ProxyBuilderCheckerSnapshot,
  ProxyBuilderCheckerStartInput,
  ProxyBuilderRunIdPayload
} from '../../shared/proxyBuilder'

const TARGET_HOST = 'api64.ipify.org'
const TARGET_PORT = 443
const MAX_PROXY_COUNT = 10_000
const MAX_HEADER_BYTES = 32 * 1024
const MAX_RESPONSE_BYTES = 128 * 1024
const DEFAULT_CONCURRENCY = 20
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_RETRIES = 1

interface ParsedProxy {
  host: string
  port: number
  username: string | null
  password: string | null
  maskedProxy: string
}

interface CheckTask {
  index: number
  endpoint: ParsedProxy
}

interface ActiveChecker {
  runId: string
  cancelled: boolean
  sockets: Set<Socket>
}

class CheckerError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
  }
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value as number)))
}

function normalizeHostForDisplay(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}

function validatePort(value: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CheckerError('Port proxy không hợp lệ.', false)
  return port
}

export function parseProxyLine(rawLine: string): ParsedProxy {
  const line = rawLine.trim()
  if (!line) throw new CheckerError('Dòng proxy trống.', false)

  if (/^https?:\/\//i.test(line)) {
    let parsed: URL
    try { parsed = new URL(line) } catch { throw new CheckerError('URL proxy không hợp lệ.', false) }
    if (parsed.protocol !== 'http:') throw new CheckerError('Checker hiện hỗ trợ HTTP proxy/HTTPS CONNECT.', false)
    if (!parsed.hostname || !parsed.port) throw new CheckerError('URL proxy thiếu host hoặc port.', false)
    const port = validatePort(parsed.port)
    const host = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']') ? parsed.hostname.slice(1, -1) : parsed.hostname
    const username = parsed.username ? decodeURIComponent(parsed.username) : null
    const password = parsed.password ? decodeURIComponent(parsed.password) : null
    if ((username && !password) || (!username && password)) throw new CheckerError('Proxy auth phải có đủ user và password.', false)
    return {
      host,
      port,
      username,
      password,
      maskedProxy: `${normalizeHostForDisplay(host)}:${port}${username ? `:${username}:••••` : ''}`
    }
  }

  if (line.startsWith('[')) {
    const closing = line.indexOf(']')
    if (closing < 0 || line[closing + 1] !== ':') throw new CheckerError('IPv6 proxy host phải có dạng [IPv6]:port.', false)
    const host = line.slice(1, closing)
    const remainder = line.slice(closing + 2)
    const parts = remainder.split(':')
    if (parts.length !== 1 && parts.length < 3) throw new CheckerError('Proxy auth phải có đủ user và password.', false)
    const port = validatePort(parts[0] ?? '')
    const username = parts.length >= 3 ? (parts[1] ?? '') : null
    const password = parts.length >= 3 ? parts.slice(2).join(':') : null
    if (isIP(host) !== 6) throw new CheckerError('IPv6 proxy host không hợp lệ.', false)
    if (username !== null && (!username || !password)) throw new CheckerError('Proxy auth phải có đủ user và password.', false)
    return { host, port, username, password, maskedProxy: `[${host}]:${port}${username ? `:${username}:••••` : ''}` }
  }

  const parts = line.split(':')
  if (parts.length !== 2 && parts.length < 4) {
    if (parts.length > 4) throw new CheckerError('IPv6 proxy host phải đặt trong dấu [ ].', false)
    throw new CheckerError('Proxy phải có dạng host:port hoặc host:port:user:pass.', false)
  }
  const host = parts[0]?.trim() ?? ''
  if (!host || /\s/.test(host)) throw new CheckerError('Host proxy không hợp lệ.', false)
  const port = validatePort(parts[1] ?? '')
  const username = parts.length >= 4 ? (parts[2] ?? '') : null
  const password = parts.length >= 4 ? parts.slice(3).join(':') : null
  if (username !== null && (!username || !password)) throw new CheckerError('Proxy auth phải có đủ user và password.', false)
  return { host, port, username, password, maskedProxy: `${host}:${port}${username ? `:${username}:••••` : ''}` }
}

function cloneSnapshot(snapshot: ProxyBuilderCheckerSnapshot): ProxyBuilderCheckerSnapshot {
  return { ...snapshot, results: snapshot.results.map((item) => ({ ...item })) }
}

function safeNetworkError(error: unknown): CheckerError {
  if (error instanceof CheckerError) return error
  const candidate = error as { code?: string; message?: string }
  const code = candidate?.code ?? ''
  if (code === 'ETIMEDOUT') return new CheckerError('Timeout khi kết nối proxy.', true)
  if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'].includes(code)) {
    return new CheckerError(code ? `Kết nối proxy lỗi (${code}).` : 'Không kết nối được proxy.', true)
  }
  return new CheckerError('Request qua proxy thất bại.', true)
}

function waitForTcp(endpoint: ParsedProxy, active: ActiveChecker, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (active.cancelled) { reject(new CheckerError('Đã hủy.', false)); return }
    const socket = createConnection({ host: endpoint.host, port: endpoint.port })
    active.sockets.add(socket)
    let settled = false
    const timer = setTimeout(() => fail(new CheckerError('Timeout khi kết nối proxy.', true)), timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('error', failRaw)
      socket.off('connect', connected)
    }
    const finish = (error?: CheckerError) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        active.sockets.delete(socket)
        socket.destroy()
        reject(error)
      } else resolve(socket)
    }
    const fail = (error: CheckerError) => finish(error)
    const failRaw = (error: Error) => finish(safeNetworkError(error))
    const connected = () => finish()
    socket.once('error', failRaw)
    socket.once('connect', connected)
  })
}

function readUntil(socket: Socket, marker: string, maxBytes: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0)
    let settled = false
    const timer = setTimeout(() => finish(new CheckerError('Timeout chờ phản hồi proxy.', true)), timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    const finish = (error?: CheckerError, value?: string) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(value ?? '')
    }
    const onData = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk])
      if (data.length > maxBytes) { finish(new CheckerError('Phản hồi proxy quá lớn.', false)); return }
      const text = data.toString('latin1')
      const index = text.indexOf(marker)
      if (index < 0) return
      const end = index + marker.length
      const rest = data.subarray(end)
      if (rest.length) socket.unshift(rest)
      finish(undefined, data.subarray(0, end).toString('latin1'))
    }
    const onError = (error: Error) => finish(safeNetworkError(error))
    const onClose = () => finish(new CheckerError('Proxy đóng kết nối trước khi phản hồi.', true))
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

async function establishTunnel(endpoint: ParsedProxy, active: ActiveChecker, timeoutMs: number): Promise<Socket> {
  const socket = await waitForTcp(endpoint, active, timeoutMs)
  const auth = endpoint.username && endpoint.password
    ? `Proxy-Authorization: Basic ${Buffer.from(`${endpoint.username}:${endpoint.password}`, 'utf8').toString('base64')}\r\n`
    : ''
  socket.write(
    `CONNECT ${TARGET_HOST}:${TARGET_PORT} HTTP/1.1\r\nHost: ${TARGET_HOST}:${TARGET_PORT}\r\n` +
    auth +
    'Proxy-Connection: keep-alive\r\nConnection: keep-alive\r\n\r\n'
  )
  try {
    const header = await readUntil(socket, '\r\n\r\n', MAX_HEADER_BYTES, timeoutMs)
    const match = header.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i)
    const status = match ? Number(match[1]) : 0
    if (status === 407) throw new CheckerError('Proxy từ chối user/password (407).', false)
    if (status !== 200) throw new CheckerError(status ? `Proxy CONNECT trả HTTP ${status}.` : 'Phản hồi CONNECT không hợp lệ.', status >= 500)
    return socket
  } catch (error) {
    active.sockets.delete(socket)
    socket.destroy()
    throw error
  }
}

function openTls(tunnel: Socket, active: ActiveChecker, timeoutMs: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    if (active.cancelled) { reject(new CheckerError('Đã hủy.', false)); return }
    const secure = connectTls({ socket: tunnel, servername: TARGET_HOST, rejectUnauthorized: true })
    active.sockets.add(secure)
    let settled = false
    const timer = setTimeout(() => finish(new CheckerError('Timeout TLS qua proxy.', true)), timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      secure.off('secureConnect', connected)
      secure.off('error', failed)
    }
    const finish = (error?: CheckerError) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        active.sockets.delete(secure)
        secure.destroy()
        reject(error)
      } else resolve(secure)
    }
    const connected = () => finish()
    const failed = (error: Error) => finish(safeNetworkError(error))
    secure.once('secureConnect', connected)
    secure.once('error', failed)
  })
}

function decodeChunked(body: string): string {
  let cursor = 0
  let output = ''
  while (cursor < body.length) {
    const lineEnd = body.indexOf('\r\n', cursor)
    if (lineEnd < 0) return body
    const size = Number.parseInt(body.slice(cursor, lineEnd).split(';')[0] ?? '', 16)
    if (!Number.isFinite(size)) return body
    if (size === 0) return output
    const start = lineEnd + 2
    output += body.slice(start, start + size)
    cursor = start + size + 2
  }
  return output
}

function readHttpsResponse(socket: TLSSocket, active: ActiveChecker, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0)
    let settled = false
    const timer = setTimeout(() => finish(new CheckerError('Timeout chờ outbound IP.', true)), timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('end', onEnd)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    const finish = (error?: CheckerError, value?: string) => {
      if (settled) return
      settled = true
      cleanup()
      active.sockets.delete(socket)
      socket.destroy()
      if (error) reject(error)
      else resolve(value ?? '')
    }
    const onData = (chunk: Buffer) => {
      response = Buffer.concat([response, chunk])
      if (response.length > MAX_RESPONSE_BYTES) finish(new CheckerError('Phản hồi kiểm tra quá lớn.', false))
    }
    const parse = () => {
      const raw = response.toString('utf8')
      const split = raw.indexOf('\r\n\r\n')
      if (split < 0) { finish(new CheckerError('HTTPS response không hợp lệ.', true)); return }
      const head = raw.slice(0, split)
      const status = Number(head.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i)?.[1] ?? 0)
      if (status !== 200) { finish(new CheckerError(status ? `IP service trả HTTP ${status}.` : 'HTTPS response không hợp lệ.', true)); return }
      let body = raw.slice(split + 4)
      if (/transfer-encoding:\s*chunked/i.test(head)) body = decodeChunked(body)
      const ip = body.trim()
      if (!isIP(ip)) { finish(new CheckerError('Không đọc được outbound IP hợp lệ.', true)); return }
      finish(undefined, ip)
    }
    const onEnd = () => parse()
    const onError = (error: Error) => finish(safeNetworkError(error))
    const onClose = () => {
      if (!settled && response.length) parse()
      else if (!settled) finish(new CheckerError('HTTPS tunnel đóng sớm.', true))
    }
    socket.on('data', onData)
    socket.once('end', onEnd)
    socket.once('error', onError)
    socket.once('close', onClose)
    socket.write(`GET / HTTP/1.1\r\nHost: ${TARGET_HOST}\r\nUser-Agent: PageAuto-ProxyChecker/1\r\nAccept: text/plain\r\nConnection: close\r\n\r\n`)
  })
}

async function checkOnce(endpoint: ParsedProxy, active: ActiveChecker, timeoutMs: number): Promise<{ outboundIp: string; latencyMs: number }> {
  const started = Date.now()
  const tunnel = await establishTunnel(endpoint, active, timeoutMs)
  try {
    const secure = await openTls(tunnel, active, timeoutMs)
    const outboundIp = await readHttpsResponse(secure, active, timeoutMs)
    return { outboundIp, latencyMs: Date.now() - started }
  } finally {
    active.sockets.delete(tunnel)
    if (!tunnel.destroyed) tunnel.destroy()
  }
}

async function checkWithRetry(endpoint: ParsedProxy, active: ActiveChecker, timeoutMs: number, retries: number): Promise<{ outboundIp: string; latencyMs: number }> {
  let lastError: CheckerError | null = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (active.cancelled) throw new CheckerError('Đã hủy.', false)
    try { return await checkOnce(endpoint, active, timeoutMs) }
    catch (error) {
      lastError = safeNetworkError(error)
      if (!lastError.retryable || attempt === retries) throw lastError
    }
  }
  throw lastError ?? new CheckerError('Proxy check thất bại.', false)
}

export class ProxyBuilderCheckerService {
  private readonly runs = new Map<string, ProxyBuilderCheckerSnapshot>()
  private active: ActiveChecker | null = null

  start(input: ProxyBuilderCheckerStartInput): ProxyBuilderCheckerSnapshot {
    if (this.active) throw new Error('Đang có một phiên Proxy Checker chạy.')
    const lines = input.proxies.map((value) => value.trim()).filter(Boolean)
    if (!lines.length) throw new Error('Chưa có proxy để kiểm tra.')
    if (lines.length > MAX_PROXY_COUNT) throw new Error(`Tối đa ${MAX_PROXY_COUNT} proxy mỗi phiên kiểm tra.`)

    const runId = randomUUID()
    const now = new Date().toISOString()
    const tasks: CheckTask[] = []
    const results: ProxyBuilderCheckerResult[] = lines.map((line, index) => {
      try {
        const endpoint = parseProxyLine(line)
        tasks.push({ index, endpoint })
        return { index, maskedProxy: endpoint.maskedProxy, status: 'pending', outboundIp: null, type: null, latencyMs: null, error: null }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Proxy không hợp lệ.'
        return { index, maskedProxy: 'Proxy không hợp lệ', status: 'dead', outboundIp: null, type: null, latencyMs: null, error: message }
      }
    })

    const dead = results.filter((item) => item.status === 'dead').length
    const snapshot: ProxyBuilderCheckerSnapshot = {
      runId,
      status: 'running',
      total: results.length,
      completed: dead,
      live: 0,
      dead,
      createdAt: now,
      updatedAt: now,
      results
    }
    this.runs.set(runId, snapshot)
    this.active = { runId, cancelled: false, sockets: new Set() }

    const concurrency = clamp(input.concurrency, 1, 100, DEFAULT_CONCURRENCY)
    const timeoutMs = clamp(input.timeoutMs, 3_000, 60_000, DEFAULT_TIMEOUT_MS)
    const retries = clamp(input.retries, 0, 2, DEFAULT_RETRIES)
    void this.execute(runId, tasks, concurrency, timeoutMs, retries)
    return cloneSnapshot(snapshot)
  }

  status(payload: ProxyBuilderRunIdPayload): ProxyBuilderCheckerSnapshot | null {
    const snapshot = this.runs.get(payload.runId)
    return snapshot ? cloneSnapshot(snapshot) : null
  }

  cancel(payload: ProxyBuilderRunIdPayload): ProxyBuilderCheckerSnapshot | null {
    const snapshot = this.runs.get(payload.runId)
    if (!snapshot) return null
    if (snapshot.status !== 'running') return cloneSnapshot(snapshot)
    if (this.active?.runId === payload.runId) {
      this.active.cancelled = true
      for (const socket of this.active.sockets) socket.destroy()
      this.active.sockets.clear()
      snapshot.status = 'cancelled'
      snapshot.updatedAt = new Date().toISOString()
    }
    return cloneSnapshot(snapshot)
  }

  dispose(): void {
    if (!this.active) return
    this.active.cancelled = true
    for (const socket of this.active.sockets) socket.destroy()
    this.active.sockets.clear()
    this.active = null
  }

  private async execute(runId: string, tasks: CheckTask[], concurrency: number, timeoutMs: number, retries: number): Promise<void> {
    const active = this.active
    const snapshot = this.runs.get(runId)
    if (!active || !snapshot) return
    let cursor = 0

    const worker = async () => {
      while (!active.cancelled) {
        const taskIndex = cursor
        cursor += 1
        if (taskIndex >= tasks.length) return
        const task = tasks[taskIndex]
        if (!task) return
        let next: ProxyBuilderCheckerResult
        try {
          const checked = await checkWithRetry(task.endpoint, active, timeoutMs, retries)
          next = {
            index: task.index,
            maskedProxy: task.endpoint.maskedProxy,
            status: 'live',
            outboundIp: checked.outboundIp,
            type: isIP(checked.outboundIp) === 6 ? 'ipv6' : 'ipv4',
            latencyMs: checked.latencyMs,
            error: null
          }
        } catch (error) {
          if (active.cancelled) return
          const safe = safeNetworkError(error)
          next = {
            index: task.index,
            maskedProxy: task.endpoint.maskedProxy,
            status: 'dead',
            outboundIp: null,
            type: null,
            latencyMs: null,
            error: safe.message
          }
        }
        snapshot.results[task.index] = next
        snapshot.completed += 1
        if (next.status === 'live') snapshot.live += 1
        else snapshot.dead += 1
        snapshot.updatedAt = new Date().toISOString()
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, tasks.length)) }, () => worker()))
    if (!active.cancelled) {
      snapshot.status = 'completed'
      snapshot.updatedAt = new Date().toISOString()
    }
    if (this.active?.runId === runId) this.active = null
  }
}
