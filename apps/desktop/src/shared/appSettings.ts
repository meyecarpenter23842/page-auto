export const APP_SETTINGS_SCHEMA_VERSION = 1 as const
export const APP_SETTINGS_STORAGE_KEY = 'settings.app'

export const BROWSER_MODES = ['visible', 'minimized'] as const
export type BrowserMode = (typeof BROWSER_MODES)[number]

export const FACEBOOK_LOCALES = ['auto', 'vi-VN', 'en-US'] as const
export type FacebookLocale = (typeof FACEBOOK_LOCALES)[number]

export const SESSION_FAILURE_POLICIES = ['needs_login_continue', 'needs_login_stop'] as const
export type SessionFailurePolicy = (typeof SESSION_FAILURE_POLICIES)[number]

export const LOG_LEVELS = ['error', 'normal', 'debug'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const USER_AGENT_POLICIES = ['account', 'browser_default'] as const
export type UserAgentPolicy = (typeof USER_AGENT_POLICIES)[number]

export const TIMEZONE_POLICIES = ['automatic', 'custom'] as const
export type TimezonePolicy = (typeof TIMEZONE_POLICIES)[number]

export const DEFAULT_BROWSER_ACTION_DELAY_MIN_MS = 1000
export const DEFAULT_BROWSER_ACTION_DELAY_MAX_MS = 3000

export type LogRetentionDays = 7 | 30 | 90 | null

export interface BrowserSettings {
  executablePath: string | null
  mode: BrowserMode
  windowWidth: number
  windowHeight: number
  disableImageLoading: boolean
  muteAudio: boolean
  disableGpu: boolean
  startupDelayMs: number
  startupTimeoutMs: number
  navigationTimeoutMs: number
  pageSettleDelayMs: number
  /** Random pacing between major Facebook UI actions. Optional for legacy fixtures/config. */
  actionDelayMinMs?: number
  /** Random pacing between major Facebook UI actions. Optional for legacy fixtures/config. */
  actionDelayMaxMs?: number
  closeDelayMs: number
  maxLifetimeMinutes: number
}

export interface SessionSettings {
  validateBeforeRun: boolean
  validateAfterRun: boolean
  facebookLocale: FacebookLocale
  onSessionExpired: SessionFailurePolicy
  onCheckpoint: SessionFailurePolicy
}

export interface NetworkSettings {
  checkProxyBeforeRun: boolean
  proxyConnectionTimeoutMs: number
  networkTimeoutMs: number
  proxyRetryCount: number
  abortAccountOnProxyFailure: boolean
}

export interface RuntimeSettings {
  maxActivePageTabs: number
  browserLaunchSpacingMs: number
  maxAccountRuntimeSeconds: number
  browserCrashRetryCount: number
  navigationRetryCount: number
  safeActionRetryCount: number
  retryDelayMs: number
  consecutiveFailureLimit: number
}

export interface LoggingSettings {
  level: LogLevel
  retentionDays: LogRetentionDays
  autoCleanup: boolean
  screenshotOnFailure: boolean
  saveCurrentUrlOnFailure: boolean
  playwrightTrace: boolean
}

export interface AdvancedSettings {
  clearBrowserCacheAfterRun: boolean
  cleanupTemporaryProfileAfterFailure: boolean
  userAgentPolicy: UserAgentPolicy
  timezonePolicy: TimezonePolicy
  customTimezone: string | null
}

export interface AppSettings {
  schemaVersion: typeof APP_SETTINGS_SCHEMA_VERSION
  browser: BrowserSettings
  session: SessionSettings
  network: NetworkSettings
  runtime: RuntimeSettings
  logging: LoggingSettings
  advanced: AdvancedSettings
}

export interface AppSettingsPatch {
  browser?: Partial<BrowserSettings>
  session?: Partial<SessionSettings>
  network?: Partial<NetworkSettings>
  runtime?: Partial<RuntimeSettings>
  logging?: Partial<LoggingSettings>
  advanced?: Partial<AdvancedSettings>
}

export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = {
  schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
  browser: {
    executablePath: null,
    mode: 'visible',
    windowWidth: 1280,
    windowHeight: 800,
    disableImageLoading: false,
    muteAudio: true,
    disableGpu: false,
    startupDelayMs: 2000,
    startupTimeoutMs: 30000,
    navigationTimeoutMs: 30000,
    pageSettleDelayMs: 1500,
    actionDelayMinMs: DEFAULT_BROWSER_ACTION_DELAY_MIN_MS,
    actionDelayMaxMs: DEFAULT_BROWSER_ACTION_DELAY_MAX_MS,
    closeDelayMs: 0,
    maxLifetimeMinutes: 60
  },
  session: {
    validateBeforeRun: true,
    validateAfterRun: false,
    facebookLocale: 'auto',
    onSessionExpired: 'needs_login_continue',
    onCheckpoint: 'needs_login_continue'
  },
  network: {
    checkProxyBeforeRun: false,
    proxyConnectionTimeoutMs: 15000,
    networkTimeoutMs: 30000,
    proxyRetryCount: 1,
    abortAccountOnProxyFailure: true
  },
  runtime: {
    maxActivePageTabs: 3,
    browserLaunchSpacingMs: 2000,
    maxAccountRuntimeSeconds: 600,
    browserCrashRetryCount: 1,
    navigationRetryCount: 2,
    safeActionRetryCount: 1,
    retryDelayMs: 3000,
    consecutiveFailureLimit: 3
  },
  logging: {
    level: 'normal',
    retentionDays: 30,
    autoCleanup: true,
    screenshotOnFailure: true,
    saveCurrentUrlOnFailure: true,
    playwrightTrace: false
  },
  advanced: {
    clearBrowserCacheAfterRun: false,
    cleanupTemporaryProfileAfterFailure: false,
    userAgentPolicy: 'account',
    timezonePolicy: 'automatic',
    customTimezone: null
  }
}

const TOP_LEVEL_KEYS = ['browser', 'session', 'network', 'runtime', 'logging', 'advanced'] as const
const BROWSER_KEYS = [
  'executablePath', 'mode', 'windowWidth', 'windowHeight', 'disableImageLoading', 'muteAudio', 'disableGpu',
  'startupDelayMs', 'startupTimeoutMs', 'navigationTimeoutMs', 'pageSettleDelayMs', 'actionDelayMinMs',
  'actionDelayMaxMs', 'closeDelayMs', 'maxLifetimeMinutes'
] as const
const SESSION_KEYS = ['validateBeforeRun', 'validateAfterRun', 'facebookLocale', 'onSessionExpired', 'onCheckpoint'] as const
const NETWORK_KEYS = ['checkProxyBeforeRun', 'proxyConnectionTimeoutMs', 'networkTimeoutMs', 'proxyRetryCount', 'abortAccountOnProxyFailure'] as const
const RUNTIME_KEYS = [
  'maxActivePageTabs', 'browserLaunchSpacingMs', 'maxAccountRuntimeSeconds', 'browserCrashRetryCount',
  'navigationRetryCount', 'safeActionRetryCount', 'retryDelayMs', 'consecutiveFailureLimit'
] as const
const LOGGING_KEYS = ['level', 'retentionDays', 'autoCleanup', 'screenshotOnFailure', 'saveCurrentUrlOnFailure', 'playwrightTrace'] as const
const ADVANCED_KEYS = ['clearBrowserCacheAfterRun', 'cleanupTemporaryProfileAfterFailure', 'userAgentPolicy', 'timezonePolicy', 'customTimezone'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKnownKeys(section: string, value: Record<string, unknown>, allowedKeys: readonly string[]): void {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.includes(key))
  if (unknownKey) throw new Error(`Unknown setting: ${section}.${unknownKey}`)
}

function assertBoolean(path: string, value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`)
}

function assertInteger(path: string, value: unknown, min: number, max: number): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${path} must be an integer between ${min} and ${max}.`)
  }
}

