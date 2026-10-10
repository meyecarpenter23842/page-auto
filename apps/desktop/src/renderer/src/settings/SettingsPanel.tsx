import { useMemo, useState } from 'react'
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
import { UpdateSettingsSection } from './UpdateSettingsSection'
import './settings.css'
import './settingsScrollFix.css'
import './settingsNavigation.css'
import { settingsSections, settingsGroups, restoreSettingsSection, SETTINGS_SECTION_KEY, type SettingsSection } from './settingsNavigation'

interface SettingsPanelProps { appInfo: AppInfo | null }

export function SettingsPanel({ appInfo }: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(() => {
    try { return restoreSettingsSection(window.localStorage.getItem(SETTINGS_SECTION_KEY)) }
    catch { return 'browser' }
  })
  const [search, setSearch] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(activeSection === 'advanced')
  const visibleSections = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi')
    return query ? settingsSections.filter((section) =>
      (section.label + ' ' + section.keywords).toLocaleLowerCase('vi').includes(query)) : settingsSections
  }, [search])
  const activate = (section: SettingsSection) => {
    setActiveSection(section)
    if (section === 'advanced') setAdvancedOpen(true)
    try { window.localStorage.setItem(SETTINGS_SECTION_KEY, section) } catch { /* UI selection persistence is optional. */ }
  }

  let panel = <BrowserSettingsSection appInfo={appInfo} />
  if (activeSection === 'appearance') panel = <AppearanceSettingsSection />
  else if (activeSection === 'update') panel = <UpdateSettingsSection appInfo={appInfo} />
  else if (activeSection === 'slots') panel = <BrowserSlotsSettingsSection />
  else if (activeSection === 'session') panel = <SessionSettingsPanel />
  else if (activeSection === 'network') panel = <NetworkSettingsPanel />
  else if (activeSection === 'runtime') panel = <RuntimeSettingsPanel />
  else if (activeSection === 'logs') panel = <LoggingSettingsPanel />
  else if (activeSection === 'captcha') panel = <CaptchaSettingsSection />
  else if (activeSection === 'advanced') panel = <AdvancedSettingsSection appInfo={appInfo} />
  else if (activeSection === 'health') panel = <HealthSettingsSection appInfo={appInfo} />

  const active = settingsSections.find((section) => section.id === activeSection)
  const heading = activeSection === 'appearance'
    ? 'Chế độ sáng & tối'
    : activeSection === 'update'
      ? 'Cập nhật PAGE-AUTO'
      : activeSection === 'browser'
        ? 'Thiết lập trình duyệt'
        : activeSection === 'slots'
          ? 'Theo dõi sức chứa & slot Chrome'
          : active?.label
  const footer = activeSection === 'appearance'
    ? 'Giao diện được lưu local và tự áp dụng ở lần mở app tiếp theo.'
    : activeSection === 'update'
      ? 'Bản cập nhật được kiểm tra và tải từ R2; chỉ cài sau khi tải hoàn tất.'
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
      <label className="settings-menu-search">
        <span>Tìm trong 11 mục</span>
        <input type="search" aria-label="Tìm mục cài đặt" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên mục hoặc chức năng…" />
      </label>
      <div className="settings-menu-scroll">
        {settingsGroups.map((group) => {
          const items = visibleSections.filter((section) => section.group === group.id)
          if (!items.length) return null
          const links = items.map((section) =>
            <button
              type="button" key={section.id}
              aria-current={activeSection === section.id ? 'page' : undefined}
              className={activeSection === section.id ? 'settings-menu-item active' : 'settings-menu-item'}
              onClick={() => activate(section.id)}
            ><span>{section.mark}</span>{section.label}</button>
          )
          return group.id === 'advanced'
            ? <details className="settings-menu-advanced" key={group.id}
                open={advancedOpen || Boolean(search.trim())}
                onToggle={(event) => { if (!search.trim()) setAdvancedOpen(event.currentTarget.open) }}>
                <summary>{group.label}</summary>{links}
              </details>
            : <div className="settings-menu-group" key={group.id}><h3>{group.label}</h3>{links}</div>
        })}
        {!visibleSections.length ? <p className="settings-menu-empty">Không tìm thấy mục cài đặt phù hợp.</p> : null}
      </div>
    </aside>
    <section className="settings-detail">
      <div className="settings-detail-head"><div><p>{active?.label}</p><h2>{heading}</h2><small className="settings-save-mode" data-mode={active?.saveMode ?? 'manual'}>{active?.saveLabel ?? 'Lưu tại mục đang mở'}</small></div><span className="settings-version">{appInfo ? `v${appInfo.version}` : '...'}</span></div>
      <div className="settings-detail-body">{panel}</div>
      <div className="settings-footer"><span /><span className="footer-note">{footer}</span></div>
    </section>
  </div>
}
