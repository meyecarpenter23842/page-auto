import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { isIP } from 'node:net'
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

import {
  OCI_INSTANCE_PRINCIPAL_PY,
  PROXY_RUNTIME_PY,
  PROXY_RESTORE_PY,
  PROXY_PROVISIONER_PY,
  PROXY_SYSTEMD_SERVICE
} from './remoteAssets'
import { applyProxyBuilderSshAuth } from './sshAuth'
import { runNativeOpenSsh, shouldUseNativeOpenSsh } from './nativeOpenSsh'
import { checkProxyLineNow } from './checkerService'
import {
  deleteOciIpv6Cidr,
  ensureOciIpv6Cidr,
  ensureOciSecurityListIngress,
  resolveOciConfigPath
} from './ociCloudFirewallService'
import {
  buildOciVnicMetadataProbeCommand,
  parseOciVnicMetadataProbeOutput,
  type OciVnicMetadata
} from './ociMetadata'

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
  const manualIpv6Cidr = input.ipv6Cidr?.trim()
  if (input.ipMode !== 'ipv4' && manualIpv6Cidr) {
    const requiredIpv6Count = input.ipMode === 'both' ? Math.max(1, input.count - 1) : input.count
    if (ipv6CidrCapacity(manualIpv6Cidr) < requiredIpv6Count) {
      return `IPv6 CIDR đã cấp không hợp lệ hoặc không đủ ${requiredIpv6Count} địa chỉ.`
    }
  }
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

function ipv6CidrCapacity(cidr: string): number {
  const match = cidr.trim().match(/^([^/]+)\/(\d{1,3})$/)
  if (!match || !match[1] || isIP(match[1]) !== 6) return 0
  const prefix = Number(match[2])
  if (!Number.isInteger(prefix) || prefix < 0 || prefix >= 128) return 0
  const hostBits = 128 - prefix
  if (hostBits >= 53) return Number.MAX_SAFE_INTEGER
  return Math.max(0, (2 ** hostBits) - 1)
}

function selectReusableIpv6Cidr(cidrs: string[], requiredAddressCount: number): string | null {
  return [...new Set(cidrs)]
    .filter((cidr) => ipv6CidrCapacity(cidr) >= requiredAddressCount)
    .sort((left, right) => ipv6CidrCapacity(left) - ipv6CidrCapacity(right))[0] ?? null
}

const ROUTED_IPV6_PROBE_PY = String.raw`import hashlib
import ipaddress
import subprocess
import sys
import time

network = ipaddress.ip_network(sys.argv[1], strict=False)
interface = sys.argv[2]
if network.version != 6 or network.prefixlen >= 128:
    sys.exit(2)
host_bits = 128 - network.prefixlen
span = (1 << host_bits) - 2
if span < 8:
    sys.exit(3)
seed = int.from_bytes(hashlib.sha256((str(network) + '|' + interface).encode()).digest()[:8], 'big')
for attempt in range(2):
    offset = 2 + ((seed + attempt * 0x9E3779B97F4A7C15) % span)
    address = str(ipaddress.ip_address(int(network.network_address) + offset))
    cidr = address + '/128'
    added = subprocess.run(['ip', '-6', 'addr', 'add', cidr, 'dev', interface, 'nodad'], capture_output=True, text=True)
    if added.returncode != 0:
        continue
    try:
        status = subprocess.run(['ip', '-6', 'addr', 'show', 'dev', interface], capture_output=True, text=True)
        if 'dadfailed' in status.stdout.lower() or ' tentative ' in (' ' + status.stdout.lower() + ' '):
            continue
        try:
            probe = subprocess.run([
                'curl', '-6', '-fsS', '--interface', address,
                '--connect-timeout', '2', '--max-time', '4', 'https://api64.ipify.org'
            ], capture_output=True, text=True, timeout=6)
        except subprocess.TimeoutExpired:
            continue
        if probe.returncode == 0:
            try:
                if ipaddress.ip_address(probe.stdout.strip()) == ipaddress.ip_address(address):
                    print(str(network))
                    sys.exit(0)
            except ValueError:
                pass
    finally:
        subprocess.run(['ip', '-6', 'addr', 'del', cidr, 'dev', interface], capture_output=True, text=True)
sys.exit(4)`

