import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_APP_SETTINGS, type NetworkSettings } from '../../../shared/appSettings'
import './networkSettings.css'

function copyNetwork(settings: NetworkSettings): NetworkSettings {
  return { ...settings }
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

export function NetworkSettingsPanel() {
  const [saved, setSaved] = useState<NetworkSettings | null>(null)
  const [draft, setDraft] = useState<NetworkSettings | null>(null)
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
        const network = copyNetwork(settings.network)
        setSaved(network)
        setDraft(copyNetwork(network))
      })
      .catch((caught) => setError(errorText(caught)))
  }, [])

  const update = <K extends keyof NetworkSettings>(key: K, value: NetworkSettings[K]) => {
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
      const next = await window.pageAuto.updateAppSettings({ network: draft })
      const network = copyNetwork(next.network)
      setSaved(network)
      setDraft(copyNetwork(network))
      setMessage('Đã lưu cài đặt Proxy & Mạng.')
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!draft) return <div className="settings-empty">Đang đọc cài đặt Proxy & Mạng...</div>

  return <div className="settings-section network-settings-section">
    <div className="network-summary-row">
      <div><span>Preflight proxy</span><strong>{draft.checkProxyBeforeRun ? 'Đang bật' : 'Đang tắt'}</strong></div>
      <div><span>Timeout mạng</span><strong>{Math.round(draft.networkTimeoutMs / 1000)} giây</strong></div>
      <div><span>Khi proxy lỗi</span><strong>{draft.abortAccountOnProxyFailure ? 'Chuyển account' : 'Pause Page Tab'}</strong></div>
    </div>

    <div className="network-settings-grid">
      <label className="toggle-card network-wide">
        <div><strong>Kiểm tra proxy trước khi chạy</strong><small>Nếu account có proxy, worker kiểm tra kết nối qua chính proxy đó trước khi login/posting.</small></div>
        <input type="checkbox" checked={draft.checkProxyBeforeRun} onChange={(event) => update('checkProxyBeforeRun', event.target.checked)} />
      </label>

      <label className="number-field">
        <span>Timeout kết nối proxy</span>
        <div><input type="number" min="1" max="300" value={draft.proxyConnectionTimeoutMs / 1000} onChange={(event) => update('proxyConnectionTimeoutMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div>
      </label>
      <label className="number-field">
        <span>Timeout mạng</span>
        <div><input type="number" min="1" max="300" value={draft.networkTimeoutMs / 1000} onChange={(event) => update('networkTimeoutMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div>
      </label>
      <label className="number-field">
        <span>Thử lại proxy</span>
        <div><input type="number" min="0" max="10" step="1" value={draft.proxyRetryCount} onChange={(event) => update('proxyRetryCount', Math.round(Number(event.target.value)))} /><em>lần</em></div>
      </label>

      <label className="toggle-card network-wide">
        <div><strong>Bỏ account hiện tại khi proxy lỗi</strong><small>Bật: trả Group về pending rồi chuyển account kế. Tắt: pause Page Tab để người vận hành xử lý.</small></div>
        <input type="checkbox" checked={draft.abortAccountOnProxyFailure} onChange={(event) => update('abortAccountOnProxyFailure', event.target.checked)} />
      </label>

      <div className="network-safety-card network-wide">
        <strong>Không fallback sang IP trực tiếp</strong>
        <p>Nếu account đã khai báo proxy nhưng proxy sai định dạng hoặc không kết nối được, PAGE-AUTO không tự bỏ proxy để chạy bằng mạng thật. Group chưa đăng vẫn ở lại run.</p>
      </div>
    </div>

    <div className="network-action-row">
      <div className="network-feedback">{error ? <span className="bad">{error}</span> : message ? <span className="ok">{message}</span> : <span>Proxy credential không được hiển thị trong thông báo lỗi runtime.</span>}</div>
      <div>
        <button type="button" className="settings-button" disabled={busy} onClick={() => setDraft(copyNetwork(DEFAULT_APP_SETTINGS.network))}>Mặc định</button>
        <button type="button" className="settings-button" disabled={busy || !dirty} onClick={() => saved && setDraft(copyNetwork(saved))}>Hủy</button>
        <button type="button" className="settings-button primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Đang lưu...' : 'Lưu Proxy & Mạng'}</button>
      </div>
    </div>
  </div>
}
