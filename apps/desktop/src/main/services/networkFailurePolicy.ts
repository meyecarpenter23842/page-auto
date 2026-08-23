import type { NetworkSettings } from '../../shared/appSettings'
import type { PostingJobResult } from '../../shared/posting'

export type NetworkFailureAction = 'switch_account' | 'pause_tab'

export interface NetworkFailureDecision {
  kind: 'proxy'
  action: NetworkFailureAction
}

export function isProxyFailureCode(code: PostingJobResult['code']): boolean {
  return code === 'proxy_invalid' || code === 'proxy_unavailable'
}

export function resolveNetworkFailureDecision(
  result: PostingJobResult,
  settings: NetworkSettings
): NetworkFailureDecision | null {
  if (!isProxyFailureCode(result.code)) return null
  return {
    kind: 'proxy',
    action: settings.abortAccountOnProxyFailure ? 'switch_account' : 'pause_tab'
  }
}
