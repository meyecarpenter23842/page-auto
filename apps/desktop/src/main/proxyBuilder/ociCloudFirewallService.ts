import { createHash, createSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { request as httpsRequest } from 'node:https'

interface OciCredentials {
  tenancy: string
  user: string
  fingerprint: string
  region: string
  keyFile: string
  passPhrase?: string
}

interface OciIngressRule {
  description?: string
  isStateless?: boolean
  protocol: string
  source: string
  sourceType?: string
  tcpOptions?: {
    destinationPortRange?: { min: number; max: number }
    sourcePortRange?: { min: number; max: number }
  }
  [key: string]: unknown
}

interface OciVnic { subnetId?: string }
interface OciSubnet { securityListIds?: string[] }
interface OciSecurityList { ingressSecurityRules?: OciIngressRule[] }

export interface EnsureOciIngressInput {
  configPath: string
  profile?: string
  region: string
  vnicId: string
  startPort: number
  endPort: number
}

export interface EnsureOciIngressResult {
  securityListId: string
  changed: boolean
  verified: boolean
}

const RULE_MARKER_PREFIX = 'page-auto-proxy:'

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function expandConfigPath(value: string, configPath: string): string {
  const raw = unquote(value)
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return resolve(homedir(), raw.slice(2))
  if (isAbsolute(raw)) return raw
  return resolve(dirname(configPath), raw)
}

export function parseOciConfig(content: string, profile = 'DEFAULT', configPath = ''): OciCredentials {
  const sections = new Map<string, Map<string, string>>()
  let current = 'DEFAULT'
  sections.set(current, new Map())

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      current = sectionMatch[1]!.trim()
      if (!sections.has(current)) sections.set(current, new Map())
      continue
    }
    const index = line.indexOf('=')
    if (index <= 0) continue
    sections.get(current)!.set(line.slice(0, index).trim(), unquote(line.slice(index + 1)))
  }

  const selected = sections.get(profile)
  if (!selected) throw new Error(`OCI config không có profile [${profile}].`)
  const required = (name: string): string => {
    const value = selected.get(name)?.trim()
    if (!value) throw new Error(`OCI config thiếu "${name}" trong profile [${profile}].`)
    return value
  }

  const keyFileRaw = required('key_file')
  return {
    tenancy: required('tenancy'),
    user: required('user'),
    fingerprint: required('fingerprint'),
    region: required('region'),
    keyFile: expandConfigPath(keyFileRaw, configPath),
    ...(selected.get('pass_phrase')?.trim() ? { passPhrase: selected.get('pass_phrase')!.trim() } : {})
  }
}

export function resolveOciConfigPath(selectedPath?: string, homeDirectory = homedir()): string | null {
  const explicit = selectedPath?.trim()
  if (explicit && existsSync(explicit)) return explicit
  const defaultPath = join(homeDirectory, '.oci', 'config')
  return existsSync(defaultPath) ? defaultPath : null
}

function loadCredentials(configPath: string, profile: string): OciCredentials {
  const path = configPath.trim()
  if (!path) throw new Error('Chưa chọn OCI config.')
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new Error('Không đọc được OCI config đã chọn.')
  }
  return parseOciConfig(text, profile, path)
}

function buildAuthorization(
  credentials: OciCredentials,
  method: string,
  url: URL,
  body: string | null
): { headers: Record<string, string>; bodyHash?: string } {
  const lowerMethod = method.toLowerCase()
  const date = new Date().toUTCString()
  const requestTarget = `${url.pathname}${url.search}`
  const headers: Record<string, string> = {
    host: url.host,
    date
  }
  const signingLines = [
    `(request-target): ${lowerMethod} ${requestTarget}`,
    `host: ${url.host}`,
    `date: ${date}`
  ]
  const signedHeaders = ['(request-target)', 'host', 'date']

  if (body !== null) {
    const bodyHash = createHash('sha256').update(body).digest('base64')
    headers['x-content-sha256'] = bodyHash
    headers['content-type'] = 'application/json'
    headers['content-length'] = String(Buffer.byteLength(body))
    signingLines.push(
      `x-content-sha256: ${bodyHash}`,
      'content-type: application/json',
      `content-length: ${headers['content-length']}`
    )
    signedHeaders.push('x-content-sha256', 'content-type', 'content-length')
  }

  let key: string
  try {
    key = readFileSync(credentials.keyFile, 'utf8')
  } catch {
    throw new Error('Không đọc được OCI API private key từ key_file.')
  }
  const signer = createSign('RSA-SHA256')
  signer.update(signingLines.join('\n'))
  signer.end()
  const signature = credentials.passPhrase
    ? signer.sign({ key, passphrase: credentials.passPhrase }, 'base64')
    : signer.sign(key, 'base64')
  headers.authorization =
    `Signature version="1",keyId="${credentials.tenancy}/${credentials.user}/${credentials.fingerprint}",` +
    `algorithm="rsa-sha256",headers="${signedHeaders.join(' ')}",signature="${signature}"`
  return { headers }
}

