import { describe, expect, it } from 'vitest'
import { createK41ActionExecutorRegistry } from './index'

describe('K4.1 executor registry', () => {
  it('registers the three view actions as separate executors', () => {
    const resolvePage = async () => null
    const registry = createK41ActionExecutorRegistry({
      newsfeed: { resolvePage },
      story: { resolvePage },
      reel: { resolvePage }
    })

    expect(registry.has('view_newsfeed')).toBe(true)
    expect(registry.has('view_story')).toBe(true)
    expect(registry.has('view_reel')).toBe(true)
    expect(registry.has('view_watch')).toBe(false)
  })
})
