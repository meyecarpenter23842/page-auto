import { describe, expect, it } from 'vitest'
import { restoreSettingsSection, settingsGroups, settingsSections } from './settingsNavigation'
describe('Settings navigation (#510 Batch 7)', () => {
  it('has exactly 11 unique grouped sections with truthful save semantics', () => {
    expect(settingsSections).toHaveLength(11)
    expect(new Set(settingsSections.map((s) => s.id)).size).toBe(11)
    for (const section of settingsSections) expect(settingsGroups.some((group) => group.id === section.group)).toBe(true)
    expect(settingsSections.find((s) => s.id === 'appearance')?.saveMode).toBe('auto')
    expect(settingsSections.find((s) => s.id === 'runtime')?.saveMode).toBe('manual')
    expect(settingsSections.find((s) => s.id === 'slots')?.saveMode).toBe('action')
  })
  it('restores only known ids and never persists private settings values', () => {
    expect(restoreSettingsSection('logs')).toBe('logs')
    expect(restoreSettingsSection('advanced')).toBe('advanced')
    expect(restoreSettingsSection('arbitrary-secret')).toBe('browser')
    expect(restoreSettingsSection(null)).toBe('browser')
  })
})
