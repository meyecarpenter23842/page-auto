import { isIP } from 'node:net'
import type { EmailProxyMode, HotmailProxyStatus } from '../../shared/hotmail'

export interface EmailProxySettingsRaw {
  mode: EmailProxyMode
  entries: string[]
}

export interface EmailProxyCandidate {
  server: string
  username?: string
  password?: string
  display: string
}

function normalizeScheme(value: string): string {
  const lower = value.toLowerCase()
  return ['http', 'https', 'socks4', 'socks5'].includes(lower) ? lower : 'http'
}

function parseHostPort(raw: string): { host: string; port: number } | null {
  const match = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/)
  if (!match) return null
  const host = match[1]
  const port = Number(match[2])
  if (!host || isIP(host) !== 4 || port < 1 || port > 65535) return null
  return { host, port }
}

export function parseEmailProxyLine(rawLine: string): EmailProxyCandidate | null {
  const raw = rawLine.trim()
  if (!raw) return null

  if (raw.includes('://')) {
    try {
      const url = new URL(raw)
      const scheme = normalizeScheme(url.protocol.replace(':', ''))
      const host = url.hostname
      const port = Number(url.port)
      if (isIP(host) !== 4 || !Number.isInteger(port) || port < 1 || port > 65535) return null
      const username = decodeURIComponent(url.username)
      const password = decodeURIComponent(url.password)
      const server = `${scheme}://${host}:${port}`
      return {
        server,
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
        display: server
      }
    } catch {
      return null
    }
  }

  const parts = raw.split(':')
  if (parts.length === 2) {
    const hostPort = parseHostPort(raw)
    if (!hostPort) return null
    const server = `http://${hostPort.host}:${hostPort.port}`
    return { server, display: server }
  }

  if (parts.length >= 4) {
    const host = parts[0]
    const port = Number(parts[1])
    if (!host || isIP(host) !== 4 || !Number.isInteger(port) || port < 1 || port > 65535) return null
    const username = parts[2] ?? ''
    const password = parts.slice(3).join(':')
    const server = `http://${host}:${port}`
    return {
      server,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      display: server
    }
  }

  return null
}

export function normalizeEmailProxyLines(rawText: string): string[] {
  const normalized = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const invalid = normalized.filter((line) => !parseEmailProxyLine(line))
  if (invalid.length > 0) {
    throw new Error(`Proxy Email chỉ nhận IPv4 dạng host:port, host:port:user:pass hoặc URL proxy. Có ${invalid.length} dòng không hợp lệ.`)
  }
  return [...new Set(normalized)]
}

export class EmailProxyPool {
  private readonly sessions = new Map<number, EmailProxyCandidate>()
  private preferredIndex = 0

  constructor(private readonly getSettings: () => EmailProxySettingsRaw) {}

  acquire(accountId: number): EmailProxyCandidate | null {
    const existing = this.sessions.get(accountId)
    if (existing) return existing

    const settings = this.getSettings()
    if (settings.mode === 'direct') return null
    const candidates = this.candidates(settings.entries)
    if (candidates.length === 0) throw new Error('Proxy Email đang ở Random IPv4 nhưng pool chưa có proxy hợp lệ.')

    const start = Math.min(this.preferredIndex, candidates.length - 1)
    const spread = Math.floor(Math.random() * candidates.length)
    const candidate = candidates[(start + spread) % candidates.length]
    if (!candidate) throw new Error('Không thể chọn proxy Email từ pool.')
    this.sessions.set(accountId, candidate)
    return candidate
  }

  release(accountId: number): void {
    this.sessions.delete(accountId)
  }

  rotate(): HotmailProxyStatus {
    const settings = this.getSettings()
    const candidates = this.candidates(settings.entries)
    if (settings.mode === 'direct') {
      return this.status('Direct mode không dùng proxy; không có IP để đổi.')
    }
    if (candidates.length === 0) {
      return this.status('Pool Random IPv4 đang trống.')
    }
    this.preferredIndex = (this.preferredIndex + 1) % candidates.length
    return this.status('Đã đổi proxy ưu tiên cho phiên Email kế tiếp. Browser đang chạy không bị đổi proxy giữa phiên.')
  }

  peek(): EmailProxyCandidate | null {
    const settings = this.getSettings()
    if (settings.mode === 'direct') return null
    const candidates = this.candidates(settings.entries)
    if (candidates.length === 0) return null
    return candidates[Math.min(this.preferredIndex, candidates.length - 1)] ?? null
  }

  status(message = 'Proxy Email là pool/global và không gắn cố định vào account Facebook.'): HotmailProxyStatus {
    const settings = this.getSettings()
    const candidates = this.candidates(settings.entries)
    return {
      mode: settings.mode,
      poolSize: candidates.length,
      currentProxy: settings.mode === 'direct' ? null : (this.peek()?.display ?? null),
      activeSessions: this.sessions.size,
      message
    }
  }

  private candidates(entries: string[]): EmailProxyCandidate[] {
    return entries.map(parseEmailProxyLine).filter((candidate): candidate is EmailProxyCandidate => candidate !== null)
  }
}
