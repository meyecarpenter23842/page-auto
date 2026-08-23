import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../../ipc/channels'
import { DEFAULT_APP_SETTINGS, type BrowserSettings } from '../../../shared/appSettings'
import type { BrowserExecutableResult, BrowserTestResult } from '../../../shared/browserSettings'
import type { CaptchaProviderId, CaptchaSettingsView, SaveCaptchaSettingsInput } from '../../../shared/captchaSettings'
import './settings.css'

interface SettingsPanelProps { appInfo: AppInfo | null }
type SettingsSection = 'browser' | 'session' | 'network' | 'runtime' | 'logs' | 'captcha' | 'advanced' | 'health'
type BusyState = 'save-browser' | 'detect' | 'pick' | 'test' | 'captcha' | 'export' | 'restore' | null

const sections: Array<{ id: SettingsSection; label: string; mark: string }> = [
  { id: 'browser', label: 'Trình duyệt', mark: 'BR' },
  { id: 'session', label: 'Đăng nhập', mark: 'SS' },
  { id: 'network', label: 'Proxy & Mạng', mark: 'NW' },
  { id: 'runtime', label: 'Vận hành', mark: 'RT' },
  { id: 'logs', label: 'Nhật ký', mark: 'LG' },
  { id: 'captcha', label: 'CAPTCHA', mark: 'CP' },
  { id: 'advanced', label: 'Nâng cao', mark: 'AD' },
  { id: 'health', label: 'Kiểm tra hệ thống', mark: 'OK' }
]

const providerDefinitions: Array<{ id: CaptchaProviderId; name: string }> = [
  { id: 'omocaptcha', name: 'OmoCaptcha' }, { id: 'ezcaptcha', name: 'EzCaptcha' }, { id: '2captcha', name: '2Captcha' }
]

function emptyProviderText(): Record<CaptchaProviderId, string> { return { omocaptcha: '', ezcaptcha: '', '2captcha': '' } }
function emptyProviderFlags(): Record<CaptchaProviderId, boolean> { return { omocaptcha: false, ezcaptcha: false, '2captcha': false } }
function copyBrowser(settings: BrowserSettings): BrowserSettings { return { ...settings } }
function errorText(caught: unknown): string { return caught instanceof Error ? caught.message : String(caught) }

