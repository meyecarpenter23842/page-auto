export const HOTMAIL_OAUTH_STATUSES = ['missing', 'pending', 'valid', 'expired', 'error'] as const
export type HotmailOAuthStatus = (typeof HOTMAIL_OAUTH_STATUSES)[number]

export const HOTMAIL_MAIL_STATUSES = ['unknown', 'ready', 'error'] as const
export type HotmailMailStatus = (typeof HOTMAIL_MAIL_STATUSES)[number]

export const HOTMAIL_PROFILE_STATUSES = ['unconfigured', 'missing', 'available', 'running', 'in_use', 'error'] as const
export type HotmailProfileStatus = (typeof HOTMAIL_PROFILE_STATUSES)[number]

export const HOTMAIL_RUNTIME_STATUSES = ['idle', 'running', 'success', 'error'] as const
export type HotmailRuntimeStatus = (typeof HOTMAIL_RUNTIME_STATUSES)[number]

export const EMAIL_PROXY_MODES = ['direct', 'random_ipv4'] as const
export type EmailProxyMode = (typeof EMAIL_PROXY_MODES)[number]

export interface HotmailSettings {
  profileRoot: string | null
  browserExecutablePath: string | null
  oauthClientId: string | null
  oauthTenant: string
  proxyMode: EmailProxyMode
  proxyList: string[]
  currentProxy: string | null
  updatedAt: number | null
}

export interface SaveHotmailSettingsInput {
  profileRoot: string | null
  browserExecutablePath: string | null
  oauthClientId: string | null
  oauthTenant: string
  proxyMode: EmailProxyMode
  proxyList: string[]
}

export interface HotmailDashboardRow {
  accountId: number
  uid: string
  email: string | null
  emailPasswordMasked: string | null
  backupEmail: string | null
  oauthStatus: HotmailOAuthStatus
  mailStatus: HotmailMailStatus
  profileStatus: HotmailProfileStatus
  latestCode: string | null
  lastCodeAt: number | null
  lastCheckAt: number | null
  runtimeStatus: HotmailRuntimeStatus
  runtimeMessage: string | null
}

export interface HotmailAccountPayload {
  accountId: number
}

export interface HotmailAccountsPayload {
  accountIds: number[]
}

export interface HotmailOAuthResult {
  status: HotmailOAuthStatus
  userCode: string | null
  verificationUri: string | null
  expiresAt: number | null
  message: string
}

export interface HotmailActionItemResult {
  accountId: number
  ok: boolean
  code: string | null
  message: string
}

export interface HotmailBatchActionResult {
  items: HotmailActionItemResult[]
}

export interface HotmailOpenMailResult {
  accountId: number
  status: 'started' | 'attached' | 'already_open' | 'error'
  profileDirectory: string | null
  proxyManagedExternally: boolean
  message: string
}

export interface HotmailProxyResult {
  ok: boolean
  mode: EmailProxyMode
  currentProxy: string | null
  externalIp: string | null
  message: string
}
