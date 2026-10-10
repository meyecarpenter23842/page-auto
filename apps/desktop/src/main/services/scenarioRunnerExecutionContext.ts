import type { ActionActorContext } from '../../shared/actionRuntime'
import type { ScenarioRunnerExecutionContext } from '../../shared/scenarioRunnerRuntime'

export interface ScenarioRunnerPageBinding {
  pageTabId: number
  pageUid: string
  enabledAccountIds: readonly number[]
}

export function resolveScenarioRunnerExecutionContext(
  input: ScenarioRunnerExecutionContext | undefined,
  pageBinding: ScenarioRunnerPageBinding | null,
  accountIds: readonly number[]
): ScenarioRunnerExecutionContext {
  if (!input || input.kind === 'profile') return { kind: 'profile' }

  if (!Number.isSafeInteger(input.pageTabId) || input.pageTabId <= 0) {
    throw new Error('Page context thiếu Page Tab hợp lệ.')
  }
  if (!pageBinding || pageBinding.pageTabId !== input.pageTabId) {
    throw new Error(`Không tìm thấy Page canonical #${input.pageTabId}.`)
  }

  const canonicalPageUid = pageBinding.pageUid.trim()
  if (!canonicalPageUid) throw new Error('Page canonical thiếu Page UID.')
  if (input.pageUid.trim() !== canonicalPageUid) {
    throw new Error('Page UID runtime không khớp Page canonical.')
  }

  const enabled = new Set(pageBinding.enabledAccountIds)
  const invalidAccountIds = accountIds.filter((accountId) => !enabled.has(accountId))
  if (invalidAccountIds.length > 0) {
    throw new Error(`Tài khoản #${invalidAccountIds.join(', #')} không thuộc binding đang bật của Page.`)
  }

  return { kind: 'page', pageTabId: pageBinding.pageTabId, pageUid: canonicalPageUid }
}

export function scenarioRunnerActor(
  context: ScenarioRunnerExecutionContext,
  account: { id: number; uid: string }
): ActionActorContext {
  return context.kind === 'page'
    ? { kind: 'page', accountId: account.id, accountUid: account.uid, pageUid: context.pageUid }
    : { kind: 'profile', accountId: account.id, accountUid: account.uid }
}
