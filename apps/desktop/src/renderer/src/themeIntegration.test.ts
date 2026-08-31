import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('./settings/SettingsPanel.tsx', import.meta.url), 'utf8')
const appearanceSource = readFileSync(new URL('./settings/AppearanceSettingsSection.tsx', import.meta.url), 'utf8')
const themeCss = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

describe('app-wide light/dark theme integration', () => {
  it('restores the stored theme before the renderer mounts and loads overrides last', () => {
    expect(mainSource).toContain("import { initializeTheme } from './theme'")
    expect(mainSource).toContain('initializeTheme()')
    expect(mainSource).toContain("import './theme.css'")
    expect(mainSource.indexOf("import './theme.css'")).toBeGreaterThan(mainSource.indexOf("import './recordRowPaintSelection.css'"))
  })

  it('exposes Giao diện inside Settings with explicit Sáng/Tối choices', () => {
    expect(settingsSource).toContain("{ id: 'appearance', label: 'Giao diện', mark: 'UI' }")
    expect(settingsSource).toContain('<AppearanceSettingsSection />')
    expect(appearanceSource).toContain("{ id: 'light', label: 'Sáng'")
    expect(appearanceSource).toContain("{ id: 'dark', label: 'Tối'")
    expect(appearanceSource).toContain('saveTheme(nextTheme)')
  })

  it('uses the agreed charcoal/white/green dark palette across core workspaces', () => {
    expect(themeCss).toContain("html[data-theme='dark']")
    expect(themeCss).toContain('--pa-dark-bg: #0d0d0d')
    expect(themeCss).toContain('--pa-dark-text: #f7f7f8')
    expect(themeCss).toContain('--pa-dark-green: #16a34a')
    expect(themeCss).toContain('.account-grid-panel')
    expect(themeCss).toContain('.settings-shell')
    expect(themeCss).toContain('.page-tab-chip.active')
    expect(themeCss).toContain('.content-library-panel')
    expect(themeCss).toContain('.scenario-runner-page')
    expect(themeCss).toContain('.execution-logs-toolbar')
  })
})
