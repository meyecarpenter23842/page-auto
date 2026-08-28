import { describe, expect, it } from 'vitest'
import {
  canRecheckCheckpoint282,
  checkpoint282StateLabel,
  shouldPauseCheckpoint282Sequence
} from './checkpoint282Ui'

describe('checkpoint282Ui', () => {
  it('pauses the sequence only when manual verification is required', () => {
    expect(shouldPauseCheckpoint282Sequence('waiting_manual')).toBe(true)
    expect(shouldPauseCheckpoint282Sequence('resolved')).toBe(false)
    expect(shouldPauseCheckpoint282Sequence('different_checkpoint')).toBe(false)
    expect(shouldPauseCheckpoint282Sequence('needs_login')).toBe(false)
    expect(shouldPauseCheckpoint282Sequence('error')).toBe(false)
  })

  it('only offers recheck for a live manual checkpoint', () => {
    expect(canRecheckCheckpoint282('waiting_manual')).toBe(true)
    expect(canRecheckCheckpoint282('pending')).toBe(false)
    expect(canRecheckCheckpoint282('running')).toBe(false)
    expect(canRecheckCheckpoint282('resolved')).toBe(false)
  })

  it('uses concise operator labels', () => {
    expect(checkpoint282StateLabel('pending')).toBe('Chờ chạy')
    expect(checkpoint282StateLabel('waiting_manual')).toBe('Chờ thao tác')
    expect(checkpoint282StateLabel('resolved')).toBe('Đã xác minh')
  })
})
