import { isIP } from 'node:net'
import { Client, type ConnectConfig } from 'ssh2'
import type {
  ProxyBuilderAuditErrorCode,
  ProxyBuilderAuditInput,
  ProxyBuilderAuditResult,
  ProxyBuilderCapability
} from '../../shared/proxyBuilder'

const SSH_READY_TIMEOUT_MS = 15_000
const DISCOVERY_TIMEOUT_MS = 25_000

function clean(value: string | undefined): string {
  return (value ?? '').trim()
}

function list(value: string | undefined): string[] {
  return clean(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function firstAddress(cidr: string | undefined): string | null {
  if (!cidr) return null
  const [address] = cidr.split('/')
  return address?.trim() || null
}

function isPublicIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false
  const octets = value.split('.').map(Number)
  const a = octets[0] ?? -1
  const b = octets[1] ?? -1
  if (a === 10 || a === 127 || a === 0) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  return true
}

function parseKeyValueOutput(output: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const rawLine of output.split(/\r?\n/)) {
    const index = rawLine.indexOf('=')
    if (index <= 0) continue
    values.set(rawLine.slice(0, index).trim(), rawLine.slice(index + 1).trim())
  }
  return values
}

export function parseProxyBuilderDiscovery(output: string): ProxyBuilderCapability {
  const values = parseKeyValueOutput(output)
  const ipv4Addresses = list(values.get('PA_IPV4'))
  const ipv6Addresses = list(values.get('PA_IPV6'))
  const discoveredPublic = clean(values.get('PA_PUBLIC4'))
  const fallbackPublic = ipv4Addresses.map(firstAddress).find((value): value is string => Boolean(value && isPublicIpv4(value))) ?? null
  const publicIpv4 = isPublicIpv4(discoveredPublic) ? discoveredPublic : fallbackPublic
  const sourceBindIpv4 = values.get('PA_SOURCE4') === '1'
  const sourceBindIpv6 = values.get('PA_SOURCE6') === '1'
  const defaultInterface = clean(values.get('PA_IFACE')) || null
  const ipv6Prefix = ipv6Addresses[0] ?? null

  return {
    os: clean(values.get('PA_OS')) || 'Linux',
    defaultInterface,
    publicIpv4,
    ipv4Addresses,
    ipv6Addresses,
    ipv6Prefix,
    ipv6Gateway: clean(values.get('PA_IPV6_GW')) || null,
    supportsIpv4: Boolean(defaultInterface && ipv4Addresses.length > 0 && sourceBindIpv4),
    supportsIpv6: Boolean(defaultInterface && ipv6Addresses.length > 0 && sourceBindIpv6),
    sourceBindIpv4,
    sourceBindIpv6,
    startPortAvailable: values.get('PA_PORT_FREE') === '1'
  }
}

function validate(input: ProxyBuilderAuditInput): string | null {
  if (!input.host.trim() || !/^[a-zA-Z0-9._:[\]-]+$/.test(input.host.trim())) return 'VPS IP / Host không hợp lệ.'
  if (!input.username.trim() || !/^[a-zA-Z0-9._-]+$/.test(input.username.trim())) return 'SSH User không hợp lệ.'
  if (!Number.isInteger(input.startPort) || input.startPort < 1 || input.startPort > 65535) return 'Start Port phải nằm trong 1-65535.'
  if (input.auth.type === 'password' && !input.auth.password) return 'Chưa nhập SSH Password.'
  if (input.auth.type === 'key' && !input.auth.privateKey.trim()) return 'Chưa nhập SSH Private Key.'
  return null
}

