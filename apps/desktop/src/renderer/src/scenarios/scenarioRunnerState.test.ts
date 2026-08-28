import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENARIO_RUNNER_SETTINGS, moveId, normalizeScenarioRunnerState } from './scenarioRunnerState'

describe('scenarioRunnerState', () => {
  it('normalizes ids and keeps enabled accounts inside selected accounts', () => {
    expect(normalizeScenarioRunnerState({ selectedAccountIds: [3, 3, -1, '4'], enabledAccountIds: [4, 9], selectedScenarioIds: [8, 7, 8], settings: {} })).toMatchObject({ selectedAccountIds: [3, 4], enabledAccountIds: [4], selectedScenarioIds: [8, 7] })
  })

  it('clamps numeric settings and excludes transient proxy input from persisted settings', () => {
    const result = normalizeScenarioRunnerState({ settings: { parallelAccounts: 0, actionDelayMinSeconds: 40, actionDelayMaxSeconds: 2, proxyText: 'transient-value' } })
    expect(result.settings.parallelAccounts).toBe(1)
    expect(result.settings.actionDelayMaxSeconds).toBe(40)
    expect('proxyText' in result.settings).toBe(false)
    expect(result.settings.repeatCount).toBe(DEFAULT_SCENARIO_RUNNER_SETTINGS.repeatCount)
  })

  it('moves selected scenarios without mutating the source list', () => {
    const source = [10, 20, 30]
    expect(moveId(source, 20, 'up')).toEqual([20, 10, 30])
    expect(moveId(source, 20, 'down')).toEqual([10, 30, 20])
    expect(source).toEqual([10, 20, 30])
  })
})
