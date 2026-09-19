export const PROXY_BUILDER_IPC = {
  pickPrivateKey: 'proxy-builder:pick-private-key',
  auditVps: 'proxy-builder:audit-vps',
  provisionStart: 'proxy-builder:provision-start',
  provisionStatus: 'proxy-builder:provision-status',
  provisionCancel: 'proxy-builder:provision-cancel',
  runtimeControl: 'proxy-builder:runtime-control',
  checkerStart: 'proxy-builder:checker-start',
  checkerStatus: 'proxy-builder:checker-status',
  checkerCancel: 'proxy-builder:checker-cancel'
} as const

export type ProxyBuilderSshAuth =
  | { type: 'password'; password: string }
  | { type: 'key'; privateKey: string; privateKeyPath?: string; passphrase?: string }

export interface ProxyBuilderPrivateKeyPickResult {
  cancelled: boolean
  path?: string
  fileName?: string
}

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
  | 'key_invalid'
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

export interface ProxyBuilderCheckerStartInput {
  proxies: string[]
  concurrency?: number
  timeoutMs?: number
  retries?: number
}

export type ProxyBuilderCheckerJobStatus = 'running' | 'completed' | 'cancelled'
export type ProxyBuilderCheckerResultStatus = 'pending' | 'live' | 'dead'

export interface ProxyBuilderCheckerResult {
  index: number
  maskedProxy: string
  status: ProxyBuilderCheckerResultStatus
  outboundIp: string | null
  type: 'ipv4' | 'ipv6' | null
  latencyMs: number | null
  error: string | null
}

export interface ProxyBuilderCheckerSnapshot {
  runId: string
  status: ProxyBuilderCheckerJobStatus
  total: number
  completed: number
  live: number
  dead: number
  createdAt: string
  updatedAt: string
  results: ProxyBuilderCheckerResult[]
}
