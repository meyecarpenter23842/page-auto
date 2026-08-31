import { useState } from 'react'
import { readStoredTheme, saveTheme, type AppTheme } from '../theme'
import './appearanceSettings.css'

const themeOptions: Array<{
  id: AppTheme
  label: string
  description: string
}> = [
  { id: 'light', label: 'Sáng', description: 'Giao diện sáng hiện tại, nền trắng và màu nhấn xanh dương.' },
  { id: 'dark', label: 'Tối', description: 'Nền đen/charcoal, chữ trắng và nút thao tác chính màu xanh lá.' }
]

export function AppearanceSettingsSection() {
  const [theme, setTheme] = useState<AppTheme>(() => readStoredTheme())

  const chooseTheme = (nextTheme: AppTheme) => {
    if (nextTheme === theme) return
    setTheme(nextTheme)
    saveTheme(nextTheme)
  }

  return (
    <section className="settings-section appearance-settings" aria-label="Giao diện">
      <div className="appearance-heading">
        <div>
          <span>GIAO DIỆN PAGE-AUTO</span>
          <h3>Chế độ sáng & tối</h3>
          <p>Đổi toàn bộ giao diện ngay lập tức. Lựa chọn được lưu trên máy này và giữ nguyên khi mở app lại.</p>
        </div>
        <span className={`appearance-current appearance-current-${theme}`}>{theme === 'dark' ? 'Đang dùng Tối' : 'Đang dùng Sáng'}</span>
      </div>

      <div className="appearance-options" role="group" aria-label="Chọn giao diện">
        {themeOptions.map((option) => (
          <button
            key={option.id}
            className={theme === option.id ? 'appearance-option active' : 'appearance-option'}
            type="button"
            aria-pressed={theme === option.id}
            onClick={() => chooseTheme(option.id)}
          >
            <span className={`appearance-preview appearance-preview-${option.id}`} aria-hidden="true">
              <i className="appearance-preview-sidebar" />
              <i className="appearance-preview-topbar" />
              <i className="appearance-preview-card appearance-preview-card-one" />
              <i className="appearance-preview-card appearance-preview-card-two" />
              <i className="appearance-preview-action" />
            </span>
            <span className="appearance-option-copy">
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
            <span className="appearance-option-check" aria-hidden="true">{theme === option.id ? '✓' : ''}</span>
          </button>
        ))}
      </div>

      <div className="appearance-note">
        <strong>Dark theme</strong>
        <span>Giữ màu trạng thái cảnh báo/lỗi để dễ nhận biết; nút chính, tab đang chọn và focus dùng xanh lá.</span>
      </div>
    </section>
  )
}
