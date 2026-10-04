import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Hotmail open browser launch path', () => {
  const source = readFileSync(new URL('../hotmailIpc.ts', import.meta.url), 'utf8')

  it('does not block real Email profile launch behind a headless persistent-browser preflight', () => {
    expect(source).not.toContain("testEmailBrowserExecutable")
    expect(source).toMatch(/browserEngine\.probeExecutable\(candidate\)/)
    expect(source).toMatch(/if \(probe\.status === 'found'\) return candidate/)
  })
})
