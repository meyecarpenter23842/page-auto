import { describe, expect, it } from 'vitest'
import {
  canRecheckCheckpoint956,
  checkpoint956StateLabel,
  shouldPauseCheckpoint956Sequence
} from './checkpoint956Ui'

describe('checkpoint956Ui', () => {
  it('keeps the batch moving for waiting/attention/error accounts and stops only on explicit stop', () => {
    expect(shouldPauseCheckpoint956Sequence('waiting')).toBe(false)
    expect(shouldPauseCheckpoint956Sequence('needs_attention')).toBe(false)
    expect(shouldPauseCheckpoint956Sequence('needs_login')).toBe(false)
    expect(shouldPauseCheckpoint956Sequence('checkpoint_timeout')).toBe(false)
    expect(shouldPauseCheckpoint956Sequence('error')).toBe(false)
    expect(shouldPauseCheckpoint956Sequence('resolved')).toBe(false)
    expect(shouldPauseCheckpoint956Sequence('stopped')).toBe(true)
  })

  it('offers recheck for typed CP956 waiting/attention/login/timeout/error states', () => {
    expect(canRecheckCheckpoint956('waiting')).toBe(true)
    expect(canRecheckCheckpoint956('needs_attention')).toBe(true)
    expect(canRecheckCheckpoint956('needs_login')).toBe(true)
    expect(canRecheckCheckpoint956('checkpoint_timeout')).toBe(true)
    expect(canRecheckCheckpoint956('error')).toBe(true)
    expect(canRecheckCheckpoint956('stopped')).toBe(false)
    expect(canRecheckCheckpoint956('pending')).toBe(false)
    expect(canRecheckCheckpoint956('running')).toBe(false)
    expect(canRecheckCheckpoint956('resolved')).toBe(false)
  })

  it('uses typed operator labels', () => {
    expect(checkpoint956StateLabel('pending')).toBe('Chờ chạy')
    expect(checkpoint956StateLabel('waiting')).toBe('Đang chờ')
    expect(checkpoint956StateLabel('needs_attention')).toBe('Cần xử lý')
    expect(checkpoint956StateLabel('checkpoint_timeout')).toBe('Hết thời gian giữ')
    expect(checkpoint956StateLabel('needs_login')).toBe('Cần đăng nhập')
    expect(checkpoint956StateLabel('stopped')).toBe('Đã dừng')
    expect(checkpoint956StateLabel('resolved')).toBe('Đã xác minh')
  })
})