function assertEnum<T extends string>(path: string, value: unknown, allowed: readonly T[]): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${path} has an unsupported value.`)
  }
}

function assertNullableString(path: string, value: unknown, maxLength: number): asserts value is string | null {
  if (value === null) return
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${path} must be null or a string up to ${maxLength} characters.`)
  }
}

export function browserActionDelayRange(settings: BrowserSettings): { minMs: number; maxMs: number } {
  const minMs = settings.actionDelayMinMs ?? DEFAULT_BROWSER_ACTION_DELAY_MIN_MS
  const maxMs = settings.actionDelayMaxMs ?? DEFAULT_BROWSER_ACTION_DELAY_MAX_MS
  return { minMs, maxMs }
}

export function randomBrowserActionDelayMs(settings: BrowserSettings, random: () => number = Math.random): number {
  const { minMs, maxMs } = browserActionDelayRange(settings)
  if (maxMs <= minMs) return minMs
  const sample = Math.max(0, Math.min(1, random()))
  return Math.round(minMs + ((maxMs - minMs) * sample))
}

export function cloneDefaultAppSettings(): AppSettings {
  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    browser: { ...DEFAULT_APP_SETTINGS.browser },
    session: { ...DEFAULT_APP_SETTINGS.session },
    network: { ...DEFAULT_APP_SETTINGS.network },
    runtime: { ...DEFAULT_APP_SETTINGS.runtime },
    logging: { ...DEFAULT_APP_SETTINGS.logging },
    advanced: { ...DEFAULT_APP_SETTINGS.advanced }
  }
}

