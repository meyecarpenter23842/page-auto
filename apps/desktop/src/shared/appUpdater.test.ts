import { describe, expect, it } from 'vitest'
import { resolvePostRestartUpdate, type AppUpdaterPendingMarker } from './appUpdater'

const marker = (fromVersion: string, toVersion: string): AppUpdaterPendingMarker => ({
  fromVersion,
  toVersion,
  requestedAt: '2026-09-06T06:00:00.000Z'
})

describe('app updater post-restart verification', () => {
  it('confirms success only when the restarted app matches the requested target version', () => {
    expect(resolvePostRestartUpdate('1.0.1', marker('1.0.0', '1.0.1'))).toEqual({
      updated: true,
      previousVersion: '1.0.0'
    })
  })

  it('does not report success when the version did not change', () => {
    expect(resolvePostRestartUpdate('1.0.0', marker('1.0.0', '1.0.1'))).toEqual({
      updated: false,
      previousVersion: null
    })
  })

  it('does not report success for a stale or unrelated marker', () => {
    expect(resolvePostRestartUpdate('1.0.2', marker('1.0.0', '1.0.1'))).toEqual({
      updated: false,
      previousVersion: null
    })
    expect(resolvePostRestartUpdate('1.0.1', null)).toEqual({
      updated: false,
      previousVersion: null
    })
  })
})
