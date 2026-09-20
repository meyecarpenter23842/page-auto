import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type {
  ProxyBuilderProvisionInput,
  ProxyBuilderProvisionPhase,
  ProxyBuilderProvisionSnapshot,
  ProxyBuilderProxyAuth,
  ProxyBuilderProxyResult,
  ProxyBuilderRunIdPayload,
  ProxyBuilderRuntimeControlInput,
  ProxyBuilderRuntimeControlResult
} from '../../shared/proxyBuilder'

import { PROXY_RUNTIME_PY, PROXY_RESTORE_PY, PROXY_PROVISIONER_PY, PROXY_SYSTEMD_SERVICE } from './remoteAssets'
import { applyProxyBuilderSshAuth } from './sshAuth'
import { runNativeOpenSsh, shouldUseNativeOpenSsh } from './nativeOpenSsh'
import { checkProxyLineNow } from './checkerService'
import { ensureOciSecurityListIngress, resolveOciConfigPath } from './ociCloudFirewallService'

const PROVISION_TIMEOUT_MS = 15 * 60_000
const COMMAND_TIMEOUT_MS = 60_000
const EXTERNAL_VERIFY_TIMEOUT_MS = 12_000
const EXTERNAL_VERIFY_CONCURRENCY = 100

interface CommandResult { stdout: string; stderr: string; code: number }
interface SshSessionLike {
  connect(config: ConnectConfig): Promise<void>
  exec(command: string, timeoutMs?: number, onLine?: (line: string) => void): Promise<CommandResult>
  writeFile(path: string, content: string, mode: number): Promise<void>
  cancel(): void
  end(): void
}
interface ActiveRun { runId: string; session: SshSessionLike | null; cancelRequested: boolean }
interface RemoteProvisionResult {
  listenHost: string
  authMode: 'none' | 'basic'
  username: string | null
  mappings: Array<{ port: number; type: 'ipv4' | 'ipv6'; source_ip: string; outbound_ip?: string }>
  firewall?: {
    backend: 'ufw' | 'firewalld' | 'nftables' | 'iptables' | 'none'
    driver: string
    start_port: number
    end_port: number
    marker: string
  }
  cloud?: {
    provider: 'oci'
    region: string
    vnicId: string
  } | null
}

interface ExternalProxyVerification {
  results: ProxyBuilderProxyResult[]
  errors: string[]
}

function cloneSnapshot(snapshot: ProxyBuilderProvisionSnapshot): ProxyBuilderProvisionSnapshot {
  return { ...snapshot, results: snapshot.results.map((item) => ({ ...item })) }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function validateInput(input: ProxyBuilderProvisionInput): string | null {
  if (!input.host.trim() || !/^[a-zA-Z0-9._:[\]-]+$/.test(input.host.trim())) return 'VPS IP / Host không hợp lệ.'
  if (!input.username.trim() || !/^[a-zA-Z0-9._-]+$/.test(input.username.trim())) return 'SSH User không hợp lệ.'
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 10000) return 'Số lượng proxy phải nằm trong 1-10000.'
  if (!Number.isInteger(input.startPort) || input.startPort < 1 || input.startPort > 65535) return 'Start Port phải nằm trong 1-65535.'
  if (input.startPort + input.count - 1 > 65535) return 'Dải port vượt quá 65535.'
  if (input.ipMode === 'both' && input.count < 2) return 'IPv4 + IPv6 cần tối thiểu 2 proxy.'
  if (input.auth.type === 'password' && !input.auth.password) return 'Chưa nhập SSH Password.'
  if (input.auth.type === 'key' && !input.auth.privateKey.trim() && !input.auth.privateKeyPath?.trim()) return 'Chưa nhập hoặc chọn SSH Private Key.'
  if (input.proxyAuth.type === 'basic') {
    if (!input.proxyAuth.username.trim() || input.proxyAuth.username.includes(':') || /[\r\n]/.test(input.proxyAuth.username)) return 'Proxy User không hợp lệ.'
    if (!input.proxyAuth.password || /[\r\n]/.test(input.proxyAuth.password)) return 'Proxy Password không hợp lệ.'
  }
  return null
}