export function assertValidAppSettingsPatch(value: unknown): asserts value is AppSettingsPatch {
  if (!isRecord(value)) throw new Error('Settings update must be an object.')
  assertKnownKeys('settings', value, TOP_LEVEL_KEYS)

  const sections: Array<[string, unknown, readonly string[]]> = [
    ['browser', value.browser, BROWSER_KEYS],
    ['session', value.session, SESSION_KEYS],
    ['network', value.network, NETWORK_KEYS],
    ['runtime', value.runtime, RUNTIME_KEYS],
    ['logging', value.logging, LOGGING_KEYS],
    ['advanced', value.advanced, ADVANCED_KEYS]
  ]

  for (const [name, section, keys] of sections) {
    if (section === undefined) continue
    if (!isRecord(section)) throw new Error(`${name} settings must be an object.`)
    assertKnownKeys(name, section, keys)
  }
}

export function mergeAppSettings(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    browser: { ...current.browser, ...(patch.browser ?? {}) },
    session: { ...current.session, ...(patch.session ?? {}) },
    network: { ...current.network, ...(patch.network ?? {}) },
    runtime: { ...current.runtime, ...(patch.runtime ?? {}) },
    logging: { ...current.logging, ...(patch.logging ?? {}) },
    advanced: { ...current.advanced, ...(patch.advanced ?? {}) }
  }
}

