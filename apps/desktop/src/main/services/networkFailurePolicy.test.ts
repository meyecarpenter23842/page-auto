import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, type NetworkSettings } from '../../shared/appSettings'
import { resolveNetworkFailureDecision } from './networkFailurePolicy'

function settings(patch: Partial<NetworkSettings> = {}): NetworkSettings {
  return { ...DEFAULT_APP_SETTINGS.network, ...patch }
}

describe('network failure policy', () => {
  it('switches to the next account when abortAccountOnProxyFailure is enabled', () => {
    expect(resolveNetworkFailureDecision(
      { status: 'failed', code: 'proxy_unavailable', message: 'Proxy unavailable.' },
      settings({ abortAccountOnProxyFailure: true })
    )).toEqual({ kind: 'proxy', action: 'switch_account' })
  })

  it('pauses the Page Tab when proxy failure should not abort the account', () => {
    expect(resolveNetworkFailureDecision(
      { status: 'failed', code: 'proxy_invalid', message: 'Proxy invalid.' },
      settings({ abortAccountOnProxyFailure: false })
    )).toEqual({ kind: 'proxy', action: 'pause_tab' })
  })

  it('ignores non-proxy failures', () => {
    expect(resolveNetworkFailureDecision(
      { status: 'failed', code: 'group_unavailable', message: 'Group unavailable.' },
      settings()
    )).toBeNull()
  })
})