function connectConfig(input: Pick<ProxyBuilderProvisionInput, 'host' | 'username' | 'auth'>): ConnectConfig {
  const config: ConnectConfig = {
    host: input.host.trim().replace(/^\[|\]$/g, ''),
    port: 22,
    username: input.username.trim(),
    readyTimeout: 15_000,
    keepaliveInterval: 5_000,
    keepaliveCountMax: 2
  }
  applyProxyBuilderSshAuth(config, input.auth)
  return config
}

class Ssh2Session implements SshSessionLike {
  private readonly client = new Client()
  private sftp: SFTPWrapper | null = null
  private currentChannel: ClientChannel | null = null

  async connect(config: ConnectConfig): Promise<void> {
    const password = config.tryKeyboard && typeof config.password === 'string' ? config.password : null
    if (password !== null) {
      this.client.on('keyboard-interactive', (_name, _instructions, _instructionsLang, prompts, finish) => {
        finish(prompts.map(() => password))
      })
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const done = (error?: Error) => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve()
      }
      this.client.once('ready', () => done())
      this.client.once('error', (error) => done(error))
      try { this.client.connect(config) } catch (error) { done(error instanceof Error ? error : new Error(String(error))) }
    })
  }

  async exec(command: string, timeoutMs: number = COMMAND_TIMEOUT_MS, onLine?: (line: string) => void): Promise<CommandResult> {
    return await new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        try { this.currentChannel?.signal('TERM') } catch { /* ignore */ }
        reject(new Error('SSH command timeout.'))
      }, timeoutMs)
      this.client.exec(command, (error, stream) => {
        if (error) { clearTimeout(timer); reject(error); return }
        this.currentChannel = stream
        let stdout = ''
        let stderr = ''
        let lineBuffer = ''
        stream.on('data', (chunk: Buffer | string) => {
          const text = chunk.toString()
          stdout += text
          if (onLine) {
            lineBuffer += text
            const lines = lineBuffer.split(/\r?\n/)
            lineBuffer = lines.pop() ?? ''
            for (const line of lines) onLine(line)
          }
        })
        stream.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString() })
        stream.on('close', (code: number | undefined) => {
          clearTimeout(timer)
          this.currentChannel = null
          if (onLine && lineBuffer) onLine(lineBuffer)
          resolve({ stdout, stderr, code: code ?? 0 })
        })
      })
    })
  }

  async writeFile(path: string, content: string, mode: number): Promise<void> {
    const sftp = await this.getSftp()
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(path, content, { mode }, (error) => error ? reject(error) : resolve())
    })
  }

  cancel(): void {
    try { this.currentChannel?.signal('TERM') } catch { /* ignore */ }
  }

  end(): void {
    try { this.sftp?.end() } catch { /* ignore */ }
    this.client.end()
  }

  private async getSftp(): Promise<SFTPWrapper> {
    if (this.sftp) return this.sftp
    this.sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      this.client.sftp((error, sftp) => error ? reject(error) : resolve(sftp))
    })
    return this.sftp
  }
}


class NativeOpenSshSession implements SshSessionLike {
  private currentProcess: ChildProcessWithoutNullStreams | null = null

  constructor(private readonly input: Pick<ProxyBuilderProvisionInput, 'host' | 'username' | 'auth'>) {}

  async connect(_config: ConnectConfig): Promise<void> {
    const result = await runNativeOpenSsh(this.input, 'true', {
      timeoutMs: 20_000,
      onChild: (child) => { this.currentProcess = child }
    })
    if (result.code !== 0) throw new Error((result.stderr || result.stdout || 'Windows OpenSSH authentication failed.').trim())
  }

  async exec(command: string, timeoutMs: number = COMMAND_TIMEOUT_MS, onLine?: (line: string) => void): Promise<CommandResult> {
    return await runNativeOpenSsh(this.input, command, {
      timeoutMs,
      ...(onLine ? { onLine } : {}),
      onChild: (child) => { this.currentProcess = child }
    })
  }

