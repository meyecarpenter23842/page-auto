export interface WindowsStartupAdapter {
  platform: NodeJS.Platform
  isPackaged: boolean
  executablePath: string
  setLoginItemSettings: (settings: { openAtLogin: boolean; path: string }) => void
}

export interface WindowsStartupApplyResult {
  applied: boolean
  enabled: boolean
  message: string
}

export function applyWindowsStartupSetting(
  enabled: boolean,
  adapter: WindowsStartupAdapter
): WindowsStartupApplyResult {
  if (adapter.platform !== 'win32') {
    if (enabled) throw new Error('Khởi động cùng hệ thống chỉ hỗ trợ Windows.')
    return { applied: false, enabled: false, message: 'Không áp dụng startup vì hệ điều hành không phải Windows.' }
  }

  if (!adapter.isPackaged) {
    if (enabled) throw new Error('Khởi động cùng Windows chỉ bật được trên bản PAGE-AUTO portable/packaged.')
    return { applied: false, enabled: false, message: 'Bản development không đăng ký startup Windows.' }
  }

  const executablePath = adapter.executablePath.trim()
  if (!executablePath) throw new Error('Không xác định được đường dẫn PAGE-AUTO để đăng ký startup Windows.')

  adapter.setLoginItemSettings({
    openAtLogin: enabled,
    path: executablePath
  })

  return {
    applied: true,
    enabled,
    message: enabled
      ? 'PAGE-AUTO sẽ tự mở khi đăng nhập Windows.'
      : 'PAGE-AUTO đã được gỡ khỏi danh sách tự khởi động cùng Windows.'
  }
}
