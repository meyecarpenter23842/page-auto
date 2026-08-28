export interface ScenarioRunnerSettings {
  randomScenarios: boolean
  randomScenarioCount: number
  secondaryProfile: boolean
  secondaryProfileCount: number
  parallelAccounts: number
  actionDelayMinSeconds: number
  actionDelayMaxSeconds: number
  pauseAfterActions: number
  pauseMinutes: number
  pauseOnErrorMinutes: number
  repeat: boolean
  repeatCount: number
  pauseAfterAccounts: number
  pauseAfterAccountsMinutes: number
  proxyResetEnabled: boolean
  proxyThreadsPerProxy: number
  dcomResetEnabled: boolean
  dcomEveryAccounts: number
  startIndex: number
  limitPerAccount: number
}

export interface ScenarioRunnerPersistedState {
  selectedAccountIds: number[]
  enabledAccountIds: number[]
  selectedScenarioIds: number[]
  settings: ScenarioRunnerSettings
}

export const DEFAULT_SCENARIO_RUNNER_SETTINGS: ScenarioRunnerSettings = {
  randomScenarios: false,
  randomScenarioCount: 1,
  secondaryProfile: false,
  secondaryProfileCount: 1,
  parallelAccounts: 1,
  actionDelayMinSeconds: 5,
  actionDelayMaxSeconds: 10,
  pauseAfterActions: 100,
  pauseMinutes: 30,
  pauseOnErrorMinutes: 60,
  repeat: false,
  repeatCount: 1,
  pauseAfterAccounts: 999,
  pauseAfterAccountsMinutes: 30,
  proxyResetEnabled: false,
  proxyThreadsPerProxy: 4,
  dcomResetEnabled: false,
  dcomEveryAccounts: 1,
  startIndex: 0,
  limitPerAccount: 1000
}

export const DEFAULT_SCENARIO_RUNNER_STATE: ScenarioRunnerPersistedState = {
  selectedAccountIds: [],
  enabledAccountIds: [],
  selectedScenarioIds: [],
  settings: DEFAULT_SCENARIO_RUNNER_SETTINGS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const result: number[] = []
  const seen = new Set<number>()
  for (const item of value) {
    const id = Number(item)
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

export function normalizeScenarioRunnerSettings(value: unknown): ScenarioRunnerSettings {
  const source = isRecord(value) ? value : {}
  const defaults = DEFAULT_SCENARIO_RUNNER_SETTINGS
  const actionDelayMinSeconds = clampInteger(source.actionDelayMinSeconds, defaults.actionDelayMinSeconds, 0, 3600)
  const actionDelayMaxSeconds = Math.max(
    actionDelayMinSeconds,
    clampInteger(source.actionDelayMaxSeconds, defaults.actionDelayMaxSeconds, 0, 3600)
  )

  return {
    randomScenarios: bool(source.randomScenarios, defaults.randomScenarios),
    randomScenarioCount: clampInteger(source.randomScenarioCount, defaults.randomScenarioCount, 1, 1000),
    secondaryProfile: bool(source.secondaryProfile, defaults.secondaryProfile),
    secondaryProfileCount: clampInteger(source.secondaryProfileCount, defaults.secondaryProfileCount, 1, 1000),
    parallelAccounts: clampInteger(source.parallelAccounts, defaults.parallelAccounts, 1, 100),
    actionDelayMinSeconds,
    actionDelayMaxSeconds,
    pauseAfterActions: clampInteger(source.pauseAfterActions, defaults.pauseAfterActions, 1, 100000),
    pauseMinutes: clampInteger(source.pauseMinutes, defaults.pauseMinutes, 0, 1440),
    pauseOnErrorMinutes: clampInteger(source.pauseOnErrorMinutes, defaults.pauseOnErrorMinutes, 0, 1440),
    repeat: bool(source.repeat, defaults.repeat),
    repeatCount: clampInteger(source.repeatCount, defaults.repeatCount, 1, 10000),
    pauseAfterAccounts: clampInteger(source.pauseAfterAccounts, defaults.pauseAfterAccounts, 1, 100000),
    pauseAfterAccountsMinutes: clampInteger(source.pauseAfterAccountsMinutes, defaults.pauseAfterAccountsMinutes, 0, 1440),
    proxyResetEnabled: bool(source.proxyResetEnabled, defaults.proxyResetEnabled),
    proxyThreadsPerProxy: clampInteger(source.proxyThreadsPerProxy, defaults.proxyThreadsPerProxy, 1, 100),
    dcomResetEnabled: bool(source.dcomResetEnabled, defaults.dcomResetEnabled),
    dcomEveryAccounts: clampInteger(source.dcomEveryAccounts, defaults.dcomEveryAccounts, 1, 100000),
    startIndex: clampInteger(source.startIndex, defaults.startIndex, 0, 1000000),
    limitPerAccount: clampInteger(source.limitPerAccount, defaults.limitPerAccount, 1, 1000000)
  }
}

export function normalizeScenarioRunnerState(value: unknown): ScenarioRunnerPersistedState {
  if (!isRecord(value)) return { ...DEFAULT_SCENARIO_RUNNER_STATE, settings: { ...DEFAULT_SCENARIO_RUNNER_SETTINGS } }
  const selectedAccountIds = normalizeIdList(value.selectedAccountIds)
  const enabledSet = new Set(normalizeIdList(value.enabledAccountIds))
  return {
    selectedAccountIds,
    enabledAccountIds: selectedAccountIds.filter((id) => enabledSet.has(id)),
    selectedScenarioIds: normalizeIdList(value.selectedScenarioIds),
    settings: normalizeScenarioRunnerSettings(value.settings)
  }
}

export function moveId(items: readonly number[], id: number, direction: 'up' | 'down'): number[] {
  const currentIndex = items.indexOf(id)
  if (currentIndex < 0) return [...items]
  const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (nextIndex < 0 || nextIndex >= items.length) return [...items]
  const result = [...items]
  const item = result[currentIndex]
  if (item === undefined) return result
  result.splice(currentIndex, 1)
  result.splice(nextIndex, 0, item)
  return result
}
