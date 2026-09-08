import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('EmailBrowserManager credential wiring', () => {
  const source = readFileSync(new URL('./emailBrowserManager.ts', import.meta.url), 'utf8')

  it('routes PassEmail to Microsoft login/current password and never the Facebook password field', () => {
    expect(source).toMatch(/loginPassword:\s*account\.emailPassword/)
    expect(source).toMatch(/currentPassword:\s*account\.emailPassword/)
    expect(source).not.toMatch(/loginPassword:\s*account\.password\b/)
    expect(source).not.toMatch(/currentPassword:\s*account\.password\b/)
  })
})
