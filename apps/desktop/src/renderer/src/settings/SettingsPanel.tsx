import { useEffect, useState } from 'react'
import type { AppInfo } from '../../../ipc/channels'
import type {
  CaptchaProviderId,
  CaptchaSettingsView,
  SaveCaptchaSettingsInput
} from '../../../shared/captchaSettings'
import './settings.css'

interface SettingsPanelProps {
  appInfo: AppInfo | null
}

const providerDefinitions: Array<{ id: CaptchaProviderId; name: string; note: string }> = [
  { id: 'omocaptcha', name: 'OmoCaptcha', note: 'API key dùng cho adapter OmoCaptcha.' },
  { id: 'ezcaptcha', name: 'EzCaptcha', note: 'API key dùng cho adapter EzCaptcha.' },
  { id: '2captcha', name: '2Captcha', note: 'API key dùng cho adapter 2Captcha.' }
]

function emptyProviderText(): Record<CaptchaProviderId, string> {
  return { omocaptcha: '', ezcaptcha: '', '2captcha': '' }
}

function emptyProviderFlags(): Record<CaptchaProviderId, boolean> {
  return { omocaptcha: false, ezcaptcha: false, '2captcha': false }
}

export function SettingsPanel({ appInfo }: SettingsPanelProps) {
  const [busy, setBusy] = useState<'export' | 'restore' | 'captcha' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [captcha, setCaptcha] = useState<CaptchaSettingsView | null>(null)
  const [defaultProvider, setDefaultProvider] = useState<CaptchaProviderId | null>(null)
  const [enabledProviders, setEnabledProviders] = useState<Record<CaptchaProviderId, boolean>>(emptyProviderFlags)
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<CaptchaProviderId, string>>(emptyProviderText)
  const [clearKeys, setClearKeys] = useState<Record<CaptchaProviderId, boolean>>(emptyProviderFlags)
  const [revealedDrafts, setRevealedDrafts] = useState<Record<CaptchaProviderId, boolean>>(emptyProviderFlags)

  useEffect(() => {
    void window.pageAuto.getCaptchaSettings().then((settings) => {
      setCaptcha(settings)
      setDefaultProvider(settings.defaultProvider)
      setEnabledProviders({
        omocaptcha: settings.providers.omocaptcha.enabled,
        ezcaptcha: settings.providers.ezcaptcha.enabled,
        '2captcha': settings.providers['2captcha'].enabled
      })
    }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [])

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

  const toggleProvider = (providerId: CaptchaProviderId, enabled: boolean) => {
    setEnabledProviders((current) => ({ ...current, [providerId]: enabled }))
    if (!enabled && defaultProvider === providerId) setDefaultProvider(null)
  }

  const saveCaptcha = async () => {
    setBusy('captcha')
    setMessage(null)
    setError(null)
    try {
      const payload: SaveCaptchaSettingsInput = {
        defaultProvider: defaultProvider && enabledProviders[defaultProvider] ? defaultProvider : null,
        providers: {
          omocaptcha: {
            enabled: enabledProviders.omocaptcha,
            apiKey: apiKeyDrafts.omocaptcha,
            clearApiKey: clearKeys.omocaptcha
          },
          ezcaptcha: {
            enabled: enabledProviders.ezcaptcha,
            apiKey: apiKeyDrafts.ezcaptcha,
            clearApiKey: clearKeys.ezcaptcha
          },
          '2captcha': {
            enabled: enabledProviders['2captcha'],
            apiKey: apiKeyDrafts['2captcha'],
            clearApiKey: clearKeys['2captcha']
          }
        }
      }
      const saved = await window.pageAuto.saveCaptchaSettings(payload)
      setCaptcha(saved)
      setDefaultProvider(saved.defaultProvider)
      setEnabledProviders({
        omocaptcha: saved.providers.omocaptcha.enabled,
        ezcaptcha: saved.providers.ezcaptcha.enabled,
        '2captcha': saved.providers['2captcha'].enabled
      })
      setApiKeyDrafts(emptyProviderText())
      setClearKeys(emptyProviderFlags())
      setRevealedDrafts(emptyProviderFlags())
      setMessage('Đã lưu cấu hình CAPTCHA providers.')
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
          <div><span>Phân phối</span><strong>Windows folder / ZIP portable</strong></div>
          <div><span>Executable</span><strong>PageAuto.exe</strong></div>
          <div className="settings-path"><span>Data folder</span><strong title={appInfo?.dataDirectory ?? ''}>{appInfo?.dataDirectory ?? 'Đang đọc...'}</strong></div>
        </div>

        <p className="settings-note">
          Bản packaged lưu SQLite, browser profile, logs và screenshots trong folder <code>data</code> cạnh PageAuto.exe.
          Không dùng installer/Setup/NSIS trong MVP.
        </p>
      </section>

      <section className="content-card settings-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Challenge services</p>
            <h2>CAPTCHA Providers</h2>
          </div>
          <span className="settings-safe-chip">API key masked</span>
        </div>

        <p className="settings-note captcha-intro">
          Cấu hình provider dùng chung cho runtime adapter. API key được lưu local trong <code>app_settings</code>, không trả plaintext về UI sau khi lưu và không nằm trong Config Backup.
        </p>

        <div className="captcha-default-row">
          <label>
            <span>Provider mặc định</span>
            <select value={defaultProvider ?? ''} onChange={(event) => {
              const next = event.target.value as CaptchaProviderId | ''
              setDefaultProvider(next || null)
              if (next) setEnabledProviders((current) => ({ ...current, [next]: true }))
            }}>
              <option value="">Chưa chọn</option>
              {providerDefinitions.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
          </label>
          <span>Checkpoint/login/xác minh danh tính vẫn tách khỏi CAPTCHA provider flow.</span>
        </div>

        <div className="captcha-provider-list">
          {providerDefinitions.map((provider) => {
            const state = captcha?.providers[provider.id]
            const clearing = clearKeys[provider.id]
            return (
              <div className="captcha-provider-row" key={provider.id}>
                <div className="captcha-provider-name">
                  <label className="provider-toggle">
                    <input type="checkbox" checked={enabledProviders[provider.id]} onChange={(event) => toggleProvider(provider.id, event.target.checked)} />
                    <strong>{provider.name}</strong>
                  </label>
                  <span>{provider.note}</span>
                </div>

                <div className="captcha-key-field">
                  <span>API key</span>
                  <div>
                    <input
                      type={revealedDrafts[provider.id] ? 'text' : 'password'}
                      autoComplete="off"
                      value={apiKeyDrafts[provider.id]}
                      disabled={clearing}
                      onChange={(event) => setApiKeyDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}
                      placeholder={state?.configured ? `Đã lưu: ${state.maskedApiKey ?? '••••••••'}` : 'Nhập API key'}
                    />
                    <button type="button" className="button secondary compact" disabled={clearing} onClick={() => setRevealedDrafts((current) => ({ ...current, [provider.id]: !current[provider.id] }))}>
                      {revealedDrafts[provider.id] ? 'Ẩn' : 'Hiện'}
                    </button>
                  </div>
                </div>

                <label className="captcha-clear-key">
                  <input type="checkbox" checked={clearing} disabled={!state?.configured} onChange={(event) => setClearKeys((current) => ({ ...current, [provider.id]: event.target.checked }))} />
                  Xóa key đã lưu
                </label>

                <span className={`captcha-provider-state ${state?.configured ? 'configured' : ''}`}>
                  {state?.configured ? 'Configured' : 'No key'}
                </span>
              </div>
            )
          })}
        </div>

        <div className="settings-actions">
          <button type="button" className="button primary" disabled={busy !== null || captcha === null} onClick={() => void saveCaptcha()}>
            {busy === 'captcha' ? 'Đang lưu...' : 'Lưu CAPTCHA settings'}
          </button>
        </div>
      </section>

      <section className="content-card settings-card">
        <div className="section-heading">
          <div><p className="eyebrow">Config backup</p><h2>Backup / Restore cấu hình</h2></div>
          <span className="settings-safe-chip">No plaintext secrets</span>
        </div>

        <div className="settings-backup-copy">
          <p>Backup gồm Page Tabs, Group/Content/Schedule/Image config, account reference theo UID, Import Presets và layout cột.</p>
          <p>File backup mặc định <strong>không chứa password, cookie/session, 2FA, email password, proxy password, CAPTCHA API key, browser profile, log hoặc screenshot</strong>.</p>
          <p>Restore sẽ merge theo Page UID/tên tab. Account chưa có sẽ được tạo dạng shell <code>unknown</code> để anh đăng nhập lại thủ công.</p>
        </div>

        <div className="settings-actions">
          <button type="button" className="button primary" disabled={busy !== null} onClick={() => void exportBackup()}>{busy === 'export' ? 'Đang xuất...' : 'Xuất backup cấu hình'}</button>
          <button type="button" className="button" disabled={busy !== null} onClick={() => void restoreBackup()}>{busy === 'restore' ? 'Đang restore...' : 'Khôi phục từ backup'}</button>
        </div>

        {message ? <div className="settings-message success">{message}</div> : null}
        {error ? <div className="settings-message error">{error}</div> : null}
      </section>

      <section className="content-card settings-card">
        <div className="section-heading"><div><p className="eyebrow">Upgrade behavior</p><h2>Migration + versioning</h2></div></div>
        <div className="check-list settings-check-list">
          <div><span>01</span><div><strong>DB migration tự động</strong><p>Database portable hiện hữu được mở tại data/page-auto.sqlite và chạy migration version còn thiếu.</p></div></div>
          <div><span>02</span><div><strong>Data giữ nguyên khi thay app</strong><p>Thay folder app/version mới nhưng giữ nguyên folder data để tiếp tục cấu hình và lịch sử.</p></div></div>
          <div><span>03</span><div><strong>Backup trước thay đổi lớn</strong><p>Dùng Config Backup nếu chỉ cần sao lưu cấu hình không chứa credential/API key.</p></div></div>
        </div>
      </section>
    </div>
  )
}
