import { describe, expect, it } from 'vitest'
import type { RotationRuntimeSnapshot } from '../../../shared/rotation'
import {
  accountRuntimeLabel,
  activeRuntimeForPage,
  indexRotationRuntimes,
  rotationRuntimeLabel,
  runtimeEmptyPreviewMessage,
  runtimeProgressLabel
} from './pageRuntimePresentation'

function runtime(pageTabId: number, status: RotationRuntimeSnapshot['status'] = 'running'): RotationRuntimeSnapshot {
  return {
    pageTabId,
    runId: pageTabId * 10,
    status,
    currentAccountId: null,
    currentAccountIndex: null,
    slotsCompletedThisTurn: 1,
    targetSlotsThisTurn: 3,
    cycle: 0,
    nextActionAt: null,
    message: null,
    lastResult: null,
    run: null
  }
}

describe('page runtime presentation', () => {
  it('maps account and page runtime states to operator labels', () => {
    expect(accountRuntimeLabel('not_run')).toBe('Chưa chạy')
    expect(accountRuntimeLabel('completed_turn')).toBe('Đã chạy lượt')
    expect(accountRuntimeLabel('running')).toBe('Đang chạy')
    expect(accountRuntimeLabel('waiting')).toBe('Chờ')
    expect(accountRuntimeLabel('error')).toBe('Lỗi/Checkpoint')
    expect(rotationRuntimeLabel('waiting_window')).toBe('Chờ lịch')
    expect(rotationRuntimeLabel('completed')).toBe('Hoàn tất')
  })

  it('indexes snapshots by Page Tab so switching Page cannot reuse another Page runtime', () => {
    const pageA = runtime(11, 'running')
    const pageB = runtime(22, 'paused')
    const indexed = indexRotationRuntimes([pageA, pageB])

    expect(activeRuntimeForPage(indexed, 11)).toBe(pageA)
    expect(activeRuntimeForPage(indexed, 22)).toBe(pageB)
    expect(activeRuntimeForPage(indexed, 33)).toBeNull()
    expect(activeRuntimeForPage(indexed, null)).toBeNull()
  })

  it('formats live progress only when the current account turn has a target', () => {
    expect(runtimeProgressLabel(runtime(1))).toBe('1/3')
    expect(runtimeProgressLabel({ slotsCompletedThisTurn: 9, targetSlotsThisTurn: 3 })).toBe('3/3')
    expect(runtimeProgressLabel({ slotsCompletedThisTurn: 0, targetSlotsThisTurn: 0 })).toBeNull()
  })

  it('keeps idle, pause, stop and error empty-preview copy unambiguous', () => {
    expect(runtimeEmptyPreviewMessage(null)).toContain('Chưa có bài')
    expect(runtimeEmptyPreviewMessage({ status: 'paused', message: null })).toContain('tạm dừng')
    expect(runtimeEmptyPreviewMessage({ status: 'stopped', message: null })).toContain('đã dừng')
    expect(runtimeEmptyPreviewMessage({ status: 'error', message: 'Runtime lỗi cụ thể.' })).toBe('Runtime lỗi cụ thể.')
  })
})
