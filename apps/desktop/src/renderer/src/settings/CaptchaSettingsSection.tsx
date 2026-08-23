import { useEffect, useState } from 'react'
import type { CaptchaProviderId, CaptchaSettingsView, SaveCaptchaSettingsInput } from '../../../shared/captchaSettings'
import './settingsSections.css'

const providers: Array<{ id: CaptchaProviderId; name: string }> = [
  { id: 'omocaptcha', name: 'OmoCaptcha' },
  { id: 'ezcaptcha', name: 'EzCaptcha' },
  { id: '2captcha', name: '2Captcha' }
]

function emptyText(): Record<CaptchaProviderId, string> { return { omocaptcha: '', ezcaptcha: '', '2captcha': '' } }
function emptyFlags(): Record<CaptchaProviderId, boolean> { return { omocaptcha: false, ezcaptcha: false, '2captcha': false } }
function errorText(caught: unknown): string { return caught instanceof Error ? caught.message : String(caught) }

export function CaptchaSettingsSection() {
  const [settings, setSettings] = useState<CaptchaSettingsView | null>(null)
  const [defaultProvider, setDefaultProvider] = useState<CaptchaProviderId | null>(null)
  const [enabled, setEnabled] = useState<Record<CaptchaProviderId, boolean>>(emptyFlags)
  const [drafts, setDrafts] = useState<Record<CaptchaProviderId, string>>(emptyText)
  const [clearKeys, setClearKeys] = useState<Record<CaptchaProviderId, boolean>>(emptyFlags)
  const [revealed, setRevealed] = useState<Record<CaptchaProviderId, boolean>>(emptyFlags)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  useEffect(() => {
    void window.pageAuto.getCaptchaSettings().then((next) => {
      setSettings(next)
      setDefaultProvider(next.defaultProvider)
      setEnabled({ omocaptcha: next.providers.omocaptcha.enabled, ezcaptcha: next.providers.ezcaptcha.enabled, '2captcha': next.providers['2captcha'].enabled })
    }).catch((caught) => setFeedback({ kind: 'bad', text: errorText(caught) }))
  }, [])

  const toggle = (providerId: CaptchaProviderId, value: boolean) => {
    setEnabled((current) => ({ ...current, [providerId]: value }))
    if (!value && defaultProvider === providerId) setDefaultProvider(null)
  }

  const save = async () => {
    setBusy(true); setFeedback(null)
    try {
      const payload: SaveCaptchaSettingsInput = {
        defaultProvider: defaultProvider && enabled[defaultProvider] ? defaultProvider : null,
        providers: {
          omocaptcha: { enabled: enabled.omocaptcha, apiKey: drafts.omocaptcha, clearApiKey: clearKeys.omocaptcha },
          ezcaptcha: { enabled: enabled.ezcaptcha, apiKey: drafts.ezcaptcha, clearApiKey: clearKeys.ezcaptcha },
          '2captcha': { enabled: enabled['2captcha'], apiKey: drafts['2captcha'], clearApiKey: clearKeys['2captcha'] }
        }
      }
      const next = await window.pageAuto.saveCaptchaSettings(payload)
      setSettings(next); setDefaultProvider(next.defaultProvider)
      setEnabled({ omocaptcha: next.providers.omocaptcha.enabled, ezcaptcha: next.providers.ezcaptcha.enabled, '2captcha': next.providers['2captcha'].enabled })
      setDrafts(emptyText()); setClearKeys(emptyFlags()); setRevealed(emptyFlags())
      setFeedback({ kind: 'ok', text: 'Đã lưu CAPTCHA.' })
    } catch (caught) { setFeedback({ kind: 'bad', text: errorText(caught) }) } finally { setBusy(false) }
  }

  return <div className="settings-section settings-section-with-actions">
    <div className="settings-section-content"><div className="captcha-section">
      <div className="compact-heading"><div><strong>CAPTCHA Providers</strong><span>API key đã lưu luôn được che.</span></div><label><span>Provider mặc định</span><select value={defaultProvider ?? ''} onChange={(event) => { const next = event.target.value as CaptchaProviderId | ''; setDefaultProvider(next || null); if (next) setEnabled((current) => ({ ...current, [next]: true })) }}><option value="">Chưa chọn</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label></div>
      <div className="captcha-list">{providers.map((provider) => { const state = settings?.providers[provider.id]; return <div className="captcha-row" key={provider.id}><label className="captcha-name"><input type="checkbox" checked={enabled[provider.id]} onChange={(event) => toggle(provider.id, event.target.checked)} /><strong>{provider.name}</strong></label><div className="captcha-key"><input type={revealed[provider.id] ? 'text' : 'password'} autoComplete="off" value={drafts[provider.id]} disabled={clearKeys[provider.id]} onChange={(event) => setDrafts((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder={state?.configured ? `Đã lưu: ${state.maskedApiKey ?? '••••••••'}` : 'Nhập API key'} /><button type="button" className="settings-button small" onClick={() => setRevealed((current) => ({ ...current, [provider.id]: !current[provider.id] }))}>{revealed[provider.id] ? 'Ẩn' : 'Hiện'}</button></div><label className="clear-key"><input type="checkbox" checked={clearKeys[provider.id]} disabled={!state?.configured} onChange={(event) => setClearKeys((current) => ({ ...current, [provider.id]: event.target.checked }))} /> Xóa key</label><span className={state?.configured ? 'provider-state ready' : 'provider-state'}>{state?.configured ? 'Đã lưu' : 'Chưa có key'}</span></div> })}</div>
      <p className="safety-note">Checkpoint, đăng nhập lại và xác minh danh tính vẫn xử lý thủ công; không đưa qua CAPTCHA provider.</p>
    </div></div>
    <div className="inline-settings-actions"><span className={`inline-settings-feedback ${feedback?.kind ?? ''}`}>{feedback?.text ?? 'API key nhạy cảm không được ghi vào log.'}</span><div><button type="button" className="settings-button primary" disabled={busy || settings === null} onClick={() => void save()}>{busy ? 'Đang lưu...' : 'Lưu CAPTCHA'}</button></div></div>
  </div>
}