async function probeRemoteRoutedIpv6Cidr(
  session: SshSessionLike,
  prefix: string,
  interfaceName: string,
  cidrs: string[],
  requiredAddressCount: number
): Promise<string | null> {
  const candidates = [...new Set(cidrs)]
    .filter((cidr) => ipv6CidrCapacity(cidr) >= requiredAddressCount)
    .sort((left, right) => ipv6CidrCapacity(left) - ipv6CidrCapacity(right))
  if (!candidates.length) return null
  const encoded = Buffer.from(ROUTED_IPV6_PROBE_PY, 'utf8').toString('base64')
  const runner = `import base64;exec(base64.b64decode("${encoded}"))`
  for (const cidr of candidates) {
    const result = await session.exec(
      `${prefix}python3 -c ${shellQuote(runner)} ${shellQuote(cidr)} ${shellQuote(interfaceName)}`,
      15_000
    )
    if (result.code === 0) return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? cidr
  }
  return null
}

async function detectRemoteOci(session: SshSessionLike, interfaceName: string): Promise<OciVnicMetadata | null> {
  const command = buildOciVnicMetadataProbeCommand(shellQuote(interfaceName))
  const result = await session.exec(command, 15_000)
  if (result.code !== 0) return null
  return parseOciVnicMetadataProbeOutput(result.stdout)
}

interface RemoteOciIpv6Lease {
  ipv6Id: string
  cidr: string
  prefixLength: number
  created: boolean
  region?: string
  authSource?: 'instance-principal' | 'desktop-config'
  configPath?: string
}

interface RemoteOciIngressResult {
  securityListId: string
  changed: boolean
  verified: boolean
  region?: string
}

function parseRemoteOciJson<T>(result: CommandResult, action: string): T {
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    if (/INSTANCE_PRINCIPAL_IAM/i.test(detail)) {
      throw new Error('Oracle Cloud từ chối quyền Instance Principal để tự quản lý IPv6/Security List.')
    }
    throw new Error(`${action} lỗi: ${detail || 'OCI helper thất bại.'}`)
  }
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!line) throw new Error(`${action} không trả dữ liệu.`)
  try {
    return JSON.parse(line) as T
  } catch {
    throw new Error(`${action} trả dữ liệu không hợp lệ.`)
  }
}

async function ensureRemoteOciSdk(session: SshSessionLike, prefix: string): Promise<void> {
  const python = '/opt/page-auto-oci-sdk/bin/python'
  const probe = await session.exec(`${prefix}test -x ${python} && ${prefix}${python} -c "import oci" >/dev/null 2>&1`, 20_000)
  if (probe.code === 0) return
  const installScript = [
    'set -e',
    'if ! python3 -m venv /opt/page-auto-oci-sdk >/dev/null 2>&1; then',
    '  if command -v apt-get >/dev/null 2>&1; then export DEBIAN_FRONTEND=noninteractive; apt-get update -y; apt-get install -y python3-venv python3-pip ca-certificates;',
    '  elif command -v dnf >/dev/null 2>&1; then dnf install -y python3-pip python3;',
    '  elif command -v yum >/dev/null 2>&1; then yum install -y python3-pip python3;',
    '  elif command -v apk >/dev/null 2>&1; then apk add --no-cache python3 py3-pip py3-virtualenv ca-certificates;',
    '  else exit 42; fi',
    '  rm -rf /opt/page-auto-oci-sdk',
    '  python3 -m venv /opt/page-auto-oci-sdk',
    'fi',
    '/opt/page-auto-oci-sdk/bin/python -m pip install --disable-pip-version-check --quiet "oci>=2.150,<3"',
    '/opt/page-auto-oci-sdk/bin/python -c "import oci; print(oci.__version__)"'
  ].join('\n')
  const command = prefix
    ? `${prefix}sh -c ${shellQuote(installScript)}`
    : `sh -c ${shellQuote(installScript)}`
  const installed = await session.exec(command, 5 * 60_000)
  if (installed.code !== 0) {
    throw new Error('Không tự cài được OCI SDK trên VPS: ' + (installed.stderr || installed.stdout || '').trim().slice(-1200))
  }
}

async function runRemoteOciHelper<T>(
  session: SshSessionLike,
  prefix: string,
  helperPath: string,
  args: string[],
  action: string
): Promise<T> {
  await ensureRemoteOciSdk(session, prefix)
  const python = '/opt/page-auto-oci-sdk/bin/python'
  const command = [`${prefix}${python}`, shellQuote(helperPath), ...args.map(shellQuote)].join(' ')
  const result = await session.exec(command, 3 * 60_000)
  return parseRemoteOciJson<T>(result, action)
}

function isInstancePrincipalIamError(error: unknown): boolean {
  return /Instance Principal|INSTANCE_PRINCIPAL_IAM/i.test(errorMessage(error))
}

function canFallbackToDesktopOci(error: unknown): boolean {
  return isInstancePrincipalIamError(error) || /Không tự cài được OCI SDK/i.test(errorMessage(error))
}

