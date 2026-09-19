export const PROXY_BUILDER_IPC = {
  auditVps: 'proxy-builder:audit-vps',
  provisionStart: 'proxy-builder:provision-start',
  provisionStatus: 'proxy-builder:provision-status',
  provisionCancel: 'proxy-builder:provision-cancel',
  runtimeControl: 'proxy-builder:runtime-control'
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

export type ProxyBuilderIpMode = 'ipv4' | 'ipv6' | 'both'
export type ProxyBuilderProxyAuth =
  | { type: 'none' }
  | { type: 'basic'; username: string; password: string }

export interface ProxyBuilderProvisionInput extends ProxyBuilderAuditInput {
  ipMode: ProxyBuilderIpMode
  count: number
  proxyAuth: ProxyBuilderProxyAuth
}

export type ProxyBuilderProvisionPhase =
  | 'connecting'
  | 'preflight'
  | 'provisioning'
  | 'service'
  | 'self_test'
  | 'complete'
  | 'rollback'

export type ProxyBuilderProvisionStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type ProxyBuilderProxyStatus = 'ready' | 'stopped' | 'error'

export interface ProxyBuilderProxyResult {
  id: string
  listenHost: string
  port: number
  type: 'ipv4' | 'ipv6'
  outboundIp: string
  status: ProxyBuilderProxyStatus
  authMode: 'none' | 'basic'
  username: string | null
}

export interface ProxyBuilderProvisionSnapshot {
  runId: string
  status: ProxyBuilderProvisionStatus
  phase: ProxyBuilderProvisionPhase
  percent: number
  message: string
  createdAt: string
  updatedAt: string
  results: ProxyBuilderProxyResult[]
}

export interface ProxyBuilderRunIdPayload { runId: string }

export type ProxyBuilderRuntimeAction = 'start' | 'stop' | 'restart'

export interface ProxyBuilderRuntimeControlInput extends ProxyBuilderAuditInput {
  action: ProxyBuilderRuntimeAction
}

export interface ProxyBuilderRuntimeControlResult {
  active: boolean
  message: string
}
