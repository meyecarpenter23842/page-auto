import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_APP_SETTINGS, type LoggingSettings } from '../../../shared/appSettings'
import './loggingSettings.css'

function copyLogging(settings: LoggingSettings): LoggingSettings { return { ...settings } }
function errorText(caught: unknown): string { return caught instanceof Error ? caught.message : String(caught) }

export function LoggingSettingsPanel() {
  const [saved, setSaved] = useState<LoggingSettings | null>(null)
  const [draft, setDraft] = useState<LoggingSettings | null>(null)
  const [busy, setBusy] = useState<'save' | 'cleanup' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = useMemo(() => Boolean(saved && draft && JSON.stringify(saved) !== JSON.stringify(draft)), [draft, saved])

  useEffect(() => {
    void window.pageAuto.getAppSettings()
      .then((settings) => {
        const logging = copyLogging(settings.logging)
        setSaved(logging)
        setDraft(copyLogging(logging))
      })
      .catch((caught) => setError(errorText(caught)))
  }, [])

  const update = <K extends keyof LoggingSettings>(key: K, value: LoggingSettings[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current)
    setMessage(null)
    setError(null)
  }

  const save = async () => {
    if (!draft) return
    setBusy('save'); setMessage(null); setError(null)
    try {
      const next = await window.pageAuto.updateAppSettings({ logging: draft })
      const logging = copyLogging(next.logging)
      setSaved(logging)
      setDraft(copyLogging(logging))
      setMessage('Đã lưu cài đặt Nhật ký.')
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(null)
    }
  }

  const cleanupNow = async () => {
    setBusy('cleanup'); setMessage(null); setError(null)
    try {
      const result = await window.pageAuto.cleanupExecutionLogs()
      setMessage(result.message)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(null)
    }
  }

  if (!draft) return <div className="settings-empty">Đang đọc cài đặt Nhật ký...</div>

  return <div className="settings-section logging-settings-section">
    <div className="logging-summary-row">
      <div><span>Mức log</span><strong>{draft.level === 'error' ? 'Chỉ lỗi' : draft.level === 'debug' ? 'Debug' : 'Bình thường'}</strong></div>
      <div><span>Thời gian lưu</span><strong>{draft.retentionDays === null ? 'Không giới hạn' : `${draft.retentionDays} ngày`}</strong></div>
      <div><span>Evidence lỗi</span><strong>{draft.screenshotOnFailure || draft.playwrightTrace ? 'Đang bật' : 'Tối giản'}</strong></div>
    </div>

    <div className="logging-settings-grid">
      <label className="field"><span>Mức nhật ký</span><select value={draft.level} onChange={(event) => update('level', event.target.value as LoggingSettings['level'])}><option value="error">Chỉ lỗi</option><option value="normal">Bình thường</option><option value="debug">Debug chi tiết</option></select></label>
      <label className="field"><span>Giữ nhật ký</span><select value={draft.retentionDays === null ? 'forever' : String(draft.retentionDays)} onChange={(event) => update('retentionDays', event.target.value === 'forever' ? null : Number(event.target.value) as LoggingSettings['retentionDays'])}><option value="7">7 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option><option value="forever">Không giới hạn</option></select></label>

      <label className="toggle-card"><div><strong>Tự dọn nhật ký cũ</strong><small>Dọn DB log, screenshot và trace quá hạn khi app mở hoặc lưu setting.</small></div><input type="checkbox" checked={draft.autoCleanup} onChange={(event) => update('autoCleanup', event.target.checked)} /></label>
      <label className="toggle-card"><div><strong>Chụp ảnh khi lỗi</strong><small>Lưu PNG vào data/screenshots để đối chiếu lỗi giao diện.</small></div><input type="checkbox" checked={draft.screenshotOnFailure} onChange={(event) => update('screenshotOnFailure', event.target.checked)} /></label>
      <label className="toggle-card"><div><strong>Lưu URL khi lỗi</strong><small>Chỉ lưu origin + path; bỏ query/hash để giảm rủi ro lộ token.</small></div><input type="checkbox" checked={draft.saveCurrentUrlOnFailure} onChange={(event) => update('saveCurrentUrlOnFailure', event.target.checked)} /></label>
      <label className="toggle-card"><div><strong>Playwright trace khi lỗi</strong><small>Ghi trace ZIP cho job lỗi; tốn thêm dung lượng và I/O.</small></div><input type="checkbox" checked={draft.playwrightTrace} onChange={(event) => update('playwrightTrace', event.target.checked)} /></label>

      <div className="logging-info-card logging-wide">
        <strong>Ý nghĩa mức log</strong>
        <p><b>Chỉ lỗi:</b> giữ failure/needs-login. <b>Bình thường:</b> giữ kết quả cuối mỗi logical posting job, bỏ retry trung gian. <b>Debug:</b> giữ từng attempt để chẩn đoán.</p>
      </div>
    </div>

    <div className="logging-action-row">
      <div className="logging-feedback">{error ? <span className="bad">{error}</span> : message ? <span className="ok">{message}</span> : <span>Credential vẫn được redaction trước khi ghi execution log.</span>}</div>
      <div>
        <button type="button" className="settings-button" disabled={busy !== null} onClick={() => void cleanupNow()}>{busy === 'cleanup' ? 'Đang dọn...' : 'Dọn ngay'}</button>
        <button type="button" className="settings-button" disabled={busy !== null} onClick={() => setDraft(copyLogging(DEFAULT_APP_SETTINGS.logging))}>Mặc định</button>
        <button type="button" className="settings-button" disabled={busy !== null || !dirty} onClick={() => saved && setDraft(copyLogging(saved))}>Hủy</button>
        <button type="button" className="settings-button primary" disabled={busy !== null || !dirty} onClick={() => void save()}>{busy === 'save' ? 'Đang lưu...' : 'Lưu Nhật ký'}</button>
      </div>
    </div>
  </div>
}
