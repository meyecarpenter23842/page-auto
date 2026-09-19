import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ProxyBuilderAuditInput, ProxyBuilderSshAuth } from '../../shared/proxyBuilder'

export interface NativeOpenSshResult {
  stdout: string
  stderr: string
  code: number
}

export interface NativeOpenSshRunOptions {
  stdin?: string
  timeoutMs?: number
  onLine?: (line: string) => void
  onChild?: (child: ChildProcessWithoutNullStreams | null) => void
}

type SshTargetInput = Pick<ProxyBuilderAuditInput, 'host' | 'username' | 'auth'>

export function shouldUseNativeOpenSsh(auth: ProxyBuilderSshAuth): boolean {
  return process.platform === 'win32'
    && auth.type === 'key'
    && Boolean(auth.privateKeyPath?.trim())
    && !auth.passphrase
}

export function buildNativeOpenSshArgs(input: SshTargetInput, remoteCommand: string): string[] {
  if (input.auth.type !== 'key' || !input.auth.privateKeyPath?.trim()) {
    throw new Error('Native OpenSSH cần SSH key file đã chọn.')
  }
  const host = input.host.trim().replace(/^\[|\]$/g, '')
  const user = input.username.trim()
  return [
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

export async function runNativeOpenSsh(
  input: SshTargetInput,
  remoteCommand: string,
  options: NativeOpenSshRunOptions = {}
): Promise<NativeOpenSshResult> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const args = buildNativeOpenSshArgs(input, remoteCommand)

  return await new Promise<NativeOpenSshResult>((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let lineBuffer = ''
    const child = spawn('ssh.exe', args, {
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
      else resolve({ stdout, stderr, code: code ?? 255 })
    }

    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      finish(new Error('Windows OpenSSH command timeout.'))
    }, timeoutMs)

    child.once('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        finish(new Error('Không tìm thấy Windows OpenSSH (ssh.exe).'))
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
