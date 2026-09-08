import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PwaBridgeSnapshot, PwaGroupPostCommandResult } from '../../shared/pwaBridge'

export const PWA_REMOTE_COMMAND_DEFAULT_INTERVAL_MS = 1_000
const RELAY_CONFIG_VERSION = 1 as const
const DEVICE_ID_PATTERN = /^[a-f0-9]{32}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,96}$/

interface RelayCredentials {
  schemaVersion: typeof RELAY_CONFIG_VERSION
  deviceId: string
  deviceToken: string
}

export interface PwaRemoteCommandClientOptions {
  dataDirectory: string
  executeCommand: (command: unknown) => PwaGroupPostCommandResult
  getSnapshot: () => PwaBridgeSnapshot
  relayBaseUrl?: string | null
  intervalMs?: number
  fetchImpl?: typeof fetch
  onError?: (message: string) => void
}

function normalizeRelayBaseUrl(input?: string | null): string {
  const candidate = input?.trim() || 'https://page-auto-pwa.vercel.app'
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

export class PwaRemoteCommandClient {
  private readonly relayBaseUrl: string
  private readonly intervalMs: number
  private readonly fetchImpl: typeof fetch
  private readonly onError: (message: string) => void
  private readonly credentialsPath: string
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<void> | null = null
  private lastErrorMessage: string | null = null

  constructor(private readonly options: PwaRemoteCommandClientOptions) {
    this.relayBaseUrl = normalizeRelayBaseUrl(options.relayBaseUrl)
    this.intervalMs = Math.max(500, options.intervalMs ?? PWA_REMOTE_COMMAND_DEFAULT_INTERVAL_MS)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.onError = options.onError ?? (() => undefined)
    this.credentialsPath = join(options.dataDirectory, 'pwa-relay', 'credentials.json')
  }

  start(): void {
    if (this.timer) return
    void this.pollNow().catch((error) => this.reportError(error))
    this.timer = setInterval(() => {
      void this.pollNow().catch((error) => this.reportError(error))
    }, this.intervalMs)
    this.timer.unref?.()
  }

  dispose(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async pollNow(): Promise<void> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.pollOnce().finally(() => { this.inFlight = null })
    return this.inFlight
  }

  private async pollOnce(): Promise<void> {
    const credentials = await this.loadCredentials()
    if (!credentials) return
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${credentials.deviceToken}`,
      'Content-Type': 'application/json',
      'X-Page-Auto-Device-Id': credentials.deviceId
    }
    const response = await this.fetchImpl(`${this.relayBaseUrl}/api/relay/command`, {
      method: 'GET',
      cache: 'no-store',
      headers
    })
    if (response.status === 204) {
      this.lastErrorMessage = null
      return
    }
    if (!response.ok) throw new Error(`PWA remote command HTTP ${response.status}`)

    const payload = await response.json() as { command?: unknown }
    if (!('command' in payload)) throw new Error('PWA remote command response không hợp lệ.')
    const result = this.options.executeCommand(payload.command)
    const ack = { result, snapshot: this.options.getSnapshot() }
    const resultResponse = await this.fetchImpl(`${this.relayBaseUrl}/api/relay/result`, {
      method: 'POST',
      cache: 'no-store',
      headers,
      body: JSON.stringify(ack)
    })
    if (!resultResponse.ok) throw new Error(`PWA remote result HTTP ${resultResponse.status}`)
    this.lastErrorMessage = null
  }

  private async loadCredentials(): Promise<RelayCredentials | null> {
    try {
      const parsed = JSON.parse(await readFile(this.credentialsPath, 'utf8')) as unknown
      if (!isRelayCredentials(parsed)) throw new Error('PWA relay credentials không hợp lệ.')
      return parsed
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
      if (code === 'ENOENT') return null
      throw error
    }
  }

  private reportError(error: unknown): void {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 240)
    if (message === this.lastErrorMessage) return
    this.lastErrorMessage = message
    this.onError(message)
  }
}
