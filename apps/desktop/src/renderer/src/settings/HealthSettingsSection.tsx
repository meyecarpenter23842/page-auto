import { useEffect, useState } from 'react'
import type { AppInfo } from '../../../ipc/channels'
import type { BrowserExecutableResult } from '../../../shared/browserSettings'

interface HealthSettingsSectionProps { appInfo: AppInfo | null }

export function HealthSettingsSection({ appInfo }: HealthSettingsSectionProps) {
  const [probe, setProbe] = useState<BrowserExecutableResult | null>(null)

  useEffect(() => {
    void window.pageAuto.getAppSettings().then(async (settings) => {
      const result = settings.browser.executablePath
        ? await window.pageAuto.probeChromeExecutable(settings.browser.executablePath)
        : await window.pageAuto.detectChrome()
      setProbe(result)
    }).catch(() => setProbe(null))
  }, [])

  return <div className="settings-section health-section">
    <div className="health-grid">
      <div><span>Ứng dụng</span><strong>PAGE-AUTO {appInfo ? `v${appInfo.version}` : ''}</strong><small>Đã khởi động</small></div>
      <div><span>Chrome</span><strong>{probe?.status === 'found' ? 'Đã tìm thấy' : 'Cần kiểm tra'}</strong><small>{probe?.version ?? 'Chưa có phiên bản'}</small></div>
      <div className="path-card"><span>Thư mục dữ liệu</span><strong title={appInfo?.dataDirectory ?? ''}>{appInfo?.dataDirectory ?? '...'}</strong><small>Local</small></div>
    </div>
    <p>Kiểm tra SQLite / Playwright / Worker đầy đủ sẽ được nối ở lô chẩn đoán hệ thống. Màn này chỉ hiển thị trạng thái đã có dữ liệu thật.</p>
  </div>
}