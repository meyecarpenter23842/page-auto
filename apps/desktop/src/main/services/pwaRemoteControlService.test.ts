import { describe, expect, it, vi } from 'vitest'
import type { PwaGroupPostCommand } from '../../shared/pwaBridge'
import type { RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../shared/rotation'
import { PwaRemoteControlService, type PwaRemoteRotationSource } from './pwaRemoteControlService'

function runtime(status: RotationRuntimeStatus, runId: number | null = status === 'idle' ? null : 7): RotationRuntimeSnapshot {
  return {
    pageTabId: 3,
    runId,
    status,
    currentAccountId: null,
    currentAccountIndex: null,
    slotsCompletedThisTurn: 0,
    targetSlotsThisTurn: 0,
    cycle: 0,
    nextActionAt: null,
    message: null,
    lastResult: null,
    run: null
  }
}

function command(commandId: string, action: PwaGroupPostCommand['action'], overrides: Partial<PwaGroupPostCommand> = {}): PwaGroupPostCommand {
  return {
    schemaVersion: 1,
    target: 'group_post',
    commandId,
    pageTabId: 3,
    action,
    issuedAt: 1_000,
    expiresAt: 20_000,
    ...overrides
  }
}

function source(initial: RotationRuntimeStatus = 'idle') {
  let status = initial
  const api: PwaRemoteRotationSource = {
    status: vi.fn(() => runtime(status)),
    start: vi.fn(() => { status = 'running'; return runtime(status) }),
    pause: vi.fn(() => { status = 'paused'; return runtime(status) }),
    resume: vi.fn(() => { status = 'running'; return runtime(status) }),
    stop: vi.fn(() => { status = 'stopped'; return runtime(status) })
  }
  return api
}

describe('PwaRemoteControlService', () => {
  it('runs valid transitions through the existing rotation runtime', () => {
    const rotation = source('idle')
    const service = new PwaRemoteControlService(rotation, () => true, () => 5_000)
    expect(service.execute(command('remote_start_0001', 'start'))).toMatchObject({ ok: true, code: 'ok', fromStatus: 'idle', runtimeStatus: 'running' })
    expect(service.execute(command('remote_pause_0001', 'pause'))).toMatchObject({ ok: true, runtimeStatus: 'paused' })
    expect(service.execute(command('remote_resume_001', 'resume'))).toMatchObject({ ok: true, runtimeStatus: 'running' })
    expect(service.execute(command('remote_stop_00001', 'stop'))).toMatchObject({ ok: true, runtimeStatus: 'stopped' })
  })

  it('rejects expired, missing-page and invalid-state commands before mutating runtime', () => {
    const rotation = source('idle')
    const service = new PwaRemoteControlService(rotation, (pageTabId) => pageTabId === 3, () => 10_000)
    expect(service.execute(command('remote_expired_01', 'start', { expiresAt: 9_999 }))).toMatchObject({ ok: false, code: 'expired' })
    expect(service.execute(command('remote_missing_001', 'start', { pageTabId: 99 }))).toMatchObject({ ok: false, code: 'page_not_found' })
    expect(service.execute(command('remote_pause_bad01', 'pause'))).toMatchObject({ ok: false, code: 'invalid_state', runtimeStatus: 'idle' })
    expect(rotation.start).not.toHaveBeenCalled()
    expect(rotation.pause).not.toHaveBeenCalled()
  })

  it('is idempotent for duplicate commandId and rejects conflicting reuse', () => {
    const rotation = source('idle')
    const service = new PwaRemoteControlService(rotation, () => true, () => 5_000)
    const first = service.execute(command('remote_duplicate1', 'start'))
    const duplicate = service.execute(command('remote_duplicate1', 'start'))
    const conflict = service.execute(command('remote_duplicate1', 'stop'))
    expect(duplicate).toEqual(first)
    expect(rotation.start).toHaveBeenCalledTimes(1)
    expect(conflict).toMatchObject({ ok: false, code: 'command_conflict' })
    expect(rotation.stop).not.toHaveBeenCalled()
  })

  it('returns a bounded runtime error instead of throwing through the relay', () => {
    const rotation = source('idle')
    vi.mocked(rotation.start).mockImplementation(() => { throw new Error('runtime failed\nwith secret-looking multiline context') })
    const service = new PwaRemoteControlService(rotation, () => true, () => 5_000)
    expect(service.execute(command('remote_runtime_001', 'start'))).toMatchObject({
      ok: false,
      code: 'runtime_error',
      message: 'runtime failed with secret-looking multiline context'
    })
  })
})