  async writeFile(path: string, content: string, mode: number): Promise<void> {
    const command = `umask 077; cat > ${shellQuote(path)} && chmod ${mode.toString(8)} ${shellQuote(path)}`
    const result = await runNativeOpenSsh(this.input, command, {
      stdin: content,
      timeoutMs: COMMAND_TIMEOUT_MS,
      onChild: (child) => { this.currentProcess = child }
    })
    if (result.code !== 0) throw new Error((result.stderr || result.stdout || `Không ghi được file ${path} qua Windows OpenSSH.`).trim())
  }

  cancel(): void {
    try { this.currentProcess?.kill() } catch { /* ignore */ }
  }

  end(): void {
    this.currentProcess = null
  }
}

function createSshSession(input: Pick<ProxyBuilderProvisionInput, 'host' | 'username' | 'auth'>): SshSessionLike {
  return shouldUseNativeOpenSsh(input.auth) ? new NativeOpenSshSession(input) : new Ssh2Session()
}

function parseProgress(line: string): { phase: ProxyBuilderProvisionPhase; percent: number; message: string } | null {
  if (!line.startsWith('PA_PROGRESS=')) return null
  const [phase, percentText, ...messageParts] = line.slice('PA_PROGRESS='.length).split('|')
  const percent = Number(percentText)
  if (!phase || !Number.isFinite(percent)) return null
  const allowed: ProxyBuilderProvisionPhase[] = ['connecting', 'preflight', 'provisioning', 'service', 'self_test', 'complete', 'rollback']
  if (!allowed.includes(phase as ProxyBuilderProvisionPhase)) return null
  return { phase: phase as ProxyBuilderProvisionPhase, percent: Math.max(0, Math.min(100, percent)), message: messageParts.join('|') || phase }
}

function parseProvisionResult(stdout: string): RemoteProvisionResult {
  const marker = stdout.split(/\r?\n/).find((line) => line.startsWith('PA_RESULT_JSON='))
  if (!marker) throw new Error('Provision VPS hoàn tất nhưng không trả manifest kết quả.')
  const decoded = Buffer.from(marker.slice('PA_RESULT_JSON='.length), 'base64').toString('utf8')
  return JSON.parse(decoded) as RemoteProvisionResult
}

function toProxyResults(remote: RemoteProvisionResult): ProxyBuilderProxyResult[] {
  return remote.mappings.map((mapping) => ({
    id: `${mapping.type}:${mapping.port}:${mapping.source_ip}`,
    listenHost: remote.listenHost,
    port: mapping.port,
    type: mapping.type,
    outboundIp: mapping.outbound_ip ?? mapping.source_ip,
    status: 'ready',
    authMode: remote.authMode,
    username: remote.username
  }))
}

function externalProxyLine(item: ProxyBuilderProxyResult, auth: ProxyBuilderProxyAuth): string {
  const host = item.listenHost.includes(':') ? '[' + item.listenHost + ']' : item.listenHost
  if (auth.type !== 'basic') return host + ':' + item.port
  return host + ':' + item.port + ':' + auth.username + ':' + auth.password
}

async function verifyProvisionedProxies(
  remote: RemoteProvisionResult,
  auth: ProxyBuilderProxyAuth
): Promise<ExternalProxyVerification> {
  const results = toProxyResults(remote)
  const errors = Array.from({ length: results.length }, () => '')
  let cursor = 0

  const worker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      const item = results[index]
      if (!item) return
      const checked = await checkProxyLineNow(externalProxyLine(item, auth), EXTERNAL_VERIFY_TIMEOUT_MS, 0)
      results[index] = checked.live
        ? { ...item, status: 'ready', outboundIp: checked.outboundIp ?? item.outboundIp }
        : { ...item, status: 'error' }
      if (!checked.live) errors[index] = checked.error ?? 'Proxy chưa LIVE từ máy Windows.'
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(EXTERNAL_VERIFY_CONCURRENCY, Math.max(1, results.length)) },
    () => worker()
  ))
  return { results, errors: errors.filter(Boolean) }
}

function isCloudFirewallTimeout(errors: string[]): boolean {
  return errors.length > 0 && errors.every((message) =>
    /Timeout khi kết nối proxy|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(message)
  )
}

