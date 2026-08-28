import { describe, expect, it } from 'vitest'
import {
  canRecheckCheckpoint282,
  checkpoint282StateLabel,
  shouldPauseCheckpoint282Sequence
} from './checkpoint282Ui'

describe('checkpoint282Ui', () => {
  it('pauses the sequence when operator action, login, stop or an explicit retry is required', () => {
    expect(shouldPauseCheckpoint282Sequence('waiting_manual')).toBe(true)
    expect(shouldPauseCheckpoint282Sequence('needs_login')).toBe(true)
    expect(shouldPauseCheckpoint282Sequence('stopped')).toBe(true)
    expect(shouldPauseCheckpoint282Sequence('error')).toBe(true)
    expect(shouldPauseCheckpoint282Sequence('resolved')).toBe(false)
    expect(shouldPauseCheckpoint282Sequence('different_checkpoint')).toBe(false)
  })

  it('offers retry for a live manual checkpoint, login continuation or a retryable error', () => {
    expect(canRecheckCheckpoint282('waiting_manual')).toBe(true)
    expect(canRecheckCheckpoint282('needs_login')).toBe(true)
    expect(canRecheckCheckpoint282('error')).toBe(true)
    expect(canRecheckCheckpoint282('stopped')).toBe(false)
    expect(canRecheckCheckpoint282('pending')).toBe(false)
    expect(canRecheckCheckpoint282('running')).toBe(false)
    expect(canRecheckCheckpoint282('resolved')).toBe(false)
  })

  it('uses concise operator labels', () => {
    expect(checkpoint282StateLabel('pending')).toBe('Chờ chạy')
    expect(checkpoint282StateLabel('waiting_manual')).toBe('Chờ thao tác')
    expect(checkpoint282StateLabel('needs_login')).toBe('Cần đăng nhập')
    expect(checkpoint282StateLabel('stopped')).toBe('Đã dừng')
    expect(checkpoint282StateLabel('error')).toBe('Lỗi · thử lại')
    expect(checkpoint282StateLabel('resolved')).toBe('Đã xác minh')
  })
})
