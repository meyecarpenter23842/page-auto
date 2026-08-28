import { describe, expect, it } from 'vitest'
import { facebookCheckpoint282State, facebookCheckpointSurfaceUrl } from './facebookCheckpoint282'

describe('Facebook checkpoint 282 operator flow helpers', () => {
  it('moves only Facebook checkpoint URLs between supported surfaces while preserving the challenge path', () => {
    const source = 'https://www.facebook.com/checkpoint/1501092823525282/?next=%2Fgroups%2F123'
    expect(facebookCheckpointSurfaceUrl(source, 'mbasic')).toBe(
      'https://mbasic.facebook.com/checkpoint/1501092823525282/?next=%2Fgroups%2F123'
    )
    expect(facebookCheckpointSurfaceUrl(source, 'mobile')).toBe(
      'https://m.facebook.com/checkpoint/1501092823525282/?next=%2Fgroups%2F123'
    )
    expect(facebookCheckpointSurfaceUrl(source, 'desktop')).toBe(source)
  })

  it('refuses to rewrite non-checkpoint or non-Facebook URLs', () => {
    expect(facebookCheckpointSurfaceUrl('https://www.facebook.com/', 'mbasic')).toBeNull()
    expect(facebookCheckpointSurfaceUrl('https://example.com/checkpoint/282/', 'mbasic')).toBeNull()
  })

  it('keeps 282 distinct from other or missing checkpoint states', () => {
    expect(facebookCheckpoint282State('282')).toBe('waiting_manual')
    expect(facebookCheckpoint282State('956')).toBe('different_checkpoint')
    expect(facebookCheckpoint282State('unknown')).toBe('different_checkpoint')
    expect(facebookCheckpoint282State(null)).toBe('needs_login')
  })
})
