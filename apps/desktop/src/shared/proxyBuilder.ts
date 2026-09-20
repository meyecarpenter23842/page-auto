export const PROXY_BUILDER_IPC = {
  pickPrivateKey: 'proxy-builder:pick-private-key',
  pickOciConfig: 'proxy-builder:pick-oci-config',
  auditVps: 'proxy-builder:audit-vps',
  provisionStart: 'proxy-builder:provision-start',
  provisionStatus: 'proxy-builder:provision-status',
  provisionCancel: 'proxy-builder:provision-cancel',
  runtimeControl: 'proxy-builder:runtime-control',
  checkerStart: 'proxy-builder:checker-start',
  checkerStatus: 'proxy-builder:checker-status',
  checkerCancel: 'proxy-builder:checker-cancel',
  inventoryList: 'proxy-center:inventory-list',
  inventoryUpsert: 'proxy-center:inventory-upsert',
  inventoryCheck: 'proxy-center:inventory-check',
  inventoryDelete: 'proxy-center:inventory-delete',
  accountBindingsList: 'proxy-center:account-bindings-list',
  accountBindingsAssign: 'proxy-center:account-bindings-assign',
  accountBindingsClear: 'proxy-center:account-bindings-clear'
} as const

export type ProxyBuilderSshAuth =
  | { type: 'password'; password: string }
  | { type: 'key'; privateKey: string; privateKeyPath?: string; passphrase?: string }

export interface ProxyBuilderPrivateKeyPickResult {
  cancelled: boolean
  path?: string
  fileName?: string
}

export interface ProxyBuilderOciConfigPickResult {
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
  cloudProvider: 'oci' | null
  cloudRegion: string | null
}

export type ProxyBuilderSshProbeName = 'auth_true' | 'shell_empty' | 'discovery'

export interface ProxyBuilderSshProbeDiagnostic {
  name: ProxyBuilderSshProbeName
  remoteCommand: string
  args: string[]
  exitCode: number
  offeredFingerprints: string[]
  acceptedFingerprints: string[]
  authenticated: boolean
  stderr: string
}

export interface ProxyBuilderSshDiagnostic {
  executable: string
  version: string
  environment: {
    SystemRoot: string | null
    WINDIR: string | null
    PATH: string | null
    USERPROFILE: string | null
    HOME: string | null
  }
  keyPath: string
  keyExists: boolean
  keySize: number | null
  keyFingerprint: string | null
  probes: ProxyBuilderSshProbeDiagnostic[]
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
  | { ok: true; capability: ProxyBuilderCapability; diagnostic?: ProxyBuilderSshDiagnostic }
  | { ok: false; code: ProxyBuilderAuditErrorCode; message: string; diagnostic?: ProxyBuilderSshDiagnostic }

export type ProxyBuilderIpMode = 'ipv4' | 'ipv6' | 'both'
export type ProxyBuilderProxyAuth =
  | { type: 'none' }
  | { type: 'basic'; username: string; password: string }

export interface ProxyBuilderOciCloudFirewallConfig {
  provider: 'oci'
  configPath: string
  profile?: string
}

export interface ProxyBuilderProvisionInput extends ProxyBuilderAuditInput {
  ipMode: ProxyBuilderIpMode
  count: number
  proxyAuth: ProxyBuilderProxyAuth
  cloudFirewall?: ProxyBuilderOciCloudFirewallConfig
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

export interface ProxyBuilderCloudFirewallAction {
  provider: 'oci'
  status: 'required' | 'failed'
  message: string
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
  cloudFirewallAction?: ProxyBuilderCloudFirewallAction
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


export type ProxyCenterInventoryStatus = 'unknown' | 'live' | 'dead'
export type ProxyCenterIpFamily = 'unknown' | 'ipv4' | 'ipv6'
export type ProxyCenterSourceKind = 'import' | 'builder'

export interface ProxyCenterInventoryRecord {
  id: number
  host: string
  port: number
  username: string | null
  maskedProxy: string
  ipFamily: ProxyCenterIpFamily
  outboundIp: string | null
  status: ProxyCenterInventoryStatus
  latencyMs: number | null
  lastError: string | null
  sourceKind: ProxyCenterSourceKind
  sourceLabel: string | null
  lastCheckedAt: number | null
  assignedAccountCount: number
  createdAt: number
  updatedAt: number
}

export interface ProxyCenterInventoryUpsertItem {
  rawProxy: string
  ipFamily?: ProxyCenterIpFamily
  outboundIp?: string | null
  status?: ProxyCenterInventoryStatus
  latencyMs?: number | null
  lastError?: string | null
  sourceKind?: ProxyCenterSourceKind
  sourceLabel?: string | null
  lastCheckedAt?: number | null
}

export interface ProxyCenterInventoryUpsertInput {
  items: ProxyCenterInventoryUpsertItem[]
}

export interface ProxyCenterInventoryUpsertResult {
  inserted: number
  updated: number
  errors: string[]
  records: ProxyCenterInventoryRecord[]
}

export interface ProxyCenterInventoryDeleteInput {
  ids: number[]
}

export interface ProxyCenterAccountBinding {
  accountId: number
  uid: string
  name: string | null
  category: string | null
  accountStatus: string
  inventoryId: number | null
  inventoryStatus: ProxyCenterInventoryStatus | null
  maskedProxy: string | null
  duplicateBindingCount: number
}

export interface ProxyCenterAssignInput {
  proxyId: number
  accountIds: number[]
}

export interface ProxyCenterAccountIdsInput {
  accountIds: number[]
}
