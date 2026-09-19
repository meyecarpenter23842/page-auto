import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { utils } from 'ssh2'
import type {
  ProxyBuilderAuditInput,
  ProxyBuilderSshAuth,
  ProxyBuilderSshProbeDiagnostic,
  ProxyBuilderSshProbeName
} from '../../shared/proxyBuilder'

const MAX_TRACE_CHARS = 120_000

export interface NativeOpenSshResult {
  stdout: string
  stderr: string
  code: number
  executable: string
  version: string
  args: string[]
}

export interface NativeOpenSshRunOptions {
  stdin?: string
  timeoutMs?: number
  verbose?: boolean
  onLine?: (line: string) => void
  onChild?: (child: ChildProcessWithoutNullStreams | null) => void
}

export interface NativeOpenSshKeyInfo {
  exists: boolean
  size: number | null
  fingerprint: string | null
}

type SshTargetInput = Pick<ProxyBuilderAuditInput, 'host' | 'username' | 'auth'>

export function resolveWindowsOpenSshExecutable(
  systemRoot: string | undefined = process.env.SystemRoot ?? process.env.WINDIR,
  exists: (path: string) => boolean = existsSync
): string {
  const root = systemRoot?.trim()
  if (root) {
    const candidates = [
      join(root, 'System32', 'OpenSSH', 'ssh.exe'),
      join(root, 'Sysnative', 'OpenSSH', 'ssh.exe')
    ]
    const resolved = candidates.find((candidate) => exists(candidate))
    if (resolved) return resolved
  }
  return 'ssh.exe'
}

async function readOpenSshVersion(executable: string): Promise<string> {
  return await new Promise<string>((resolve) => {
    let stderr = ''
    let stdout = ''
    const child = spawn(executable, ['-V'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString() })
    child.once('error', () => resolve('unknown'))
    child.once('close', () => resolve((stderr || stdout).trim().split(/\r?\n/)[0] || 'unknown'))
  })
}

function clipTrace(value: string): string {
  if (value.length <= MAX_TRACE_CHARS) return value
  const half = Math.floor(MAX_TRACE_CHARS / 2)
  return value.slice(0, half) + '\n...[trace truncated]...\n' + value.slice(-half)
}

function sanitizeSshText(input: SshTargetInput, value: string): string {
  let sanitized = value
  const secrets: string[] = []
  if (input.auth.type === 'password') {
    if (input.auth.password) secrets.push(input.auth.password)
  } else {
    if (input.auth.privateKey.trim()) secrets.push(input.auth.privateKey.trim())
    if (input.auth.passphrase) secrets.push(input.auth.passphrase)
  }
  for (const secret of secrets) {
    if (!secret) continue
    sanitized = sanitized.split(secret).join('[redacted]')
  }
  return clipTrace(sanitized)
}

export function inspectNativeOpenSshKey(keyPath: string): NativeOpenSshKeyInfo {
  if (!keyPath || !existsSync(keyPath)) return { exists: false, size: null, fingerprint: null }
  try {
    const stat = statSync(keyPath)
    if (!stat.isFile()) return { exists: true, size: null, fingerprint: null }
    const parsed = utils.parseKey(readFileSync(keyPath))
    if (parsed instanceof Error) return { exists: true, size: stat.size, fingerprint: null }
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    if (!first) return { exists: true, size: stat.size, fingerprint: null }
    const digest = createHash('sha256').update(first.getPublicSSH()).digest('base64').replace(/=+$/, '')
    return { exists: true, size: stat.size, fingerprint: `SHA256:${digest}` }
  } catch {
    return { exists: true, size: null, fingerprint: null }
  }
}

export function shouldUseNativeOpenSsh(auth: ProxyBuilderSshAuth): boolean {
  return process.platform === 'win32'
    && auth.type === 'key'
    && Boolean(auth.privateKeyPath?.trim())
    && !auth.passphrase
}

export function buildNativeOpenSshArgs(
  input: SshTargetInput,
  remoteCommand: string,
  options: Pick<NativeOpenSshRunOptions, 'verbose'> = {}
): string[] {
  if (input.auth.type !== 'key' || !input.auth.privateKeyPath?.trim()) {
    throw new Error('Native OpenSSH cần SSH key file đã chọn.')
  }
  const host = input.host.trim().replace(/^\[|\]$/g, '')
  const user = input.username.trim()
  return [
    ...(options.verbose ? ['-vvv'] : []),
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=2',
    '-i', input.auth.privateKeyPath.trim(),
    '-p', '22',
    `${user}@${host}`,
    remoteCommand
  ]
}

function fingerprintsForMarker(trace: string, marker: string): string[] {
  const values = trace
    .split(/\r?\n/)
    .filter((line) => line.includes(marker))
    .flatMap((line) => line.match(/SHA256:[A-Za-z0-9+/]+/g) ?? [])
  return [...new Set(values)]
}

export function summarizeNativeOpenSshProbe(
  name: ProxyBuilderSshProbeName,
  remoteCommand: string,
  result: NativeOpenSshResult
): ProxyBuilderSshProbeDiagnostic {
  return {
    name,
    remoteCommand,
    args: [...result.args],
    exitCode: result.code,
    offeredFingerprints: fingerprintsForMarker(result.stderr, 'Offering public key'),
    acceptedFingerprints: fingerprintsForMarker(result.stderr, 'Server accepts key'),
    authenticated: /Authenticated to .+ using "publickey"/i.test(result.stderr),
    stderr: result.stderr
  }
}

export async function runNativeOpenSsh(
  input: SshTargetInput,
  remoteCommand: string,
  options: NativeOpenSshRunOptions = {}
): Promise<NativeOpenSshResult> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const args = buildNativeOpenSshArgs(
    input,
    remoteCommand,
    options.verbose === undefined ? {} : { verbose: options.verbose }
  )
  const executable = resolveWindowsOpenSshExecutable()
  const version = await readOpenSshVersion(executable)

  return await new Promise<NativeOpenSshResult>((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let lineBuffer = ''
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    options.onChild?.(child)

    const finish = (error?: Error, code?: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.onChild?.(null)
      if (error) reject(error)
      else resolve({
        stdout: sanitizeSshText(input, stdout),
        stderr: sanitizeSshText(input, stderr),
        code: code ?? 255,
        executable,
        version,
        args
      })
    }

    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      finish(new Error('Windows OpenSSH command timeout.'))
    }, timeoutMs)

    child.once('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        finish(new Error(`Không tìm thấy Windows OpenSSH tại ${executable}.`))
        return
      }
      finish(error)
    })

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString()
      stdout += text
      if (options.onLine) {
        lineBuffer += text
        const lines = lineBuffer.split(/\r?\n/)
        lineBuffer = lines.pop() ?? ''
        for (const line of lines) options.onLine(line)
      }
    })
    child.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString() })
    child.once('close', (code) => {
      if (options.onLine && lineBuffer) options.onLine(lineBuffer)
      finish(undefined, code ?? 255)
    })

    if (options.stdin !== undefined) child.stdin.end(options.stdin)
    else child.stdin.end()
  })
}