function discoveryScript(startPort: number): string {
  return [
    'set +e',
    'OS_NAME="$(if [ -r /etc/os-release ]; then . /etc/os-release; printf "%s %s" "$NAME" "$VERSION_ID"; else uname -sr; fi)"',
    'IFACE="$(ip -o route show default 2>/dev/null | awk \'NR==1 {print $5}\')"',
    '[ -n "$IFACE" ] || IFACE="$(ip -6 -o route show default 2>/dev/null | awk \'NR==1 {print $5}\')"',
    'IPV4="$(ip -o -4 addr show scope global 2>/dev/null | awk \'{print $4}\' | paste -sd, -)"',
    'IPV6="$(ip -o -6 addr show scope global 2>/dev/null | awk \'{print $4}\' | paste -sd, -)"',
    'IPV6_GW="$(ip -6 route show default 2>/dev/null | awk \'NR==1 {print $3}\')"',
    'PUBLIC4=""',
    'if command -v curl >/dev/null 2>&1; then PUBLIC4="$(curl -4 -fsS --connect-timeout 3 --max-time 5 https://api.ipify.org 2>/dev/null | tr -d "\\r\\n")"; fi',
    'if [ -z "$PUBLIC4" ] && command -v wget >/dev/null 2>&1; then PUBLIC4="$(wget -4 -qO- --timeout=5 https://api.ipify.org 2>/dev/null | tr -d "\\r\\n")"; fi',
    'SOURCE4=0',
    'if command -v curl >/dev/null 2>&1; then for CIDR in $(ip -o -4 addr show scope global 2>/dev/null | awk \'{print $4}\' | head -n 8); do ADDR="${CIDR%/*}"; if curl -4 -fsS --interface "$ADDR" --connect-timeout 2 --max-time 4 https://api.ipify.org >/dev/null 2>&1; then SOURCE4=1; break; fi; done; fi',
    'SOURCE6=0',
    'if command -v curl >/dev/null 2>&1; then for CIDR in $(ip -o -6 addr show scope global 2>/dev/null | awk \'{print $4}\' | head -n 8); do ADDR="${CIDR%/*}"; if curl -6 -fsS --interface "$ADDR" --connect-timeout 2 --max-time 4 https://api64.ipify.org >/dev/null 2>&1; then SOURCE6=1; break; fi; done; fi',
    `PORT_FREE=1; if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk 'NR>1 {print $4}' | grep -Eq '[:.]${startPort}$'; then PORT_FREE=0; fi`,
    'printf "PA_OS=%s\\n" "$OS_NAME"',
    'printf "PA_IFACE=%s\\n" "$IFACE"',
    'printf "PA_PUBLIC4=%s\\n" "$PUBLIC4"',
    'printf "PA_IPV4=%s\\n" "$IPV4"',
    'printf "PA_IPV6=%s\\n" "$IPV6"',
    'printf "PA_IPV6_GW=%s\\n" "$IPV6_GW"',
    'printf "PA_SOURCE4=%s\\n" "$SOURCE4"',
    'printf "PA_SOURCE6=%s\\n" "$SOURCE6"',
    'printf "PA_PORT_FREE=%s\\n" "$PORT_FREE"'
  ].join('\n')
}

function classifyError(error: unknown): { code: ProxyBuilderAuditErrorCode; message: string } {
  const candidate = error as { level?: string; message?: string; code?: string }
  const message = clean(candidate?.message)
  if (candidate?.level === 'client-authentication' || /authentication|all configured authentication methods failed/i.test(message)) {
    return { code: 'auth_failed', message: 'SSH từ chối thông tin đăng nhập.' }
  }
  if (/timed out|timeout/i.test(message)) return { code: 'timeout', message: 'SSH timeout khi kết nối VPS.' }
  if (/ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ENOTFOUND/i.test(message) || candidate?.code) {
    return { code: 'connection_failed', message: 'Không kết nối được tới VPS qua SSH.' }
  }
  return { code: 'unknown', message: message ? `SSH lỗi: ${message}` : 'SSH gặp lỗi không xác định.' }
}

function execDiscovery(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Discovery command timeout'))
    }, DISCOVERY_TIMEOUT_MS)

    client.exec(command, (error, stream) => {
      if (error) {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(error)
        }
        return
      }
      let stdout = ''
      let stderr = ''
      stream.on('data', (chunk: Buffer | string) => { stdout += chunk.toString() })
      stream.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString() })
      stream.on('close', (code: number | undefined) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        if (code && code !== 0) reject(new Error(stderr.trim() || `Discovery command exited with code ${code}.`))
        else resolve(stdout)
      })
    })
  })
}

export async function auditProxyBuilderVps(input: ProxyBuilderAuditInput): Promise<ProxyBuilderAuditResult> {
  const validationError = validate(input)
  if (validationError) return { ok: false, code: 'invalid_input', message: validationError }

  const config: ConnectConfig = {
    host: input.host.trim().replace(/^\[|\]$/g, ''),
    port: 22,
    username: input.username.trim(),
    readyTimeout: SSH_READY_TIMEOUT_MS,
    keepaliveInterval: 5_000,
    keepaliveCountMax: 2
  }
  if (input.auth.type === 'password') config.password = input.auth.password
  else config.privateKey = input.auth.privateKey

  const client = new Client()
  try {
    const output = await new Promise<string>((resolve, reject) => {
      let settled = false
      const succeed = (value: string) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        reject(error)
      }
      client.once('ready', () => {
        void execDiscovery(client, discoveryScript(input.startPort)).then(succeed, fail)
      })
      client.once('error', fail)
      client.once('end', () => {
        fail(new Error('SSH connection ended before discovery completed.'))
      })
      try {
        client.connect(config)
      } catch (error) {
        fail(error)
      }
    })
    return { ok: true, capability: parseProxyBuilderDiscovery(output) }
  } catch (error) {
    const classified = classifyError(error)
    return { ok: false, ...classified }
  } finally {
    client.end()
  }
}
