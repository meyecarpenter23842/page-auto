export const PROXY_BUILDER_IPC = {
  auditVps: 'proxy-builder:audit-vps'
} as const

export type ProxyBuilderSshAuth =
  | { type: 'password'; password: string }
  | { type: 'key'; privateKey: string }

export interface ProxyBuilderAuditInput {
  host: string
  username: string
  auth: ProxyBuilderSshAuth
  startPort: number
}

export interface ProxyBuilderCapability {
  os: string
  defaultInterface: string | null
  publicIpv4: string | null
  ipv4Addresses: string[]
  ipv6Addresses: string[]
  ipv6Prefix: string | null
  ipv6Gateway: string | null
  supportsIpv4: boolean
  supportsIpv6: boolean
  sourceBindIpv4: boolean
  sourceBindIpv6: boolean
  startPortAvailable: boolean
}

export type ProxyBuilderAuditErrorCode =
  | 'invalid_input'
  | 'auth_failed'
  | 'connection_failed'
  | 'timeout'
  | 'command_failed'
  | 'unknown'

export type ProxyBuilderAuditResult =
  | { ok: true; capability: ProxyBuilderCapability }
  | { ok: false; code: ProxyBuilderAuditErrorCode; message: string }