async function ensureOciIpv6Automatically(
  session: SshSessionLike,
  prefix: string,
  helperPath: string,
  remoteOci: OciVnicMetadata,
  requiredAddressCount: number
): Promise<RemoteOciIpv6Lease> {
  try {
    const lease = await runRemoteOciHelper<RemoteOciIpv6Lease>(
      session,
      prefix,
      helperPath,
      ['ensure-ipv6', remoteOci.vnicId, String(requiredAddressCount)],
      'Cấp OCI Flexible IPv6 CIDR'
    )
    return { ...lease, region: lease.region ?? remoteOci.region, authSource: 'instance-principal' }
  } catch (error) {
    const configPath = resolveOciConfigPath()
    if (!configPath || !canFallbackToDesktopOci(error)) throw error
    const lease = await ensureOciIpv6Cidr({
      configPath,
      region: remoteOci.region,
      vnicId: remoteOci.vnicId,
      requiredAddressCount
    })
    return {
      ...lease,
      region: remoteOci.region,
      authSource: 'desktop-config',
      configPath
    }
  }
}

async function ensureOciIngressAutomatically(
  session: SshSessionLike,
  prefix: string,
  helperPath: string,
  remoteOci: OciVnicMetadata,
  startPort: number,
  endPort: number
): Promise<RemoteOciIngressResult> {
  try {
    return await runRemoteOciHelper<RemoteOciIngressResult>(
      session,
      prefix,
      helperPath,
      ['ensure-ingress', remoteOci.vnicId, String(startPort), String(endPort)],
      'Mở OCI Security List'
    )
  } catch (error) {
    const configPath = resolveOciConfigPath()
    if (!configPath || !canFallbackToDesktopOci(error)) throw error
    const ingress = await ensureOciSecurityListIngress({
      configPath,
      region: remoteOci.region,
      vnicId: remoteOci.vnicId,
      startPort,
      endPort
    })
    return { ...ingress, region: remoteOci.region }
  }
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
      provisioner: `${tempBase}-provision.py`, service: `${tempBase}.service`,
      ociHelper: `${tempBase}-oci-instance-principal.py`
    }
    let ociIpv6Lease: RemoteOciIpv6Lease | null = null
    let remoteProvisionSucceeded = false
    let rootPrefix = ''
    try {
      await session.connect(connectConfig(input))
      if (this.active?.cancelRequested) throw new Error('Provision cancelled')
      this.update(runId, { phase: 'preflight', percent: 18, message: 'Đang kiểm tra quyền và runtime VPS…' })
      const prefix = await privilegedPrefix(session)
      rootPrefix = prefix
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

      let ociIpv6Cidr: string | undefined
      const remoteOci = await detectRemoteOci(session, interfaceName)
      if (remoteOci) await session.writeFile(paths.ociHelper, OCI_INSTANCE_PRINCIPAL_PY, 0o700)
      const requiredAddressCount = input.ipMode === 'both' ? Math.max(1, input.count - 1) : input.count
      const manualIpv6Cidr = input.ipMode === 'ipv4' ? '' : input.ipv6Cidr?.trim() ?? ''
      if (manualIpv6Cidr) {
        this.update(runId, {
          phase: 'provisioning',
          percent: 24,
          message: `Đang xác minh CIDR IPv6 đã cấp trên cloud (${manualIpv6Cidr})…`
        })
        const verifiedCidr = await probeRemoteRoutedIpv6Cidr(
          session,
          prefix,
          interfaceName,
          [manualIpv6Cidr],
          requiredAddressCount
        )
        if (!verifiedCidr) {
          throw new Error(`CIDR IPv6 ${manualIpv6Cidr} chưa route/source-bind được trên VPS. Page-Auto không gọi OCI API khi đã nhập CIDR thủ công.`)
        }
        ociIpv6Cidr = verifiedCidr
        this.update(runId, {
          phase: 'provisioning',
          percent: 25,
          message: `CIDR IPv6 đã xác minh; đang tạo pool trong ${verifiedCidr}…`
        })
      } else if (input.ipMode !== 'ipv4' && remoteOci) {
        const assignedCidr = selectReusableIpv6Cidr(remoteOci.assignedIpv6Cidrs, requiredAddressCount)
        if (assignedCidr) {
          ociIpv6Cidr = assignedCidr
          this.update(runId, {
            phase: 'provisioning',
            percent: 24,
            message: `Đang tái sử dụng dải IPv6 OCI đã gán sẵn cho VNIC (${assignedCidr})…`
          })
        } else {
          this.update(runId, {
            phase: 'provisioning',
            percent: 24,
            message: 'Đang kiểm tra xem subnet IPv6 hiện tại có được route trực tiếp tới VPS không…'
          })
          const routedCidr = await probeRemoteRoutedIpv6Cidr(
            session,
            prefix,
            interfaceName,
            remoteOci.subnetIpv6Cidrs,
            requiredAddressCount
          )
          if (routedCidr) {
            ociIpv6Cidr = routedCidr
            this.update(runId, {
              phase: 'provisioning',
              percent: 25,
              message: `Subnet IPv6 được route trực tiếp; đang tạo pool trong ${routedCidr}…`
            })
          } else if (!remoteOci.assignedIpv6Cidrs.length) {
            throw new Error('OCI IMDS không trả IPv6 CIDR đã gán cho VNIC. Hãy nhập CIDR đã cấp trên Oracle Console; Page-Auto sẽ không gọi CreateIpv6 trong trạng thái này.')
          } else {
            this.update(runId, {
              phase: 'provisioning',
              percent: 25,
              message: `Subnet không cho source-bind trực tiếp; Page-Auto đang tự cấp Flexible IPv6 CIDR cho ${requiredAddressCount} IPv6…`
            })
            const lease = await ensureOciIpv6Automatically(
              session,
              prefix,
              paths.ociHelper,
              remoteOci,
              requiredAddressCount
            )
            ociIpv6Cidr = lease.cidr
            ociIpv6Lease = lease
          }
        }
      }

      const request = JSON.stringify({
        host: input.host.trim(), interface: interfaceName, listenHost, count: input.count, startPort: input.startPort,
        ipMode: input.ipMode, proxyAuth: input.proxyAuth,
        ...(ociIpv6Cidr ? { ociIpv6Cidr } : {})
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
      remoteProvisionSucceeded = true
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
          try {
            this.update(runId, {
              phase: 'self_test',
              percent: 95,
              message: 'Windows đang timeout; Page-Auto đang dùng quyền OCI của VPS để tự mở Security List…'
            })
            if (!remoteOci) throw new Error('Không đọc được OCI instance metadata trên VPS.')
            const ingress = await ensureOciIngressAutomatically(
              session,
              prefix,
              paths.ociHelper,
              remoteOci,
              input.startPort,
              input.startPort + input.count - 1
            )
            if (!ingress.verified) throw new Error('OCI Security List chưa xác minh được ingress vừa tạo.')
            if (this.active?.cancelRequested) throw new Error('Provision cancelled')
            this.update(runId, { phase: 'self_test', percent: 97, message: 'OCI Security List đã xác minh port; đang test lại từ Windows…' })
            verified = await verifyProvisionedProxies(remote, input.proxyAuth)
            externalDead = verified.results.filter((item) => item.status === 'error').length
            if (externalDead > 0 && isCloudFirewallTimeout(verified.errors)) {
              cloudFirewallAction = {
                provider: 'oci',
                status: 'failed',
                message: 'OCI Security List đã xác minh đúng port nhưng Windows vẫn timeout. Proxy trên VPS đang chạy; còn blocker ở public route/ZPR hoặc lớp mạng OCI khác.'
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
        status: externalDead === 0 ? 'completed' : 'failed',
        phase: externalDead === 0 ? 'complete' : 'self_test',
        percent: 100,
        message,
        results: verified.results,
        ...(cloudFirewallAction ? { cloudFirewallAction } : {})
      })
    } catch (error) {
      const cancelled = this.active?.runId === runId && this.active.cancelRequested
      let cleanupWarning = ''
      if (!remoteProvisionSucceeded && ociIpv6Lease?.created) {
        try {
          if (ociIpv6Lease.authSource === 'desktop-config' && ociIpv6Lease.configPath && ociIpv6Lease.region) {
            await deleteOciIpv6Cidr({
              configPath: ociIpv6Lease.configPath,
              region: ociIpv6Lease.region,
              ipv6Id: ociIpv6Lease.ipv6Id
            })
          } else {
            await runRemoteOciHelper(
              session,
              rootPrefix,
              paths.ociHelper,
              ['delete-ipv6', ociIpv6Lease.ipv6Id],
              'Rollback OCI IPv6 CIDR'
            )
          }
        } catch (cleanupError) {
          cleanupWarning = ' Rollback OCI IPv6 CIDR lỗi: ' + errorMessage(cleanupError)
        }
      }
      this.update(runId, {
        status: cancelled ? 'cancelled' : 'failed', phase: 'rollback', percent: 100,
        message: (cancelled ? 'Đã dừng phiên tạo proxy; rollback đã được yêu cầu trên VPS.' : errorMessage(error)) + cleanupWarning
      })
    } finally {
      try { await session.exec(`rm -f ${Object.values(paths).map(shellQuote).join(' ')}`, 10_000) } catch { /* best effort */ }
      session.end()
      if (this.active?.runId === runId) this.active = null
    }
  }
}
