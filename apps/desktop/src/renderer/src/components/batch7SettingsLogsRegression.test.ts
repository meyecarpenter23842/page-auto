import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const settings = readFileSync(new URL('../settings/SettingsPanel.tsx', import.meta.url), 'utf8')
const logs = readFileSync(new URL('../logs/ExecutionLogs.tsx', import.meta.url), 'utf8')
describe('Issue #510 Batch 7 Settings and Logs invariants', () => {
  it('keeps all eleven sections and only persists the navigation id', () => {
    expect(settings).toContain('settingsGroups.map')
    expect(settings).toContain('SETTINGS_SECTION_KEY')
    expect(settings).toContain('settings-menu-search')
    expect(settings).toContain("panel = <BrowserSettingsSection appInfo={appInfo} />")
    expect(settings).toContain('<AdvancedSettingsSection appInfo={appInfo} />')
    expect(settings).not.toContain('updateAppSettings(')
  })
  it('R4c keeps Settings scroll inside its menu and logs keyboard/secret safety', () => {
    const settingsStyle = readFileSync(new URL('../settings/settingsNavigation.css', import.meta.url), 'utf8')
    const logsStyle = readFileSync(new URL('../logs/executionLogsBatch7.css', import.meta.url), 'utf8')
    expect(settingsStyle).toContain('.settings-menu-scroll { overscroll-behavior: contain; scrollbar-gutter: stable; }')
    expect(logs).toContain('onKeyDown={onDetailKeyDown}')
    expect(logs).toContain('detailOpenerRef.current?.focus()')
    expect(logs).toContain('setError(sanitizedLogError(null, cause instanceof Error ? cause.message : String(cause)))')
    expect(logsStyle).toContain('max-height: calc(100vh - 24px)')
  })
  it('uses existing typed log filters, keeps retry contract, only copies sanitized errors', () => {
    expect(logs).toContain('window.pageAuto.listExecutionLogs(filters)')
    expect(logs).toContain('window.pageAuto.retryExecutionLogItem({ runItemId: log.runItemId })')
    expect(logs).toContain('parseLogDateRange(fromTime, toTime)')
    expect(logs).toContain('filterLogsByAction(logs, action)')
    expect(logs).toContain('navigator.clipboard.writeText(sanitizedLogError(')
    expect(logs).not.toContain('navigator.clipboard.writeText(log.errorMessage)')
  })
})
