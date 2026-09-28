import { describe, expect, it, vi } from 'vitest'
import { applyWindowsStartupSetting, type WindowsStartupAdapter } from './windowsStartupSetting'

function adapter(patch: Partial<WindowsStartupAdapter> = {}): WindowsStartupAdapter {
  return {
    platform: 'win32',
    isPackaged: true,
    executablePath: 'C:\\Page-Auto\\PageAuto.exe',
    setLoginItemSettings: vi.fn(),
    ...patch
  }
}

describe('applyWindowsStartupSetting', () => {
  it('registers the packaged PAGE-AUTO executable for Windows login startup', () => {
    const target = adapter()
    const result = applyWindowsStartupSetting(true, target)
    expect(target.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: 'C:\\Page-Auto\\PageAuto.exe'
    })
    expect(result).toMatchObject({ applied: true, enabled: true })
  })

  it('removes Windows login startup when the preference is disabled', () => {
    const target = adapter()
    const result = applyWindowsStartupSetting(false, target)
    expect(target.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      path: 'C:\\Page-Auto\\PageAuto.exe'
    })
    expect(result).toMatchObject({ applied: true, enabled: false })
  })

  it('never registers development Electron or non-Windows processes', () => {
    expect(() => applyWindowsStartupSetting(true, adapter({ isPackaged: false }))).toThrow(/portable\/packaged/)
    expect(() => applyWindowsStartupSetting(true, adapter({ platform: 'linux' }))).toThrow(/Windows/)
    const target = adapter({ isPackaged: false })
    expect(applyWindowsStartupSetting(false, target).applied).toBe(false)
    expect(target.setLoginItemSettings).not.toHaveBeenCalled()
  })
})
