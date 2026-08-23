import { useState } from 'react'
import type { AppInfo } from '../../../ipc/channels'
import { AdvancedSettingsSection } from './AdvancedSettingsSection'
import { BrowserSettingsSection } from './BrowserSettingsSection'
import { CaptchaSettingsSection } from './CaptchaSettingsSection'
import { HealthSettingsSection } from './HealthSettingsSection'
import { NetworkSettingsPanel } from './NetworkSettingsPanel'
import { SessionSettingsPanel } from './SessionSettingsPanel'
import './settings.css'

interface SettingsPanelProps { appInfo: AppInfo | null }
type SettingsSection = 'browser' | 'session' | 'network' | 'runtime' | 'logs' | 'captcha' | 'advanced' | 'health'

const sections: Array<{ id: SettingsSection; label: string; mark: string }> = [
  { id: 'browser', label: 'Trình duyệt', mark: 'BR' },
  { id: 'session', label: 'Đăng nhập', mark: 'SS' },
  { id: 'network', label: 'Proxy & Mạng', mark: 'NW' },
  { id: 'runtime', label: 'Vận hành', mark: 'RT' },
  { id: 'logs', label: 'Nhật ký', mark: 'LG' },
  { id: 'captcha', label: 'CAPTCHA', mark: 'CP' },
  { id: 'advanced', label: 'Nâng cao', mark: 'AD' },
  { id: 'health', label: 'Kiểm tra hệ thống', mark: 'OK' }
]

function Placeholder({ title, copy }: { title: string; copy: string }) {
  return <div className="settings-section placeholder-section"><div className="placeholder-mark">✓</div><h3>{title}</h3><p>{copy}</p><span>Chưa hiển thị nút cài đặt ở đây để tránh tạo control chưa có tác dụng thật.</span></div>
}

export function SettingsPanel({ appInfo }: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('browser')

  let panel = <BrowserSettingsSection appInfo={appInfo} />
  if (activeSection === 'session') panel = <SessionSettingsPanel />
  else if (activeSection === 'network') panel = <NetworkSettingsPanel />
  else if (activeSection === 'runtime') panel = <Placeholder title="Vận hành" copy="Giới hạn worker, thời gian chạy account và recovery thuộc Lô 5." />
  else if (activeSection === 'logs') panel = <Placeholder title="Nhật ký" copy="Mức log, lưu ảnh lỗi và dọn log thuộc Lô 6." />
  else if (activeSection === 'captcha') panel = <CaptchaSettingsSection />
  else if (activeSection === 'advanced') panel = <AdvancedSettingsSection appInfo={appInfo} />
  else if (activeSection === 'health') panel = <HealthSettingsSection appInfo={appInfo} />

  const active = sections.find((section) => section.id === activeSection)
  const heading = activeSection === 'browser' ? 'Thiết lập trình duyệt' : active?.label
  const footer = activeSection === 'session'
    ? 'Session, locale và policy được lưu local và dùng trực tiếp bởi worker.'
    : activeSection === 'network'
      ? 'Proxy preflight, timeout và policy mạng được dùng trực tiếp bởi posting runtime.'
      : ['runtime', 'logs'].includes(activeSection)
        ? 'Màn này chưa có thay đổi cần lưu.'
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
