import { useState } from 'react'
import type { AppInfo } from '../../../ipc/channels'
import './settings.css'

interface SettingsPanelProps {
  appInfo: AppInfo | null
}

export function SettingsPanel({ appInfo }: SettingsPanelProps) {
  const [busy, setBusy] = useState<'export' | 'restore' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const exportBackup = async () => {
    setBusy('export')
    setMessage(null)
    setError(null)
    try {
      const result = await window.pageAuto.exportConfigBackup()
      setMessage(result.message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  const restoreBackup = async () => {
    setBusy('restore')
    setMessage(null)
    setError(null)
    try {
      const result = await window.pageAuto.restoreConfigBackup()
      setMessage(result.message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-page">
      <section className="content-card settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Portable runtime</p>
            <h2>PAGE-AUTO {appInfo ? `v${appInfo.version}` : ''}</h2>
          </div>
          <span className="healthy-chip">{appInfo?.isPackaged ? 'Packaged' : 'Development'}</span>
        </div>

        <div className="settings-info-grid">
          <div>
            <span>Phân phối</span>
            <strong>Windows folder / ZIP portable</strong>
          </div>
          <div>
            <span>Executable</span>
            <strong>PageAuto.exe</strong>
          </div>
          <div className="settings-path">
            <span>Data folder</span>
            <strong title={appInfo?.dataDirectory ?? ''}>{appInfo?.dataDirectory ?? 'Đang đọc...'}</strong>
          </div>
        </div>

        <p className="settings-note">
          Bản packaged lưu SQLite, browser profile, logs và screenshots trong folder <code>data</code> cạnh PageAuto.exe.
          Không dùng installer/Setup/NSIS trong MVP.
        </p>
      </section>

      <section className="content-card settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Config backup</p>
            <h2>Backup / Restore cấu hình</h2>
          </div>
          <span className="settings-safe-chip">No plaintext secrets</span>
        </div>

        <div className="settings-backup-copy">
          <p>
            Backup gồm Page Tabs, Group/Content/Schedule/Image config, account reference theo UID, Import Presets và layout cột.
          </p>
          <p>
            File backup mặc định <strong>không chứa password, cookie/session, 2FA, email password, proxy password, browser profile, log hoặc screenshot</strong>.
          </p>
          <p>
            Restore sẽ merge theo Page UID/tên tab. Account chưa có sẽ được tạo dạng shell <code>unknown</code> để anh đăng nhập lại thủ công.
          </p>
        </div>

        <div className="settings-actions">
          <button type="button" className="button primary" disabled={busy !== null} onClick={() => void exportBackup()}>
            {busy === 'export' ? 'Đang xuất...' : 'Xuất backup cấu hình'}
          </button>
          <button type="button" className="button" disabled={busy !== null} onClick={() => void restoreBackup()}>
            {busy === 'restore' ? 'Đang restore...' : 'Khôi phục từ backup'}
          </button>
        </div>

        {message ? <div className="settings-message success">{message}</div> : null}
        {error ? <div className="settings-message error">{error}</div> : null}
      </section>

      <section className="content-card settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Upgrade behavior</p>
            <h2>Migration + versioning</h2>
          </div>
        </div>
        <div className="check-list settings-check-list">
          <div><span>01</span><div><strong>DB migration tự động</strong><p>Database portable hiện hữu được mở tại data/page-auto.sqlite và chạy migration version còn thiếu.</p></div></div>
          <div><span>02</span><div><strong>Data giữ nguyên khi thay app</strong><p>Thay folder app/version mới nhưng giữ nguyên folder data để tiếp tục cấu hình và lịch sử.</p></div></div>
          <div><span>03</span><div><strong>Backup trước thay đổi lớn</strong><p>Dùng Config Backup nếu chỉ cần sao lưu cấu hình không chứa credential.</p></div></div>
        </div>
      </section>
    </div>
  )
}
