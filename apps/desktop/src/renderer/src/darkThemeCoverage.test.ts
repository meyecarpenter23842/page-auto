import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const darkThemeCoverage = readFileSync(
  fileURLToPath(new URL('./darkThemeCoverage.css', import.meta.url)),
  'utf8'
)

const requiredDarkSurfaces = [
  '.account-context-menu',
  '.account-browser-workspace',
  '.email-commandbar',
  '.email-side-panel',
  '.ai-content-topbar',
  '.ai-agent-modal',
  '.checkpoint282-dialog',
  '.multi-runtime-shell',
  '.page-wall-workspace',
  '.pt-post-library-header',
  '.action-workspace-tabs',
  '.scenario-page',
  '.action-picker-modal',
  '.k41-action-config-modal',
  '.post-config-block',
  '.copy-post-source-card'
] as const

describe('dark theme coverage', () => {
  it.each(requiredDarkSurfaces)('covers %s with a dark-theme override', (selector) => {
    expect(darkThemeCoverage).toContain(selector)
  })

  it('keeps the completion layer scoped to dark mode', () => {
    const withoutComments = darkThemeCoverage.replace(/\/\*[\s\S]*?\*\//g, '')
    const styleRules = withoutComments
      .split('}')
      .map((rule) => rule.trim())
      .filter(Boolean)

    expect(styleRules.length).toBeGreaterThan(20)
    expect(styleRules.every((rule) => rule.startsWith("html[data-theme='dark']") || rule.startsWith('@'))).toBe(true)
  })
})
