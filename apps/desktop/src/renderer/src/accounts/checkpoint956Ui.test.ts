import { describe, expect, it } from 'vitest'
import {
  canRecheckCheckpoint956,
  checkpoint956StateLabel,
  shouldPauseCheckpoint956Sequence
} from './checkpoint956Ui'

describe('checkpoint956Ui', () => {
  it('pauses only when operator action, login, stop or retry is required', () => {
    expect(shouldPauseCheckpoint956Sequence('waiting_manual')).toBe(true)
    expect(shouldPauseCheckpoint956Sequence('needs_login')).toBe(true)
    expect(shouldPauseCheckpoint956Sequence('stopped')).toBe(true)
    expect(shouldPauseCheckpoint956Sequence('error')).toBe(true)
    expect(shouldPauseCheckpoint956Sequence('resolved')).toBe(false)
    expect(shouldPauseCheckpoint956Sequence('different_checkpoint')).toBe(false)
  })

  it('offers recheck for a held CP956 browser, login continuation or retryable error', () => {
    expect(canRecheckCheckpoint956('waiting_manual')).toBe(true)
    expect(canRecheckCheckpoint956('needs_login')).toBe(true)
    expect(canRecheckCheckpoint956('error')).toBe(true)
    expect(canRecheckCheckpoint956('different_checkpoint')).toBe(false)
    expect(canRecheckCheckpoint956('stopped')).toBe(false)
    expect(canRecheckCheckpoint956('pending')).toBe(false)
    expect(canRecheckCheckpoint956('running')).toBe(false)
    expect(canRecheckCheckpoint956('resolved')).toBe(false)
  })

  it('uses concise operator labels', () => {
    expect(checkpoint956StateLabel('pending')).toBe('Chờ chạy')
    expect(checkpoint956StateLabel('waiting_manual')).toBe('Chờ thao tác')
    expect(checkpoint956StateLabel('different_checkpoint')).toBe('Khác CP956')
    expect(checkpoint956StateLabel('needs_login')).toBe('Cần đăng nhập')
    expect(checkpoint956StateLabel('stopped')).toBe('Đã dừng')
    expect(checkpoint956StateLabel('resolved')).toBe('Đã xác minh')
  })
})