export function assertValidAppSettings(settings: AppSettings): void {
  if (settings.schemaVersion !== APP_SETTINGS_SCHEMA_VERSION) {
    throw new Error(`Unsupported settings schema version: ${String(settings.schemaVersion)}`)
  }

  assertNullableString('browser.executablePath', settings.browser.executablePath, 2048)
  assertEnum('browser.mode', settings.browser.mode, BROWSER_MODES)
  assertInteger('browser.windowWidth', settings.browser.windowWidth, 640, 7680)
  assertInteger('browser.windowHeight', settings.browser.windowHeight, 480, 4320)
  assertBoolean('browser.disableImageLoading', settings.browser.disableImageLoading)
  assertBoolean('browser.muteAudio', settings.browser.muteAudio)
  assertBoolean('browser.disableGpu', settings.browser.disableGpu)
  assertInteger('browser.startupDelayMs', settings.browser.startupDelayMs, 0, 300000)
  assertInteger('browser.startupTimeoutMs', settings.browser.startupTimeoutMs, 1000, 300000)
  assertInteger('browser.navigationTimeoutMs', settings.browser.navigationTimeoutMs, 1000, 300000)
  assertInteger('browser.pageSettleDelayMs', settings.browser.pageSettleDelayMs, 0, 120000)
  const actionDelay = browserActionDelayRange(settings.browser)
  assertInteger('browser.actionDelayMinMs', actionDelay.minMs, 0, 30000)
  assertInteger('browser.actionDelayMaxMs', actionDelay.maxMs, 0, 30000)
  if (actionDelay.minMs > actionDelay.maxMs) {
    throw new Error('browser.actionDelayMinMs must be less than or equal to browser.actionDelayMaxMs.')
  }
  assertInteger('browser.closeDelayMs', settings.browser.closeDelayMs, 0, 120000)
  assertInteger('browser.maxLifetimeMinutes', settings.browser.maxLifetimeMinutes, 1, 1440)

  assertBoolean('session.validateBeforeRun', settings.session.validateBeforeRun)
  assertBoolean('session.validateAfterRun', settings.session.validateAfterRun)
  assertEnum('session.facebookLocale', settings.session.facebookLocale, FACEBOOK_LOCALES)
  assertEnum('session.onSessionExpired', settings.session.onSessionExpired, SESSION_FAILURE_POLICIES)
  assertEnum('session.onCheckpoint', settings.session.onCheckpoint, SESSION_FAILURE_POLICIES)

  assertBoolean('network.checkProxyBeforeRun', settings.network.checkProxyBeforeRun)
  assertInteger('network.proxyConnectionTimeoutMs', settings.network.proxyConnectionTimeoutMs, 1000, 300000)
  assertInteger('network.networkTimeoutMs', settings.network.networkTimeoutMs, 1000, 300000)
  assertInteger('network.proxyRetryCount', settings.network.proxyRetryCount, 0, 10)
  assertBoolean('network.abortAccountOnProxyFailure', settings.network.abortAccountOnProxyFailure)

  assertInteger('runtime.maxActivePageTabs', settings.runtime.maxActivePageTabs, 1, 20)
  assertInteger('runtime.browserLaunchSpacingMs', settings.runtime.browserLaunchSpacingMs, 0, 120000)
  assertInteger('runtime.maxAccountRuntimeSeconds', settings.runtime.maxAccountRuntimeSeconds, 30, 86400)
  assertInteger('runtime.browserCrashRetryCount', settings.runtime.browserCrashRetryCount, 0, 10)
  assertInteger('runtime.navigationRetryCount', settings.runtime.navigationRetryCount, 0, 10)
  assertInteger('runtime.safeActionRetryCount', settings.runtime.safeActionRetryCount, 0, 10)
  assertInteger('runtime.retryDelayMs', settings.runtime.retryDelayMs, 0, 120000)
  assertInteger('runtime.consecutiveFailureLimit', settings.runtime.consecutiveFailureLimit, 1, 100)

  assertEnum('logging.level', settings.logging.level, LOG_LEVELS)
  if (![7, 30, 90, null].includes(settings.logging.retentionDays)) {
    throw new Error('logging.retentionDays must be 7, 30, 90, or null.')
  }
  assertBoolean('logging.autoCleanup', settings.logging.autoCleanup)
  assertBoolean('logging.screenshotOnFailure', settings.logging.screenshotOnFailure)
  assertBoolean('logging.saveCurrentUrlOnFailure', settings.logging.saveCurrentUrlOnFailure)
  assertBoolean('logging.playwrightTrace', settings.logging.playwrightTrace)

  assertBoolean('advanced.clearBrowserCacheAfterRun', settings.advanced.clearBrowserCacheAfterRun)
  assertBoolean('advanced.cleanupTemporaryProfileAfterFailure', settings.advanced.cleanupTemporaryProfileAfterFailure)
  assertEnum('advanced.userAgentPolicy', settings.advanced.userAgentPolicy, USER_AGENT_POLICIES)
  assertEnum('advanced.timezonePolicy', settings.advanced.timezonePolicy, TIMEZONE_POLICIES)
  assertNullableString('advanced.customTimezone', settings.advanced.customTimezone, 128)
  if (settings.advanced.timezonePolicy === 'custom' && !settings.advanced.customTimezone?.trim()) {
    throw new Error('advanced.customTimezone is required when timezonePolicy is custom.')
  }
}

function buildPatchFromStored(value: Record<string, unknown>): AppSettingsPatch {
  const patch: AppSettingsPatch = {}
  for (const key of TOP_LEVEL_KEYS) {
    const section = value[key]
    if (isRecord(section)) {
      ;(patch as Record<string, unknown>)[key] = section
    }
  }
  return patch
}

export function parseStoredAppSettings(raw: string | undefined): AppSettings {
  if (!raw) return cloneDefaultAppSettings()

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return cloneDefaultAppSettings()
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== APP_SETTINGS_SCHEMA_VERSION) {
      return cloneDefaultAppSettings()
    }

    const patch = buildPatchFromStored(parsed)
    assertValidAppSettingsPatch(patch)
    const settings = mergeAppSettings(cloneDefaultAppSettings(), patch)
    assertValidAppSettings(settings)
    return settings
  } catch {
    return cloneDefaultAppSettings()
  }
}