async function sendOciRequest<T>(
  credentials: OciCredentials,
  region: string,
  method: 'GET' | 'PUT',
  path: string,
  bodyValue?: unknown
): Promise<T> {
  if (!/^[a-z0-9-]+$/i.test(region)) throw new Error('OCI region không hợp lệ.')
  const url = new URL(`https://iaas.${region}.oraclecloud.com${path}`)
  const body = bodyValue === undefined ? null : JSON.stringify(bodyValue)
  const { headers } = buildAuthorization(credentials, method, url, body)

  const response = await new Promise<{ status: number; text: string }>((resolvePromise, reject) => {
    const req = httpsRequest(url, { method, headers }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, text }))
    })
    req.setTimeout(15_000, () => req.destroy(new Error('OCI API timeout.')))
    req.on('error', reject)
    if (body !== null) req.write(body)
    req.end()
  })

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401) throw new Error('OCI credential không hợp lệ hoặc API key chưa được cấp cho user.')
    if (response.status === 403) throw new Error('OCI user thiếu quyền đọc VNIC/Subnet hoặc manage Security List.')
    if (response.status === 404) throw new Error('OCI không tìm thấy VNIC/Subnet/Security List của VPS.')
    throw new Error(`OCI API lỗi HTTP ${response.status}.`)
  }

  if (!response.text.trim()) return {} as T
  try {
    return JSON.parse(response.text) as T
  } catch {
    throw new Error('OCI API trả dữ liệu không hợp lệ.')
  }
}

export function hasOciIngressRule(
  existing: OciIngressRule[],
  marker: string,
  startPort: number,
  endPort: number
): boolean {
  return existing.some((rule) =>
    rule.description === marker
    && rule.protocol === '6'
    && rule.source === '0.0.0.0/0'
    && rule.tcpOptions?.destinationPortRange?.min === startPort
    && rule.tcpOptions?.destinationPortRange?.max === endPort
  )
}

export function reconcileOciIngressRules(
  existing: OciIngressRule[],
  marker: string,
  startPort: number,
  endPort: number
): OciIngressRule[] {
  const preserved = existing.filter((rule) => rule.description !== marker)
  const managed: OciIngressRule = {
    description: marker,
    isStateless: false,
    protocol: '6',
    source: '0.0.0.0/0',
    sourceType: 'CIDR_BLOCK',
    tcpOptions: {
      destinationPortRange: { min: startPort, max: endPort }
    }
  }
  return [...preserved, managed]
}

export async function ensureOciSecurityListIngress(input: EnsureOciIngressInput): Promise<EnsureOciIngressResult> {
  if (!Number.isInteger(input.startPort) || !Number.isInteger(input.endPort) || input.startPort < 1 || input.endPort > 65535 || input.endPort < input.startPort) {
    throw new Error('Dải port OCI không hợp lệ.')
  }
  if (!/^ocid1\.vnic\./.test(input.vnicId)) throw new Error('Không xác định được OCI VNIC của VPS.')

  const profile = input.profile?.trim() || 'DEFAULT'
  const credentials = loadCredentials(input.configPath, profile)
  const region = input.region.trim() || credentials.region
  const vnic = await sendOciRequest<OciVnic>(
    credentials,
    region,
    'GET',
    `/20160918/vnics/${encodeURIComponent(input.vnicId)}`
  )
  if (!vnic.subnetId) throw new Error('OCI VNIC không trả về subnetId.')

  const subnet = await sendOciRequest<OciSubnet>(
    credentials,
    region,
    'GET',
    `/20160918/subnets/${encodeURIComponent(vnic.subnetId)}`
  )
  const securityListId = subnet.securityListIds?.[0]
  if (!securityListId) throw new Error('OCI subnet không có Security List để Page-Auto quản lý.')

  const securityList = await sendOciRequest<OciSecurityList>(
    credentials,
    region,
    'GET',
    `/20160918/securityLists/${encodeURIComponent(securityListId)}`
  )
  const existing = Array.isArray(securityList.ingressSecurityRules) ? securityList.ingressSecurityRules : []
  const marker = `${RULE_MARKER_PREFIX}${input.vnicId}`
  const next = reconcileOciIngressRules(existing, marker, input.startPort, input.endPort)
  const changed = JSON.stringify(existing) !== JSON.stringify(next)

  if (changed) {
    await sendOciRequest(
      credentials,
      region,
      'PUT',
      `/20160918/securityLists/${encodeURIComponent(securityListId)}`,
      { ingressSecurityRules: next }
    )
  }

  let verified = false
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const confirmed = await sendOciRequest<OciSecurityList>(
      credentials,
      region,
      'GET',
      `/20160918/securityLists/${encodeURIComponent(securityListId)}`
    )
    const rules = Array.isArray(confirmed.ingressSecurityRules) ? confirmed.ingressSecurityRules : []
    if (hasOciIngressRule(rules, marker, input.startPort, input.endPort)) {
      verified = true
      break
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  if (!verified) {
    throw new Error(`OCI API đã cập nhật nhưng chưa xác minh được ingress TCP ${input.startPort}-${input.endPort} trên Security List.`)
  }
  return { securityListId, changed, verified }
}