async function privilegedPrefix(session: SshSessionLike): Promise<string> {
  const uid = await session.exec('id -u')
  if (uid.code !== 0) throw new Error('Không xác định được quyền user SSH.')
  if (uid.stdout.trim() === '0') return ''
  const sudo = await session.exec('sudo -n true')
  if (sudo.code !== 0) throw new Error('SSH user cần root hoặc sudo không hỏi mật khẩu để provision proxy.')
  return 'sudo -n '
}

export class ProxyBuilderProvisionService {
  private readonly runs = new Map<string, ProxyBuilderProvisionSnapshot>()
  private active: ActiveRun | null = null

  start(input: ProxyBuilderProvisionInput): ProxyBuilderProvisionSnapshot {
    const validationError = validateInput(input)
    if (validationError) throw new Error(validationError)
    if (this.active) throw new Error('Đang có một phiên tạo proxy chạy; hãy dừng hoặc chờ phiên hiện tại.')
    const now = new Date().toISOString()
    const snapshot: ProxyBuilderProvisionSnapshot = {
      runId: randomUUID(), status: 'running', phase: 'connecting', percent: 5,
      message: 'Đang kết nối VPS…', createdAt: now, updatedAt: now, results: []
    }
    this.runs.set(snapshot.runId, snapshot)
    this.active = { runId: snapshot.runId, session: null, cancelRequested: false }
    void this.execute(snapshot.runId, input)
    return cloneSnapshot(snapshot)
  }

  status(payload: ProxyBuilderRunIdPayload): ProxyBuilderProvisionSnapshot | null {
    const snapshot = this.runs.get(payload.runId)
    return snapshot ? cloneSnapshot(snapshot) : null
  }

  cancel(payload: ProxyBuilderRunIdPayload): ProxyBuilderProvisionSnapshot | null {
    const snapshot = this.runs.get(payload.runId)
    if (!snapshot) return null
    if (snapshot.status !== 'running') return cloneSnapshot(snapshot)
    const active = this.active
    if (active?.runId === payload.runId) {
      active.cancelRequested = true
      active.session?.cancel()
      this.update(payload.runId, { phase: 'rollback', percent: Math.max(snapshot.percent, 90), message: 'Đang dừng và rollback phiên tạo proxy…' })
    }
    return cloneSnapshot(this.runs.get(payload.runId)!)
  }

  async controlRuntime(input: ProxyBuilderRuntimeControlInput): Promise<ProxyBuilderRuntimeControlResult> {
    const validationError = validateInput({ ...input, ipMode: 'ipv4', count: 1, proxyAuth: { type: 'none' } })
    if (validationError) throw new Error(validationError)
    const session = createSshSession(input)
    try {
      await session.connect(connectConfig(input))
      const prefix = await privilegedPrefix(session)
      const command = `${prefix}systemctl ${input.action} page-auto-proxy.service`
      const result = await session.exec(command)
      if (result.code !== 0) throw new Error((result.stderr || result.stdout || 'Không điều khiển được proxy service.').trim())
      const active = await session.exec(`${prefix}systemctl is-active page-auto-proxy.service`)
      return { active: active.stdout.trim() === 'active', message: input.action === 'stop' ? 'Đã dừng proxy service.' : 'Proxy service đang chạy.' }
    } finally { session.end() }
  }

  dispose(): void {
    if (this.active) {
      this.active.cancelRequested = true
      this.active.session?.cancel()
    }
  }

  private update(runId: string, patch: Partial<ProxyBuilderProvisionSnapshot>): void {
    const current = this.runs.get(runId)
    if (!current) return
    this.runs.set(runId, { ...current, ...patch, updatedAt: new Date().toISOString() })
  }

