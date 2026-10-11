import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AI_COMPOSER_WIDTH_KEY, clampAiComposerWidth, readAiComposerWidth, saveAiComposerWidth } from './aiComposerLayout'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const workspace = read('./AiContentWorkspaceAgentBuilder.tsx')
const results = read('./AiDraftResultsPanel.tsx')
const responsive = read('./aiResponsivePreview.css')
const resultsCss = read('./aiDraftResultsPanel.css')
const workspaceCss = read('./aiContentWorkspace.css')
const polish = read('./aiWorkspacePolish.css')

describe('AI composer Windows workspace ergonomics', () => {
  it('clamps the sidebar, stores just a width number, and tolerates corrupt storage', () => {
    expect(clampAiComposerWidth(800)).toBe(620)
    expect(clampAiComposerWidth(100)).toBe(320)
    expect(clampAiComposerWidth(Number.NaN)).toBe(400)
    expect(clampAiComposerWidth(510, 1000)).toBe(440)
    const memory = new Map<string, string>()
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value) }
    }
    saveAiComposerWidth(storage, 475)
    expect(memory.get(AI_COMPOSER_WIDTH_KEY)).toBe('475')
    expect(readAiComposerWidth(storage)).toBe(475)
    memory.set(AI_COMPOSER_WIDTH_KEY, 'not-a-number')
    expect(readAiComposerWidth(storage)).toBe(400)
  })

  it('supports mouse/keyboard resizing without modifying AI content or runtime', () => {
    expect(workspace).toContain('role="separator"')
    expect(workspace).toContain('aria-valuenow={composeWidth}')
    expect(workspace).toContain('onPointerMove={resizePointerMove}')
    expect(workspace).toContain('onKeyDown={resizeKeyboard}')
    expect(workspace).toContain('saveAiComposerWidth(window.localStorage')
    expect(workspace).toContain('captureAiRequestContext(action, postCount)')
    expect(workspace).toContain('AiDraftResultsPanel')
  })

  it('frees reading height and removes the disabled image generation checkbox', () => {
    expect(workspace).toContain('className="ai-extra-options"')
    expect(workspace).not.toContain('ai-image-option disabled')
    expect(results).toContain('<details className="ai-draft-media-config"')
    expect(results).toContain('<details className="ai-agent-output-bridge"')
    expect(results.indexOf('className="ai-agent-output-bridge"')).toBeLessThan(results.indexOf('ai-preview-canvas ai-results-canvas'))
    expect(resultsCss).toContain('.ai-agent-output-body{position:absolute')
    expect(resultsCss).toContain('grid-template-rows:auto auto minmax(150px,1fr) auto auto')
    expect(workspaceCss).toContain('.ai-preview-canvas{display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start')
    expect(workspaceCss).not.toContain('.ai-preview-canvas{display:grid;place-items:center')
    expect(resultsCss).not.toContain(':has(')
    expect(responsive).not.toContain('!important')
    expect(results).toContain('data-has-drafts={drafts.length > 0}')
    expect(polish).toContain('.ai-field input,.ai-field select,.ai-field textarea{font-size:13px}')
    expect(responsive).toContain('var(--ai-compose-width, 400px)')
    expect(polish).toContain('.ai-content-layout.ai-resizable-layout{column-gap:0}')
  })
})
