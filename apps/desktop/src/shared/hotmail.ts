export const HOTMAIL_OAUTH_STATUSES = ['missing', 'pending', 'valid', 'expired', 'error'] as const
export type HotmailOAuthStatus = (typeof HOTMAIL_OAUTH_STATUSES)[number]

export const HOTMAIL_MAIL_STATUSES = ['unknown', 'ready', 'error', 'needs_login'] as const
export type HotmailMailStatus = (typeof HOTMAIL_MAIL_STATUSES)[number]

export const HOTMAIL_PROFILE_STATUSES = ['not_configured', 'missing', 'available', 'running', 'in_use'] as const
export type HotmailProfileStatus = (typeof HOTMAIL_PROFILE_STATUSES)[number]

export const HOTMAIL_RUNTIME_STATUSES = ['idle', 'connecting', 'reading', 'opening', 'error'] as const
export type HotmailRuntimeStatus = (typeof HOTMAIL_RUNTIME_STATUSES)[number]

export const EMAIL_PROXY_MODES = ['direct', 'random_ipv4'] as const
export type EmailProxyMode = (typeof EMAIL_PROXY_MODES)[number]

export interface HotmailDashboardRow {
  accountId: number
  uid: string
  email: string | null
  emailPasswordMasked: string | null
  backupEmail: string | null
  oauthStatus: HotmailOAuthStatus
  oauthClientId: string | null
  hasRefreshToken: boolean
  oauthUpdatedAt: number | null
  lastTokenCheckAt: number | null
  mailStatus: HotmailMailStatus
  profileStatus: HotmailProfileStatus
  profileDirectory: string | null
  latestCode: string | null
  lastCodeAt: number | null
  lastCheckAt: number | null
  runtimeStatus: HotmailRuntimeStatus
  lastError: string | null
}

export interface HotmailSettingsView {
  profileRoot: string
  browserExecutable: string
  /**
   * Default public-client ID used when starting OAuth for an account that does not
   * yet have a canonical binding. Runtime mailbox reads use the per-account ID.
   */
  oauthClientId: string
  oauthTenant: string
  proxyMode: EmailProxyMode
  proxyCount: number
  proxyPreview: string[]
  currentProxy: string | null
}

export interface SaveHotmailSettingsInput {
  profileRoot: string
  browserExecutable: string
  /** Default public-client ID for starting/renewing per-account OAuth bindings. */
  oauthClientId: string
  oauthTenant: string
  proxyMode: EmailProxyMode
  /** Omit to preserve the current pool. Provide an empty string to clear it explicitly. */
  proxyListText?: string
}

export interface HotmailAccountPayload {
  accountId: number
}

export interface HotmailBatchPayload {
  accountIds: number[]
}

export interface HotmailOAuthStartResult {
  accountId: number
  started: boolean
  userCode: string | null
  verificationUri: string | null
  expiresAt: number | null
  message: string
}

export type HotmailActionStatus = 'success' | 'error' | 'started' | 'already_open' | 'missing_profile' | 'profile_in_use'

export interface HotmailActionResult {
  accountId: number
  status: HotmailActionStatus
  message: string
  code?: string | null
  receivedAt?: number | null
}

export interface HotmailBatchResult {
  results: HotmailActionResult[]
}

export interface HotmailBrowserOpenResult extends HotmailActionResult {
  profileDirectory: string | null
  attached: boolean
  proxyManagedExternally: boolean
}

export interface HotmailProxyStatus {
  mode: EmailProxyMode
  poolSize: number
  currentProxy: string | null
  activeSessions: number
  message: string
}

export interface HotmailProxyTestResult {
  ok: boolean
  proxy: string | null
  publicIp: string | null
  message: string
}

export interface HotmailProfileInspection {
  status: HotmailProfileStatus
  profileDirectory: string | null
  cdpEndpoint: string | null
}
