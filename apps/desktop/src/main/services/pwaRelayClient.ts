import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PwaBridgeSnapshot } from '../../shared/pwaBridge'

export const PWA_RELAY_DEFAULT_BASE_URL = 'https://page-auto-pwa.vercel.app'
export const PWA_RELAY_DEFAULT_INTERVAL_MS = 5_000
const RELAY_CONFIG_VERSION = 1 as const
const DEVICE_ID_PATTERN = /^[a-f0-9]{32}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,96}$/

interface RelayCredentials {
  schemaVersion: typeof RELAY_CONFIG_VERSION
  deviceId: string
  deviceToken: string
}

export interface PwaRelayClientOptions {
  dataDirectory: string
  getSnapshot: () => PwaBridgeSnapshot
  relayBaseUrl?: string | null
  intervalMs?: number
  fetchImpl?: typeof fetch
  onError?: (message: string) => void
}

function normalizeRelayBaseUrl(input?: string | null): string {
  const candidate = input?.trim() || PWA_RELAY_DEFAULT_BASE_URL
  const url = new URL(candidate)
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('PWA relay URL phải dùng HTTPS (trừ localhost khi phát triển).')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function isRelayCredentials(value: unknown): value is RelayCredentials {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RelayCredentials>
  return candidate.schemaVersion === RELAY_CONFIG_VERSION
    && typeof candidate.deviceId === 'string'
    && DEVICE_ID_PATTERN.test(candidate.deviceId)
    && typeof candidate.deviceToken === 'string'
    && TOKEN_PATTERN.test(candidate.deviceToken)
}

function pairingCode(credentials: RelayCredentials): string {
  return Buffer.from(JSON.stringify({
    v: RELAY_CONFIG_VERSION,
    d: credentials.deviceId,
    t: credentials.deviceToken
  }), 'utf8').toString('base64url')
}

export class PwaRelayClient {
  private readonly relayBaseUrl: string
  private readonly intervalMs: number
  private readonly fetchImpl: typeof fetch
  private readonly onError: (message: string) => void
  private readonly relayDirectory: string
  private readonly credentialsPath: string
  private readonly pairingPath: string
  private credentialsPromise: Promise<RelayCredentials> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastErrorMessage: string | null = null

  constructor(private readonly options: PwaRelayClientOptions) {
    this.relayBaseUrl = normalizeRelayBaseUrl(options.relayBaseUrl)
    this.intervalMs = Math.max(2_000, options.intervalMs ?? PWA_RELAY_DEFAULT_INTERVAL_MS)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.onError = options.onError ?? (() => undefined)
    this.relayDirectory = join(options.dataDirectory, 'pwa-relay')
    this.credentialsPath = join(this.relayDirectory, 'credentials.json')
    this.pairingPath = join(this.relayDirectory, 'pairing.txt')
  }

  start(): void {
    if (this.timer) return
    void this.pushNow().catch((error) => this.reportError(error))
    this.timer = setInterval(() => {
      void this.pushNow().catch((error) => this.reportError(error))
    }, this.intervalMs)
    this.timer.unref?.()
  }

  dispose(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  getPairingFilePath(): string {
    return this.pairingPath
  }

  async getPairingCode(): Promise<string> {
    return pairingCode(await this.ensureCredentials())
  }

  async pushNow(): Promise<void> {
    const credentials = await this.ensureCredentials()
    const response = await this.fetchImpl(`${this.relayBaseUrl}/api/relay/push`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credentials.deviceToken}`,
        'Content-Type': 'application/json',
        'X-Page-Auto-Device-Id': credentials.deviceId
      },
      body: JSON.stringify({ snapshot: this.options.getSnapshot() })
    })
    if (!response.ok) throw new Error(`PWA relay HTTP ${response.status}`)
    this.lastErrorMessage = null
  }

  private async ensureCredentials(): Promise<RelayCredentials> {
    this.credentialsPromise ??= this.loadOrCreateCredentials()
    return this.credentialsPromise
  }

  private async loadOrCreateCredentials(): Promise<RelayCredentials> {
    await mkdir(this.relayDirectory, { recursive: true })
    let credentials: RelayCredentials | null = null
    try {
      const parsed = JSON.parse(await readFile(this.credentialsPath, 'utf8')) as unknown
      if (isRelayCredentials(parsed)) credentials = parsed
    } catch {
      credentials = null
    }

    if (!credentials) {
      credentials = {
        schemaVersion: RELAY_CONFIG_VERSION,
        deviceId: randomBytes(16).toString('hex'),
        deviceToken: randomBytes(32).toString('base64url')
      }
      await writeFile(this.credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    }

    const code = pairingCode(credentials)
    const pairingUrl = `${this.relayBaseUrl}/?pair=${encodeURIComponent(code)}`
    await writeFile(
      this.pairingPath,
      [
        'PAGE-AUTO PWA — mã ghép thiết bị',
        '',
        'Mở link này trên điện thoại để ghép PWA:',
        pairingUrl,
        '',
        'Hoặc nhập mã ghép:',
        code,
        '',
        'Không chia sẻ file/mã này cho người khác.'
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 }
    )
    return credentials
  }

  private reportError(error: unknown): void {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 240)
    if (message === this.lastErrorMessage) return
    this.lastErrorMessage = message
    this.onError(message)
  }
}