  private async execute(runId: string, input: ProxyBuilderProvisionInput): Promise<void> {
    const session = createSshSession(input)
    if (this.active?.runId === runId) this.active.session = session
    const tempBase = `/tmp/page-auto-proxy-${runId}`
    const paths = {
      request: `${tempBase}-request.json`, runtime: `${tempBase}-runtime.py`, restore: `${tempBase}-restore.py`,
      provisioner: `${tempBase}-provision.py`, service: `${tempBase}.service`
    }
    try {
      await session.connect(connectConfig(input))
      if (this.active?.cancelRequested) throw new Error('Provision cancelled')
      this.update(runId, { phase: 'preflight', percent: 18, message: 'Đang kiểm tra quyền và runtime VPS…' })
      const prefix = await privilegedPrefix(session)
      const systemd = await session.exec('command -v systemctl >/dev/null 2>&1')
      if (systemd.code !== 0) throw new Error('VPS cần systemd để giữ proxy runtime sau reboot.')
      let prereq = await session.exec('command -v python3 >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v ip >/dev/null 2>&1 && command -v ss >/dev/null 2>&1')
      if (prereq.code !== 0) {
        this.update(runId, { phase: 'preflight', percent: 22, message: 'Đang cài runtime network cần thiết trên VPS…' })
        const installScript = 'if command -v apt-get >/dev/null 2>&1; then export DEBIAN_FRONTEND=noninteractive; apt-get update -y && apt-get install -y python3 curl iproute2; elif command -v dnf >/dev/null 2>&1; then dnf install -y python3 curl iproute; elif command -v yum >/dev/null 2>&1; then yum install -y python3 curl iproute; elif command -v apk >/dev/null 2>&1; then apk add --no-cache python3 curl iproute2; else exit 42; fi'
        const installer = prefix ? `${prefix}sh -c ${shellQuote(installScript)}` : `sh -c ${shellQuote(installScript)}`
        const installed = await session.exec(installer, 5 * 60_000)
        if (installed.code !== 0) throw new Error('Không tự cài được python3/curl/iproute2 trên VPS.')
        prereq = await session.exec('command -v python3 >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v ip >/dev/null 2>&1 && command -v ss >/dev/null 2>&1')
        if (prereq.code !== 0) throw new Error('VPS vẫn thiếu python3, curl hoặc iproute2 sau bước cài đặt.')
      }
      const ifaceResult = await session.exec("ip -o route show default 2>/dev/null | awk 'NR==1 {print $5}'")
      const interfaceName = ifaceResult.stdout.trim()
      if (!interfaceName) throw new Error('Không xác định được default network interface.')
      const publicResult = await session.exec("curl -4 -fsS --connect-timeout 3 --max-time 7 https://api.ipify.org 2>/dev/null || true")
      const listenHost = publicResult.stdout.trim() || input.host.trim().replace(/^\[|\]$/g, '')
      const request = JSON.stringify({
        host: input.host.trim(), interface: interfaceName, listenHost, count: input.count, startPort: input.startPort,
        ipMode: input.ipMode, proxyAuth: input.proxyAuth
      })
      this.update(runId, { phase: 'provisioning', percent: 28, message: 'Đang staging runtime và manifest…' })
      await session.writeFile(paths.request, request, 0o600)
      await session.writeFile(paths.runtime, PROXY_RUNTIME_PY, 0o700)
      await session.writeFile(paths.restore, PROXY_RESTORE_PY, 0o700)
      await session.writeFile(paths.provisioner, PROXY_PROVISIONER_PY, 0o700)
      await session.writeFile(paths.service, PROXY_SYSTEMD_SERVICE, 0o600)
      if (this.active?.cancelRequested) throw new Error('Provision cancelled')
      const command = `${prefix}python3 ${shellQuote(paths.provisioner)} ${shellQuote(paths.request)} ${shellQuote(paths.runtime)} ${shellQuote(paths.restore)} ${shellQuote(paths.service)} ${shellQuote(runId)}`
      const result = await session.exec(command, PROVISION_TIMEOUT_MS, (line) => {
        const progress = parseProgress(line)
        if (progress && progress.phase !== 'complete') this.update(runId, progress)
      })
      if (result.code !== 0) throw new Error((result.stderr || result.stdout || 'Provision command failed.').trim().slice(-2200))
      const remote = parseProvisionResult(result.stdout)
      if (this.active?.cancelRequested) throw new Error('Provision cancelled')
      this.update(runId, { phase: 'self_test', percent: 92, message: 'Đang kiểm tra khả năng truy cập proxy từ máy Windows…' })
      let verified = await verifyProvisionedProxies(remote, input.proxyAuth)
      let externalDead = verified.results.filter((item) => item.status === 'error').length
      let cloudFirewallAction: ProxyBuilderProvisionSnapshot['cloudFirewallAction']

      if (externalDead > 0 && isCloudFirewallTimeout(verified.errors) && remote.cloud?.provider === 'oci') {
        if (input.proxyAuth.type !== 'basic') {
          cloudFirewallAction = {
            provider: 'oci',
            status: 'required',
            message: 'Oracle Cloud đang chặn port. Bật User / Password trước khi cấu hình OCI để tránh mở proxy không xác thực ra Internet.'
          }
        } else {
          const ociConfigPath = resolveOciConfigPath(input.cloudFirewall?.configPath)
          if (!ociConfigPath) {
            cloudFirewallAction = {
              provider: 'oci',
              status: 'required',
              message: 'Oracle Cloud đang chặn port. Máy này chưa có ~/.oci/config; chọn Cấu hình OCI để Page-Auto tự mở Security List.'
            }
          } else {
            try {
              this.update(runId, {
                phase: 'self_test',
                percent: 95,
                message: 'Windows đang timeout; đã nhận OCI config và đang tự mở Security List…'
              })
              await ensureOciSecurityListIngress({
                configPath: ociConfigPath,
                ...(input.cloudFirewall?.profile?.trim() ? { profile: input.cloudFirewall.profile.trim() } : {}),
                region: remote.cloud.region,
                vnicId: remote.cloud.vnicId,
                startPort: input.startPort,
                endPort: input.startPort + input.count - 1
              })
              if (this.active?.cancelRequested) throw new Error('Provision cancelled')
              this.update(runId, { phase: 'self_test', percent: 97, message: 'Đã xử lý Oracle Security List; đang test lại từ Windows…' })
              verified = await verifyProvisionedProxies(remote, input.proxyAuth)
              externalDead = verified.results.filter((item) => item.status === 'error').length
              if (externalDead > 0 && isCloudFirewallTimeout(verified.errors)) {
                cloudFirewallAction = {
                  provider: 'oci',
                  status: 'failed',
                  message: 'Đã xử lý Oracle Security List nhưng Windows vẫn timeout. Có thể NSG hoặc cloud firewall khác vẫn đang chặn port.'
                }
              }
            } catch (error) {
              if (this.active?.cancelRequested) throw error
              cloudFirewallAction = {
                provider: 'oci',
                status: 'failed',
                message: 'Không tự mở được Oracle Cloud ingress: ' + errorMessage(error)
              }
            }
          }
        }
      }

      const firewallRange = remote.firewall
        ? remote.firewall.start_port + '-' + remote.firewall.end_port
        : input.startPort + '-' + (input.startPort + input.count - 1)
      const message = externalDead === 0
        ? 'Đã tạo ' + remote.mappings.length + ' proxy và xác minh LIVE từ máy này.'
        : cloudFirewallAction?.message
          ?? (isCloudFirewallTimeout(verified.errors)
            ? 'Host firewall đã mở TCP ' + firewallRange + ' nhưng Windows vẫn timeout. Cloud firewall / Security List / NSG đang chặn port.'
            : 'Host firewall đã xử lý TCP ' + firewallRange + ' nhưng ' + externalDead + ' proxy chưa LIVE từ Windows. ' + (verified.errors[0] ?? 'Hãy kiểm tra kết nối ngoài VPS.'))
      this.update(runId, {
        status: 'completed',
        phase: 'complete',
        percent: 100,
        message,
        results: verified.results,
        ...(cloudFirewallAction ? { cloudFirewallAction } : {})
      })
    } catch (error) {
      const cancelled = this.active?.runId === runId && this.active.cancelRequested
      this.update(runId, {
        status: cancelled ? 'cancelled' : 'failed', phase: 'rollback', percent: 100,
        message: cancelled ? 'Đã dừng phiên tạo proxy; rollback đã được yêu cầu trên VPS.' : errorMessage(error)
      })
    } finally {
      try { await session.exec(`rm -f ${Object.values(paths).map(shellQuote).join(' ')}`, 10_000) } catch { /* best effort */ }
      session.end()
      if (this.active?.runId === runId) this.active = null
    }
  }
}
