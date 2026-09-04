import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const darkTheme = readFileSync(
  fileURLToPath(new URL('./contentLibraryDarkTheme.css', import.meta.url)),
  'utf8'
)

const hubSource = readFileSync(
  fileURLToPath(new URL('./ContentLibraryHub.tsx', import.meta.url)),
  'utf8'
)

describe('Content Library dark theme', () => {
  it('loads the correction layer from the shared Content Library hub', () => {
    expect(hubSource).toContain("import './contentLibraryHub.css'")
    expect(hubSource).toContain("import './contentLibraryDarkTheme.css'")
    expect(hubSource.indexOf("contentLibraryDarkTheme.css")).toBeGreaterThan(
      hubSource.indexOf("contentLibraryHub.css")
    )
  })

  it.each([
    '.content-library-table tbody tr.active',
    '.ai-agent-output-bridge',
    '.ai-draft-editor',
    '.ai-draft-media-config',
    '.ai-agent-output-body textarea'
  ])('covers %s with a dark-mode override', (selector) => {
    expect(darkTheme).toContain(selector)
  })

  it('overrides the responsive AI result cards that force light backgrounds', () => {
    expect(darkTheme).toContain(
      "html[data-theme='dark'] .workspace-content-library .ai-results-workspace > .ai-draft-list > .ai-draft-row"
    )
    expect(darkTheme).toContain('background: var(--pa-dark-surface) !important;')
    expect(darkTheme).toContain('background: #173421 !important;')
  })

  it('keeps the correction layer dark-mode only', () => {
    const withoutComments = darkTheme.replace(/\/\*[\s\S]*?\*\//g, '')
    const styleRules = withoutComments
      .split('}')
      .map((rule) => rule.trim())
      .filter(Boolean)

    expect(styleRules.length).toBeGreaterThan(10)
    expect(styleRules.every((rule) => rule.startsWith("html[data-theme='dark']"))).toBe(true)
  })
})
