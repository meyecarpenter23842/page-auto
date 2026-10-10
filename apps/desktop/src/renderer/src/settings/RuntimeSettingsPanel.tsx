import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_APP_SETTINGS, type RuntimeSettings } from '../../../shared/appSettings'
import './runtimeSettings.css'

function copyRuntime(settings: RuntimeSettings): RuntimeSettings {
  return { ...settings }
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

export function RuntimeSettingsPanel() {
  const [saved, setSaved] = useState<RuntimeSettings | null>(null)
  const [draft, setDraft] = useState<RuntimeSettings | null>(null)
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
        const runtime = copyRuntime(settings.runtime)
        setSaved(runtime)
        setDraft(copyRuntime(runtime))
      })
      .catch((caught) => setError(errorText(caught)))
  }, [])

  const update = <K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]) => {
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
      const next = await window.pageAuto.updateAppSettings({ runtime: draft })
      const runtime = copyRuntime(next.runtime)
      setSaved(runtime)
      setDraft(copyRuntime(runtime))
      setMessage('Đã lưu cài đặt Vận hành.')
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!draft) return <div className="settings-empty">Đang đọc cài đặt Vận hành...</div>

  return <div className="settings-section runtime-settings-section">
    <div className="runtime-summary-row">
      <div><span>Page Tab đồng thời</span><strong>{draft.maxActivePageTabs}</strong></div>
      <div><span>Runtime / account job</span><strong>{draft.maxAccountRuntimeSeconds}s</strong></div>
      <div><span>Ngưỡng lỗi liên tiếp</span><strong>{draft.consecutiveFailureLimit}</strong></div>
    </div>

    <div className="runtime-settings-grid">
      <label className="number-field"><span>Page Tab chạy đồng thời</span><div><input type="number" min="1" max="20" step="1" value={draft.maxActivePageTabs} onChange={(event) => update('maxActivePageTabs', Math.round(Number(event.target.value)))} /><em>tab</em></div></label>
      <label className="number-field"><span>Khoảng cách mở Chrome/Profile toàn app</span><div><input type="number" min="0" max="120" step="1" value={draft.browserLaunchSpacingMs / 1000} onChange={(event) => update('browserLaunchSpacingMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div></label>
      <label className="number-field"><span>Runtime tối đa / account job</span><div><input type="number" min="30" max="86400" step="10" value={draft.maxAccountRuntimeSeconds} onChange={(event) => update('maxAccountRuntimeSeconds', Math.round(Number(event.target.value)))} /><em>giây</em></div></label>
      <label className="number-field"><span>Retry lỗi mở browser</span><div><input type="number" min="0" max="10" step="1" value={draft.browserCrashRetryCount} onChange={(event) => update('browserCrashRetryCount', Math.round(Number(event.target.value)))} /><em>lần</em></div></label>
      <label className="number-field"><span>Retry điều hướng</span><div><input type="number" min="0" max="10" step="1" value={draft.navigationRetryCount} onChange={(event) => update('navigationRetryCount', Math.round(Number(event.target.value)))} /><em>lần</em></div></label>
      <label className="number-field"><span>Retry action an toàn</span><div><input type="number" min="0" max="10" step="1" value={draft.safeActionRetryCount} onChange={(event) => update('safeActionRetryCount', Math.round(Number(event.target.value)))} /><em>lần</em></div></label>
      <label className="number-field"><span>Delay trước retry</span><div><input type="number" min="0" max="120" step="1" value={draft.retryDelayMs / 1000} onChange={(event) => update('retryDelayMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div></label>
      <label className="number-field"><span>Lỗi liên tiếp trước khi đổi account</span><div><input type="number" min="1" max="100" step="1" value={draft.consecutiveFailureLimit} onChange={(event) => update('consecutiveFailureLimit', Math.round(Number(event.target.value)))} /><em>lỗi</em></div></label>

      <div className="runtime-safety-card runtime-wide">
        <strong>Không retry mù sau publish</strong>
        <p>Worker timeout/crash, publish chưa xác nhận và lỗi bất ngờ được đưa sang manual-review. Retry tự động chỉ áp dụng lỗi chắc chắn trước publish theo từng budget ở trên.</p>
      </div>
    </div>

    <div className="runtime-action-row">
      <div className="runtime-feedback">{error ? <span className="bad">{error}</span> : message ? <span className="ok">{message}</span> : <span>Các giới hạn runtime mới được áp dụng cho job/tab tiếp theo.</span>}</div>
      <div>
        <button type="button" className="settings-button" disabled={busy} onClick={() => setDraft(copyRuntime(DEFAULT_APP_SETTINGS.runtime))}>Mặc định</button>
        <button type="button" className="settings-button" disabled={busy || !dirty} onClick={() => saved && setDraft(copyRuntime(saved))}>Hủy</button>
        <button type="button" className="settings-button primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Đang lưu...' : 'Lưu Vận hành'}</button>
      </div>
    </div>
  </div>
}
