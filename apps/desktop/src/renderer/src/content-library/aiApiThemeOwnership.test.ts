import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
const read=(name:string)=>readFileSync(fileURLToPath(new URL('./'+name,import.meta.url)),'utf8')
const modal=read('aiAgentManager.css')
const api=read('aiApiConnectionPanel.css')
describe('AI API manager dark theme ownership',()=>{
  it('keeps the entire modal under its own semantic theme tokens',()=>{
    expect(modal).toContain("html[data-theme='dark'] .ai-api-only-modal")
    expect(modal).toContain('--ai-api-surface:var(--pa-dark-surface)')
    expect(modal).toContain('background:var(--ai-api-surface)')
    expect(modal).toContain('background:var(--ai-api-layer)')
  })
  it('does not leave hardcoded white form/cards or layer !important patches',()=>{
    expect(api).not.toContain('background:#fff')
    expect(api).not.toContain('background:#f8fafc')
    expect(api).not.toContain('!important')
    expect(api).toContain('background:var(--ai-api-input)')
    expect(api).toContain('background:var(--ai-api-layer)')
    expect(api).toContain('color:var(--ai-api-text)')
  })
})
