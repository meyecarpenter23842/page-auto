import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../../ipc/channels'
import type { BrowserSettings } from '../../../shared/appSettings'
import './settingsSections.css'

interface AdvancedSettingsSectionProps { appInfo: AppInfo | null }
type BusyState = 'save' | 'export' | 'restore' | null

function copyBrowser(settings: BrowserSettings): BrowserSettings { return { ...settings } }
function errorText(caught: unknown): string { return caught instanceof Error ? caught.message : String(caught) }

export function AdvancedSettingsSection({ appInfo }: AdvancedSettingsSectionProps) {
  const [saved, setSaved] = useState<BrowserSettings | null>(null)
  const [draft, setDraft] = useState<BrowserSettings | null>(null)
  const [busy, setBusy] = useState<BusyState>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const dirty = useMemo(() => Boolean(saved && draft && JSON.stringify(saved) !== JSON.stringify(draft)), [draft, saved])

  useEffect(() => {
    void window.pageAuto.getAppSettings().then((settings) => {
      const browser = copyBrowser(settings.browser)
      setSaved(browser); setDraft(copyBrowser(browser))
    }).catch((caught) => setFeedback({ kind: 'bad', text: errorText(caught) }))
  }, [])

  const save = async () => {
    if (!draft) return
    setBusy('save'); setFeedback(null)
    try {
      const next = await window.pageAuto.updateAppSettings({ browser: draft })
      const browser = copyBrowser(next.browser)
      setSaved(browser); setDraft(copyBrowser(browser))
      setFeedback({ kind: 'ok', text: 'Đã lưu cài đặt nâng cao.' })
    } catch (caught) { setFeedback({ kind: 'bad', text: errorText(caught) }) } finally { setBusy(null) }
  }

  const exportBackup = async () => {
    setBusy('export'); setFeedback(null)
    try {
      const result = await window.pageAuto.exportConfigBackup()
      setFeedback({ kind: 'ok', text: result.message })
    } catch (caught) { setFeedback({ kind: 'bad', text: errorText(caught) }) } finally { setBusy(null) }
  }

  const restoreBackup = async () => {
    setBusy('restore'); setFeedback(null)
    try {
      const result = await window.pageAuto.restoreConfigBackup()
      setFeedback({ kind: 'ok', text: result.message })
    } catch (caught) { setFeedback({ kind: 'bad', text: errorText(caught) }) } finally { setBusy(null) }
  }

  if (!draft) return <div className="settings-empty">Đang đọc cài đặt nâng cao...</div>

  return <div className="settings-section settings-section-with-actions">
    <div className="settings-section-content"><div className="advanced-section">
      <div className="advanced-grid">
        <label className="toggle-card wide"><div><strong>Tắt tăng tốc phần cứng</strong><small>Dùng khi VPS hoặc máy yếu gặp lỗi hiển thị Chrome.</small></div><input type="checkbox" checked={draft.disableGpu} onChange={(event) => { setDraft({ ...draft, disableGpu: event.target.checked }); setFeedback(null) }} /></label>
        <div className="info-card"><span>Phiên bản PAGE-AUTO</span><strong>{appInfo ? `v${appInfo.version}` : '...'}</strong><small>{appInfo?.isPackaged ? 'Bản portable' : 'Bản development'}</small></div>
        <div className="info-card path-card"><span>Data</span><strong title={appInfo?.dataDirectory ?? ''}>{appInfo?.dataDirectory ?? '...'}</strong><small>SQLite, profile, log và screenshot.</small></div>
      </div>
      <div className="backup-box"><div><strong>Sao lưu cấu hình</strong><p>Backup không chứa password, cookie, 2FA, proxy password hay CAPTCHA API key.</p></div><div><button className="settings-button primary" type="button" disabled={busy !== null} onClick={() => void exportBackup()}>{busy === 'export' ? 'Đang xuất...' : 'Xuất backup'}</button><button className="settings-button" type="button" disabled={busy !== null} onClick={() => void restoreBackup()}>{busy === 'restore' ? 'Đang khôi phục...' : 'Khôi phục backup'}</button></div></div>
    </div></div>
    <div className="inline-settings-actions"><span className={`inline-settings-feedback ${feedback?.kind ?? ''}`}>{feedback?.text ?? 'Backup cấu hình loại bỏ dữ liệu đăng nhập nhạy cảm.'}</span><div><button type="button" className="settings-button" disabled={!dirty || busy !== null} onClick={() => saved && setDraft(copyBrowser(saved))}>Hủy</button><button type="button" className="settings-button primary" disabled={!dirty || busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Đang lưu...' : 'Lưu nâng cao'}</button></div></div>
  </div>
}