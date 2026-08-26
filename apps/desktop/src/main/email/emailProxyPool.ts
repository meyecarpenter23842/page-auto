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
  /** Internal identity only. Never expose or log this value because it can include credentials. */
  key: string
}

interface EmailProxyHealth {
  failCount: number
  cooldownUntil: number
}

const BASE_PROXY_COOLDOWN_MS = 30_000
const MAX_PROXY_COOLDOWN_MS = 5 * 60_000

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

function candidateKey(server: string, username: string, password: string): string {
  return `${server}\u0000${username}\u0000${password}`
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
        display: server,
        key: candidateKey(server, username, password)
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
    return { server, display: server, key: candidateKey(server, '', '') }
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
      display: server,
      key: candidateKey(server, username, password)
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
  private readonly health = new Map<string, EmailProxyHealth>()
  private preferredIndex = 0

  constructor(
    private readonly getSettings: () => EmailProxySettingsRaw,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random
  ) {}

  acquire(accountId: number): EmailProxyCandidate | null {
    const existing = this.sessions.get(accountId)
    if (existing) return existing

    const settings = this.getSettings()
    if (settings.mode === 'direct') return null
    const candidates = this.candidates(settings.entries)
    if (candidates.length === 0) throw new Error('Proxy Email đang ở Random IPv4 nhưng pool chưa có proxy hợp lệ.')

    const available = this.orderedCandidates(candidates).filter((candidate) => !this.isCoolingDown(candidate))
    if (available.length === 0) {
      throw new Error('Tất cả proxy Email đang cooldown sau lần kiểm tra lỗi. Hãy thử lại sau hoặc kiểm tra/đổi pool.')
    }

    const sample = Math.max(0, Math.min(0.999999, this.random()))
    const candidate = available[Math.floor(sample * available.length)]
    if (!candidate) throw new Error('Không thể chọn proxy Email từ pool.')
    this.sessions.set(accountId, candidate)
    return candidate
  }

  assignment(accountId: number): EmailProxyCandidate | null {
    return this.sessions.get(accountId) ?? null
  }

  release(accountId: number): void {
    this.sessions.delete(accountId)
  }

  recordFailure(candidate: EmailProxyCandidate): void {
    const current = this.health.get(candidate.key) ?? { failCount: 0, cooldownUntil: 0 }
    const failCount = current.failCount + 1
    const cooldownMs = Math.min(MAX_PROXY_COOLDOWN_MS, BASE_PROXY_COOLDOWN_MS * (2 ** Math.min(4, failCount - 1)))
    this.health.set(candidate.key, { failCount, cooldownUntil: this.now() + cooldownMs })
  }

  recordSuccess(candidate: EmailProxyCandidate): void {
    this.health.delete(candidate.key)
  }

  cooldownCount(): number {
    return this.candidates(this.getSettings().entries).filter((candidate) => this.isCoolingDown(candidate)).length
  }

  rotate(): HotmailProxyStatus {
    const settings = this.getSettings()
    const candidates = this.candidates(settings.entries)
    if (settings.mode === 'direct') {
      return this.status('Direct mode áp dụng cho phiên Email mới; browser đang mở giữ nguyên network hiện tại.')
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
    return this.orderedCandidates(candidates).find((candidate) => !this.isCoolingDown(candidate)) ?? null
  }

  status(message?: string): HotmailProxyStatus {
    const settings = this.getSettings()
    const candidates = this.candidates(settings.entries)
    const cooldownCount = candidates.filter((candidate) => this.isCoolingDown(candidate)).length
    const assignments = [...this.sessions.entries()]
      .map(([accountId, candidate]) => `#${accountId} → ${candidate.display}`)
      .sort()
    const assignmentSummary = assignments.length > 0 ? assignments.join(' · ') : 'chưa có phiên giữ proxy'
    const effectiveMessage = message
      ?? `Proxy Email tách riêng Facebook; ${assignmentSummary}${cooldownCount > 0 ? ` · ${cooldownCount} proxy cooldown` : ''}.`
    return {
      mode: settings.mode,
      poolSize: candidates.length,
      currentProxy: settings.mode === 'direct' ? null : (this.peek()?.display ?? null),
      activeSessions: this.sessions.size,
      message: effectiveMessage
    }
  }

  private isCoolingDown(candidate: EmailProxyCandidate): boolean {
    return (this.health.get(candidate.key)?.cooldownUntil ?? 0) > this.now()
  }

  private orderedCandidates(candidates: EmailProxyCandidate[]): EmailProxyCandidate[] {
    if (candidates.length === 0) return []
    const start = ((this.preferredIndex % candidates.length) + candidates.length) % candidates.length
    return [...candidates.slice(start), ...candidates.slice(0, start)]
  }

  private candidates(entries: string[]): EmailProxyCandidate[] {
    return entries.map(parseEmailProxyLine).filter((candidate): candidate is EmailProxyCandidate => candidate !== null)
  }
}
