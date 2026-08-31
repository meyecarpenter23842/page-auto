import { useState } from 'react'
import type { AppInfo } from '../../../ipc/channels'
import { AdvancedSettingsSection } from './AdvancedSettingsSection'
import { AppearanceSettingsSection } from './AppearanceSettingsSection'
import { BrowserSettingsSection } from './BrowserSettingsSection'
import { BrowserSlotsSettingsSection } from './BrowserSlotsSettingsSection'
import { CaptchaSettingsSection } from './CaptchaSettingsSection'
import { HealthSettingsSection } from './HealthSettingsSection'
import { LoggingSettingsPanel } from './LoggingSettingsPanel'
import { NetworkSettingsPanel } from './NetworkSettingsPanel'
import { RuntimeSettingsPanel } from './RuntimeSettingsPanel'
import { SessionSettingsPanel } from './SessionSettingsPanel'
import './settings.css'
import './settingsScrollFix.css'

interface SettingsPanelProps { appInfo: AppInfo | null }
type SettingsSection = 'appearance' | 'browser' | 'slots' | 'session' | 'network' | 'runtime' | 'logs' | 'captcha' | 'advanced' | 'health'

const sections: Array<{ id: SettingsSection; label: string; mark: string }> = [
  { id: 'appearance', label: 'Giao diện', mark: 'UI' },
  { id: 'browser', label: 'Trình duyệt', mark: 'BR' },
  { id: 'slots', label: 'Chrome Slots', mark: 'SL' },
  { id: 'session', label: 'Đăng nhập', mark: 'SS' },
  { id: 'network', label: 'Proxy & Mạng', mark: 'NW' },
  { id: 'runtime', label: 'Vận hành', mark: 'RT' },
  { id: 'logs', label: 'Nhật ký', mark: 'LG' },
  { id: 'captcha', label: 'CAPTCHA', mark: 'CP' },
  { id: 'advanced', label: 'Nâng cao', mark: 'AD' },
  { id: 'health', label: 'Kiểm tra hệ thống', mark: 'OK' }
]

export function SettingsPanel({ appInfo }: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('browser')

  let panel = <BrowserSettingsSection appInfo={appInfo} />
  if (activeSection === 'appearance') panel = <AppearanceSettingsSection />
  else if (activeSection === 'slots') panel = <BrowserSlotsSettingsSection />
  else if (activeSection === 'session') panel = <SessionSettingsPanel />
  else if (activeSection === 'network') panel = <NetworkSettingsPanel />
  else if (activeSection === 'runtime') panel = <RuntimeSettingsPanel />
  else if (activeSection === 'logs') panel = <LoggingSettingsPanel />
  else if (activeSection === 'captcha') panel = <CaptchaSettingsSection />
  else if (activeSection === 'advanced') panel = <AdvancedSettingsSection appInfo={appInfo} />
  else if (activeSection === 'health') panel = <HealthSettingsSection appInfo={appInfo} />

  const active = sections.find((section) => section.id === activeSection)
  const heading = activeSection === 'appearance'
    ? 'Chế độ sáng & tối'
    : activeSection === 'browser'
      ? 'Thiết lập trình duyệt'
      : activeSection === 'slots'
        ? 'Theo dõi sức chứa & slot Chrome'
        : active?.label
  const footer = activeSection === 'appearance'
    ? 'Giao diện được lưu local và tự áp dụng ở lần mở app tiếp theo.'
    : activeSection === 'session'
      ? 'Session, locale và policy được lưu local và dùng trực tiếp bởi worker.'
      : activeSection === 'network'
        ? 'Proxy preflight, timeout và policy mạng được dùng trực tiếp bởi posting runtime.'
        : activeSection === 'runtime'
          ? 'Giới hạn tab, launch spacing, timeout và retry policy được Main áp dụng trực tiếp.'
          : activeSection === 'logs'
            ? 'Mức log, evidence và retention được áp dụng trực tiếp cho posting/runtime log.'
            : activeSection === 'slots'
              ? 'Slot map chỉ đọc trạng thái mỗi giây; chỉ nút Sắp xếp lại Chrome mới compact vị trí.'
              : 'Thay đổi được lưu bằng nút trong màn cài đặt đang mở.'

  return <div className="settings-shell">
    <aside className="settings-menu" aria-label="Nhóm cài đặt">
      <div className="settings-menu-title">CÀI ĐẶT</div>
      {sections.map((section) => <button type="button" key={section.id} className={activeSection === section.id ? 'settings-menu-item active' : 'settings-menu-item'} onClick={() => setActiveSection(section.id)}><span>{section.mark}</span>{section.label}</button>)}
    </aside>
    <section className="settings-detail">
      <div className="settings-detail-head"><div><p>{active?.label}</p><h2>{heading}</h2></div><span className="settings-version">{appInfo ? `v${appInfo.version}` : '...'}</span></div>
      <div className="settings-detail-body">{panel}</div>
      <div className="settings-footer"><span /><span className="footer-note">{footer}</span></div>
    </section>
  </div>
}