export function SettingsPanel({ appInfo }: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('browser')
  const [busy, setBusy] = useState<BusyState>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [browserSaved, setBrowserSaved] = useState<BrowserSettings | null>(null)
  const [browserDraft, setBrowserDraft] = useState<BrowserSettings | null>(null)
  const [browserProbe, setBrowserProbe] = useState<BrowserExecutableResult | null>(null)
  const [browserTest, setBrowserTest] = useState<BrowserTestResult | null>(null)
  const [captcha, setCaptcha] = useState<CaptchaSettingsView | null>(null)
  const [defaultProvider, setDefaultProvider] = useState<CaptchaProviderId | null>(null)
  const [enabledProviders, setEnabledProviders] = useState<Record<CaptchaProviderId, boolean>>(emptyProviderFlags)
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<CaptchaProviderId, string>>(emptyProviderText)
  const [clearKeys, setClearKeys] = useState<Record<CaptchaProviderId, boolean>>(emptyProviderFlags)
  const [revealedDrafts, setRevealedDrafts] = useState<Record<CaptchaProviderId, boolean>>(emptyProviderFlags)

  const browserDirty = useMemo(() => Boolean(browserSaved && browserDraft && JSON.stringify(browserSaved) !== JSON.stringify(browserDraft)), [browserDraft, browserSaved])

  useEffect(() => {
    void window.pageAuto.getAppSettings().then(async (settings) => {
      const saved = copyBrowser(settings.browser)
      setBrowserSaved(saved)
      setBrowserDraft(copyBrowser(saved))
      setBrowserProbe(saved.executablePath ? await window.pageAuto.probeChromeExecutable(saved.executablePath) : await window.pageAuto.detectChrome())
    }).catch((caught) => setError(errorText(caught)))

    void window.pageAuto.getCaptchaSettings().then((settings) => {
      setCaptcha(settings)
      setDefaultProvider(settings.defaultProvider)
      setEnabledProviders({ omocaptcha: settings.providers.omocaptcha.enabled, ezcaptcha: settings.providers.ezcaptcha.enabled, '2captcha': settings.providers['2captcha'].enabled })
    }).catch((caught) => setError(errorText(caught)))
  }, [])

  const updateBrowser = <K extends keyof BrowserSettings>(key: K, value: BrowserSettings[K]) => {
    setBrowserDraft((current) => current ? { ...current, [key]: value } : current)
    setMessage(null); setError(null)
  }

  const saveBrowser = async () => {
    if (!browserDraft) return
    setBusy('save-browser'); setMessage(null); setError(null)
    try {
      const saved = await window.pageAuto.updateAppSettings({ browser: browserDraft })
      const next = copyBrowser(saved.browser)
      setBrowserSaved(next); setBrowserDraft(copyBrowser(next))
      setMessage('Đã lưu cài đặt trình duyệt. Các lần mở Chrome tiếp theo sẽ dùng cấu hình này.')
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(null) }
  }

  const detectChrome = async () => {
    setBusy('detect'); setMessage(null); setError(null)
    try {
      const result = await window.pageAuto.detectChrome(); setBrowserProbe(result)
      if (result.status === 'found' && result.executablePath) updateBrowser('executablePath', result.executablePath)
      setMessage(result.message)
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(null) }
  }

  const pickChrome = async () => {
    setBusy('pick'); setMessage(null); setError(null)
    try {
      const result = await window.pageAuto.pickChromeExecutable()
      if (result.status !== 'canceled') setBrowserProbe(result)
      if (result.status === 'found' && result.executablePath) updateBrowser('executablePath', result.executablePath)
      if (result.status !== 'canceled') setMessage(result.message)
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(null) }
  }

  const testChrome = async () => {
    if (!browserDraft) return
    setBusy('test'); setMessage(null); setError(null); setBrowserTest(null)
    try {
      const result = await window.pageAuto.testBrowser({ settings: browserDraft })
      setBrowserTest(result)
      if (result.executablePath) setBrowserProbe({ status: result.status === 'success' ? 'found' : 'invalid', executablePath: result.executablePath, version: result.version, message: result.message })
      if (result.status === 'success') setMessage(result.message); else setError(result.message)
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(null) }
  }

  const toggleProvider = (providerId: CaptchaProviderId, enabled: boolean) => {
    setEnabledProviders((current) => ({ ...current, [providerId]: enabled }))
    if (!enabled && defaultProvider === providerId) setDefaultProvider(null)
  }

  const saveCaptcha = async () => {
    setBusy('captcha'); setMessage(null); setError(null)
    try {
      const payload: SaveCaptchaSettingsInput = {
        defaultProvider: defaultProvider && enabledProviders[defaultProvider] ? defaultProvider : null,
        providers: {
          omocaptcha: { enabled: enabledProviders.omocaptcha, apiKey: apiKeyDrafts.omocaptcha, clearApiKey: clearKeys.omocaptcha },
          ezcaptcha: { enabled: enabledProviders.ezcaptcha, apiKey: apiKeyDrafts.ezcaptcha, clearApiKey: clearKeys.ezcaptcha },
          '2captcha': { enabled: enabledProviders['2captcha'], apiKey: apiKeyDrafts['2captcha'], clearApiKey: clearKeys['2captcha'] }
        }
      }
      const saved = await window.pageAuto.saveCaptchaSettings(payload)
      setCaptcha(saved); setDefaultProvider(saved.defaultProvider)
      setEnabledProviders({ omocaptcha: saved.providers.omocaptcha.enabled, ezcaptcha: saved.providers.ezcaptcha.enabled, '2captcha': saved.providers['2captcha'].enabled })
      setApiKeyDrafts(emptyProviderText()); setClearKeys(emptyProviderFlags()); setRevealedDrafts(emptyProviderFlags()); setMessage('Đã lưu CAPTCHA.')
    } catch (caught) { setError(errorText(caught)) } finally { setBusy(null) }
  }

  const exportBackup = async () => { setBusy('export'); setMessage(null); setError(null); try { const result = await window.pageAuto.exportConfigBackup(); setMessage(result.message) } catch (caught) { setError(errorText(caught)) } finally { setBusy(null) } }
  const restoreBackup = async () => { setBusy('restore'); setMessage(null); setError(null); try { const result = await window.pageAuto.restoreConfigBackup(); setMessage(result.message) } catch (caught) { setError(errorText(caught)) } finally { setBusy(null) } }

  const browserPanel = browserDraft ? <div className="settings-section browser-section">
    <div className="browser-status-grid"><div><span>Phiên bản Chrome</span><strong>{browserProbe?.version ?? 'Chưa đọc được'}</strong></div><div><span>Tình trạng Chrome</span><strong className={browserProbe?.status === 'found' ? 'status-ok' : ''}>{browserProbe?.status === 'found' ? 'Đã tìm thấy' : 'Chưa sẵn sàng'}</strong></div><div className="path-card"><span>Thư mục dữ liệu</span><strong title={appInfo?.dataDirectory ?? ''}>{appInfo?.dataDirectory ?? 'Đang đọc...'}</strong></div></div>
    <div className="browser-form-grid">
      <label className="field span-3"><span>Đường dẫn Chrome</span><div className="path-input-row"><input value={browserDraft.executablePath ?? ''} onChange={(event) => updateBrowser('executablePath', event.target.value || null)} placeholder="Chọn chrome.exe" /><button className="settings-button" type="button" disabled={busy !== null} onClick={() => void pickChrome()}>Chọn file</button><button className="settings-button" type="button" disabled={busy !== null} onClick={() => void detectChrome()}>{busy === 'detect' ? 'Đang tìm...' : 'Tự tìm Chrome'}</button><button className="settings-button primary" type="button" disabled={busy !== null} onClick={() => void testChrome()}>{busy === 'test' ? 'Đang kiểm tra...' : 'Kiểm tra Chrome'}</button></div></label>
      <label className="field"><span>Cách mở Chrome</span><select value={browserDraft.mode} onChange={(event) => updateBrowser('mode', event.target.value as BrowserSettings['mode'])}><option value="visible">Hiện Chrome</option><option value="minimized">Thu nhỏ Chrome</option></select></label>
      <label className="field"><span>Kích thước cửa sổ</span><select value={`${browserDraft.windowWidth}x${browserDraft.windowHeight}`} onChange={(event) => { const [width, height] = event.target.value.split('x').map(Number); if (width && height) { updateBrowser('windowWidth', width); updateBrowser('windowHeight', height) } }}><option value="1280x720">1280 x 720</option><option value="1280x800">1280 x 800</option><option value="1366x768">1366 x 768</option><option value="1440x900">1440 x 900</option><option value="1920x1080">1920 x 1080</option></select></label>
      <div className="field"><span>Kết quả kiểm tra</span><div className={`test-result ${browserTest?.status === 'success' ? 'ok' : browserTest ? 'bad' : ''}`}>{browserTest ? (browserTest.status === 'success' ? `Hoạt động · ${browserTest.launchDurationMs ?? 0} ms` : 'Không mở được') : 'Chưa kiểm tra'}</div></div>
      <label className="toggle-card"><div><strong>Không tải ảnh</strong><small>Giảm băng thông khi chạy.</small></div><input type="checkbox" checked={browserDraft.disableImageLoading} onChange={(event) => updateBrowser('disableImageLoading', event.target.checked)} /></label>
      <label className="toggle-card"><div><strong>Tắt âm thanh</strong><small>Chrome không phát âm thanh.</small></div><input type="checkbox" checked={browserDraft.muteAudio} onChange={(event) => updateBrowser('muteAudio', event.target.checked)} /></label>
      <div className="toggle-card muted"><div><strong>Tăng tốc phần cứng</strong><small>Chỉnh trong mục Nâng cao.</small></div><span>{browserDraft.disableGpu ? 'Đang tắt' : 'Đang bật'}</span></div>
      <label className="number-field"><span>Chờ trước khi mở Chrome</span><div><input type="number" min="0" value={browserDraft.startupDelayMs / 1000} onChange={(event) => updateBrowser('startupDelayMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div></label>
      <label className="number-field"><span>Thời gian chờ Chrome mở</span><div><input type="number" min="1" value={browserDraft.startupTimeoutMs / 1000} onChange={(event) => updateBrowser('startupTimeoutMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div></label>
      <label className="number-field"><span>Thời gian chờ mở trang</span><div><input type="number" min="1" value={browserDraft.navigationTimeoutMs / 1000} onChange={(event) => updateBrowser('navigationTimeoutMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div></label>
      <label className="number-field"><span>Chờ trang ổn định</span><div><input type="number" min="0" value={browserDraft.pageSettleDelayMs / 1000} onChange={(event) => updateBrowser('pageSettleDelayMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div></label>
      <label className="number-field"><span>Tự đóng Chrome sau</span><div><input type="number" min="1" value={browserDraft.maxLifetimeMinutes} onChange={(event) => updateBrowser('maxLifetimeMinutes', Number(event.target.value))} /><em>phút</em></div></label>
    </div>
  </div> : <div className="settings-empty">Đang đọc cài đặt...</div>

  const captchaPanel = <div className="settings-section captcha-section"><div className="compact-heading"><div><strong>CAPTCHA Providers</strong><span>API key đã lưu luôn được che.</span></div><label><span>Provider mặc định</span><select value={defaultProvider ?? ''} onChange={(event) => { const next = event.target.value as CaptchaProviderId | ''; setDefaultProvider(next || null); if (next) setEnabledProviders((current) => ({ ...current, [next]: true })) }}><option value="">Chưa chọn</option>{providerDefinitions.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label></div><div className="captcha-list">{providerDefinitions.map((provider) => { const state = captcha?.providers[provider.id]; return <div className="captcha-row" key={provider.id}><label className="captcha-name"><input type="checkbox" checked={enabledProviders[provider.id]} onChange={(event) => toggleProvider(provider.id, event.target.checked)} /><strong>{provider.name}</strong></label><div className="captcha-key"><input type={revealedDrafts[provider.id] ? 'text' : 'password'} autoComplete="off" value={apiKeyDrafts[provider.id]} disabled={clearKeys[provider.id]} onChange={(event) => setApiKeyDrafts((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder={state?.configured ? `Đã lưu: ${state.maskedApiKey ?? '••••••••'}` : 'Nhập API key'} /><button type="button" className="settings-button small" onClick={() => setRevealedDrafts((current) => ({ ...current, [provider.id]: !current[provider.id] }))}>{revealedDrafts[provider.id] ? 'Ẩn' : 'Hiện'}</button></div><label className="clear-key"><input type="checkbox" checked={clearKeys[provider.id]} disabled={!state?.configured} onChange={(event) => setClearKeys((current) => ({ ...current, [provider.id]: event.target.checked }))} /> Xóa key</label><span className={state?.configured ? 'provider-state ready' : 'provider-state'}>{state?.configured ? 'Đã lưu' : 'Chưa có key'}</span></div> })}</div><p className="safety-note">Checkpoint, đăng nhập lại và xác minh danh tính vẫn xử lý thủ công; không đưa qua CAPTCHA provider.</p></div>

  const placeholder = (title: string, copy: string) => <div className="settings-section placeholder-section"><div className="placeholder-mark">✓</div><h3>{title}</h3><p>{copy}</p><span>Chưa hiển thị nút cài đặt ở đây để tránh tạo control chưa có tác dụng thật.</span></div>
  const advancedPanel = browserDraft ? <div className="settings-section advanced-section"><div className="advanced-grid"><label className="toggle-card wide"><div><strong>Tắt tăng tốc phần cứng</strong><small>Dùng khi VPS hoặc máy yếu gặp lỗi hiển thị Chrome.</small></div><input type="checkbox" checked={browserDraft.disableGpu} onChange={(event) => updateBrowser('disableGpu', event.target.checked)} /></label><div className="info-card"><span>Phiên bản PAGE-AUTO</span><strong>{appInfo ? `v${appInfo.version}` : '...'}</strong><small>{appInfo?.isPackaged ? 'Bản portable' : 'Bản development'}</small></div><div className="info-card path-card"><span>Data</span><strong title={appInfo?.dataDirectory ?? ''}>{appInfo?.dataDirectory ?? '...'}</strong><small>SQLite, profile, log và screenshot.</small></div></div><div className="backup-box"><div><strong>Sao lưu cấu hình</strong><p>Backup không chứa password, cookie, 2FA, proxy password hay CAPTCHA API key.</p></div><div><button className="settings-button primary" type="button" disabled={busy !== null} onClick={() => void exportBackup()}>{busy === 'export' ? 'Đang xuất...' : 'Xuất backup'}</button><button className="settings-button" type="button" disabled={busy !== null} onClick={() => void restoreBackup()}>{busy === 'restore' ? 'Đang khôi phục...' : 'Khôi phục backup'}</button></div></div></div> : <div className="settings-empty">Đang đọc cài đặt...</div>
  const healthPanel = <div className="settings-section health-section"><div className="health-grid"><div><span>Ứng dụng</span><strong>PAGE-AUTO {appInfo ? `v${appInfo.version}` : ''}</strong><small>Đã khởi động</small></div><div><span>Chrome</span><strong>{browserProbe?.status === 'found' ? 'Đã tìm thấy' : 'Cần kiểm tra'}</strong><small>{browserProbe?.version ?? 'Chưa có phiên bản'}</small></div><div className="path-card"><span>Thư mục dữ liệu</span><strong title={appInfo?.dataDirectory ?? ''}>{appInfo?.dataDirectory ?? '...'}</strong><small>Local</small></div></div><p>Kiểm tra SQLite / Playwright / Worker đầy đủ sẽ được nối ở lô chẩn đoán hệ thống. Lô này chỉ hiển thị trạng thái đã có dữ liệu thật.</p></div>

  let panel = browserPanel
  if (activeSection === 'captcha') panel = captchaPanel
  else if (activeSection === 'advanced') panel = advancedPanel
  else if (activeSection === 'health') panel = healthPanel
  else if (activeSection === 'session') panel = placeholder('Đăng nhập', 'Phần kiểm tra session và xử lý account cần đăng nhập lại thuộc Lô 3.')
  else if (activeSection === 'network') panel = placeholder('Proxy & Mạng', 'Kiểm tra proxy, timeout và chính sách mạng thuộc Lô 4.')
  else if (activeSection === 'runtime') panel = placeholder('Vận hành', 'Giới hạn worker, thời gian chạy account và recovery thuộc Lô 5.')
  else if (activeSection === 'logs') panel = placeholder('Nhật ký', 'Mức log, lưu ảnh lỗi và dọn log thuộc Lô 6.')

  const showBrowserFooter = activeSection === 'browser' || activeSection === 'advanced'
  const showCaptchaFooter = activeSection === 'captcha'

  return <div className="settings-shell"><aside className="settings-menu" aria-label="Nhóm cài đặt"><div className="settings-menu-title">CÀI ĐẶT</div>{sections.map((section) => <button type="button" key={section.id} className={activeSection === section.id ? 'settings-menu-item active' : 'settings-menu-item'} onClick={() => { setActiveSection(section.id); setMessage(null); setError(null) }}><span>{section.mark}</span>{section.label}</button>)}</aside><section className="settings-detail"><div className="settings-detail-head"><div><p>{sections.find((section) => section.id === activeSection)?.label}</p><h2>{activeSection === 'browser' ? 'Thiết lập trình duyệt' : sections.find((section) => section.id === activeSection)?.label}</h2></div><span className="settings-version">{appInfo ? `v${appInfo.version}` : '...'}</span></div><div className="settings-detail-body">{message ? <div className="settings-toast success">{message}</div> : null}{error ? <div className="settings-toast error">{error}</div> : null}{panel}</div><div className="settings-footer">{showBrowserFooter ? <><button type="button" className="settings-button" disabled={!browserDraft || busy !== null} onClick={() => setBrowserDraft(copyBrowser(DEFAULT_APP_SETTINGS.browser))}>Khôi phục mặc định</button><div><button type="button" className="settings-button" disabled={!browserDirty || busy !== null} onClick={() => browserSaved && setBrowserDraft(copyBrowser(browserSaved))}>Hủy thay đổi</button><button type="button" className="settings-button primary" disabled={!browserDirty || busy !== null} onClick={() => void saveBrowser()}>{busy === 'save-browser' ? 'Đang lưu...' : 'Lưu cài đặt'}</button></div></> : null}{showCaptchaFooter ? <><span /><div><button type="button" className="settings-button primary" disabled={busy !== null || captcha === null} onClick={() => void saveCaptcha()}>{busy === 'captcha' ? 'Đang lưu...' : 'Lưu CAPTCHA'}</button></div></> : null}{!showBrowserFooter && !showCaptchaFooter ? <><span /><span className="footer-note">Màn này chưa có thay đổi cần lưu.</span></> : null}</div></section></div>
}
