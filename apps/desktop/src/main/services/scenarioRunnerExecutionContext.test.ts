import { describe, expect, it } from 'vitest'
import {
  resolveScenarioRunnerExecutionContext,
  scenarioRunnerActor,
  type ScenarioRunnerPageBinding
} from './scenarioRunnerExecutionContext'

const PAGE: ScenarioRunnerPageBinding = {
  pageTabId: 17,
  pageUid: '123456789',
  enabledAccountIds: [1, 2]
}

describe('scenarioRunnerExecutionContext', () => {
  it('keeps the existing Profile runner as the backward-compatible default', () => {
    const context = resolveScenarioRunnerExecutionContext(undefined, null, [1])
    expect(context).toEqual({ kind: 'profile' })
    expect(scenarioRunnerActor(context, { id: 1, uid: 'acc-1' })).toEqual({
      kind: 'profile',
      accountId: 1,
      accountUid: 'acc-1'
    })
  })

  it('builds a Page actor from the canonical Page binding', () => {
    const context = resolveScenarioRunnerExecutionContext(
      { kind: 'page', pageTabId: 17, pageUid: '123456789' },
      PAGE,
      [2]
    )
    expect(context).toEqual({ kind: 'page', pageTabId: 17, pageUid: '123456789' })
    expect(scenarioRunnerActor(context, { id: 2, uid: 'acc-2' })).toEqual({
      kind: 'page',
      accountId: 2,
      accountUid: 'acc-2',
      pageUid: '123456789'
    })
  })

  it('rejects an account that is not enabled in the canonical Page binding', () => {
    expect(() => resolveScenarioRunnerExecutionContext(
      { kind: 'page', pageTabId: 17, pageUid: '123456789' },
      PAGE,
      [3]
    )).toThrow('không thuộc binding đang bật của Page')
  })

  it('rejects a stale or forged Page UID instead of switching to the wrong Page', () => {
    expect(() => resolveScenarioRunnerExecutionContext(
      { kind: 'page', pageTabId: 17, pageUid: '999999999' },
      PAGE,
      [1]
    )).toThrow('Page UID runtime không khớp Page canonical')
  })
})
