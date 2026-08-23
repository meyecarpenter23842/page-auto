import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_APP_SETTINGS,
  type FacebookLocale,
  type SessionFailurePolicy,
  type SessionSettings
} from '../../../shared/appSettings'
import './sessionSettings.css'

function copySession(settings: SessionSettings): SessionSettings {
  return { ...settings }
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

export function SessionSettingsPanel() {
  const [saved, setSaved] = useState<SessionSettings | null>(null)
  const [draft, setDraft] = useState<SessionSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = useMemo(
    () => Boolean(saved && draft && JSON.stringify(saved) !== JSON.stringify(draft)),
    [draft, saved]
  )

  useEffect(() => {
    void window.pageAuto.getAppSettings()
      .then((settings) => {
        const session = copySession(settings.session)
        setSaved(session)
        setDraft(copySession(session))
      })
      .catch((caught) => setError(errorText(caught)))
  }, [])

  const update = <K extends keyof SessionSettings>(key: K, value: SessionSettings[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current)
    setMessage(null)
    setError(null)
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const next = await window.pageAuto.updateAppSettings({ session: draft })
      const session = copySession(next.session)
      setSaved(session)
      setDraft(copySession(session))
      setMessage('Đã lưu cài đặt đăng nhập/session.')
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!draft) return <div className="settings-empty">Đang đọc cài đặt đăng nhập...</div>

  return <div className="settings-section session-settings-section">
    <div className="session-summary-row">
      <div><span>Session trước khi chạy</span><strong>{draft.validateBeforeRun ? 'Có kiểm tra' : 'Không kiểm tra'}</strong></div>
      <div><span>Ngôn ngữ Facebook</span><strong>{draft.facebookLocale === 'auto' ? 'Tự động' : draft.facebookLocale}</strong></div>
      <div><span>Profile</span><strong>Lưu riêng từng account</strong></div>
    </div>

    <div className="session-settings-grid">
      <label className="toggle-card">
        <div><strong>Kiểm tra trước khi chạy</strong><small>Kiểm tra/login session trước khi lấy Page và đăng bài.</small></div>
        <input type="checkbox" checked={draft.validateBeforeRun} onChange={(event) => update('validateBeforeRun', event.target.checked)} />
      </label>
      <label className="toggle-card">
        <div><strong>Kiểm tra sau khi chạy</strong><small>Kiểm tra lại session sau khi đã xác nhận bài đăng thành công.</small></div>
        <input type="checkbox" checked={draft.validateAfterRun} onChange={(event) => update('validateAfterRun', event.target.checked)} />
      </label>

      <label className="session-field">
        <span>Ngôn ngữ Facebook</span>
        <select value={draft.facebookLocale} onChange={(event) => update('facebookLocale', event.target.value as FacebookLocale)}>
          <option value="auto">Tự động</option>
          <option value="vi-VN">Tiếng Việt</option>
          <option value="en-US">English</option>
        </select>
        <small>Dùng locale cookie chuẩn của Facebook, không đổi fingerprint/anti-detection.</small>
      </label>

      <label className="session-field">
        <span>Khi session hết / cần đăng nhập lại</span>
        <select value={draft.onSessionExpired} onChange={(event) => update('onSessionExpired', event.target.value as SessionFailurePolicy)}>
          <option value="needs_login_continue">Đánh dấu needs_login, chuyển account kế</option>
          <option value="needs_login_stop">Đánh dấu needs_login, pause Page Tab</option>
        </select>
        <small>Group chưa đăng sẽ được trả lại hàng chờ của run hiện tại.</small>
      </label>

      <label className="session-field">
        <span>Khi gặp checkpoint / xác minh danh tính</span>
        <select value={draft.onCheckpoint} onChange={(event) => update('onCheckpoint', event.target.value as SessionFailurePolicy)}>
          <option value="needs_login_continue">Đánh dấu needs_login, chuyển account kế</option>
          <option value="needs_login_stop">Đánh dấu needs_login, pause Page Tab</option>
        </select>
        <small>Checkpoint/identity luôn để người vận hành xử lý thủ công.</small>
      </label>

      <div className="session-2fa-card">
        <div className="session-2fa-mark">2FA</div>
        <div>
          <strong>Mã từ ứng dụng xác thực</strong>
          <p>Nếu Facebook yêu cầu mã authenticator, PAGE-AUTO lấy field 2FA của account, tạo/đọc mã, điền và xác minh session. Nếu Facebook chuyển sang checkpoint/xác minh danh tính khác, tool dừng theo policy và không bypass.</p>
        </div>
      </div>
    </div>

    <div className="session-action-row">
      <div className="session-feedback">{error ? <span className="bad">{error}</span> : message ? <span className="ok">{message}</span> : <span>Persistent profile: data/browser-profiles/account-&lt;id&gt;</span>}</div>
      <div>
        <button type="button" className="settings-button" disabled={busy} onClick={() => setDraft(copySession(DEFAULT_APP_SETTINGS.session))}>Mặc định</button>
        <button type="button" className="settings-button" disabled={busy || !dirty} onClick={() => saved && setDraft(copySession(saved))}>Hủy</button>
        <button type="button" className="settings-button primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Đang lưu...' : 'Lưu đăng nhập'}</button>
      </div>
    </div>
  </div>
}