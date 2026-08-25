import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../../ipc/channels'
import { DEFAULT_APP_SETTINGS, type BrowserSettings } from '../../../shared/appSettings'
import type { BrowserExecutableResult, BrowserTestResult } from '../../../shared/browserSettings'
import {
  CHROME_MIN_COMPACT_OUTER_SIDE_PX,
  DEFAULT_BROWSER_WINDOW_LAYOUT,
  DEFAULT_COMPACT_OUTER_SIDE_PX,
  MAX_COMPACT_OUTER_SIDE_PX,
  rectangularBrowserTileGrid,
  withCompactBrowserTileSide,
  type BrowserDisplayInfo,
  type BrowserWindowLayoutSettings
} from '../../../shared/browserWindowLayout'
import './settingsSections.css'

interface BrowserSettingsSectionProps { appInfo: AppInfo | null }
type BusyState = 'save' | 'detect' | 'pick' | 'test' | 'retile' | null

const COMPACT_SIZE_PRESETS = [
  { label: 'Nhỏ', sidePx: 500 },
  { label: 'Vừa', sidePx: 600 },
  { label: 'Lớn', sidePx: 800 }
] as const

function copyBrowser(settings: BrowserSettings): BrowserSettings { return { ...settings } }
function copyLayout(settings: BrowserWindowLayoutSettings): BrowserWindowLayoutSettings { return { ...settings } }
function errorText(caught: unknown): string { return caught instanceof Error ? caught.message : String(caught) }

export function BrowserSettingsSection({ appInfo }: BrowserSettingsSectionProps) {
  const [saved, setSaved] = useState<BrowserSettings | null>(null)
  const [draft, setDraft] = useState<BrowserSettings | null>(null)
  const [savedLayout, setSavedLayout] = useState<BrowserWindowLayoutSettings | null>(null)
  const [layout, setLayout] = useState<BrowserWindowLayoutSettings | null>(null)
  const [displays, setDisplays] = useState<BrowserDisplayInfo[]>([])
  const [probe, setProbe] = useState<BrowserExecutableResult | null>(null)
  const [test, setTest] = useState<BrowserTestResult | null>(null)
  const [busy, setBusy] = useState<BusyState>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  const dirty = useMemo(() => Boolean(
    saved && draft && savedLayout && layout
    && (JSON.stringify(saved) !== JSON.stringify(draft) || JSON.stringify(savedLayout) !== JSON.stringify(layout))
  ), [draft, layout, saved, savedLayout])

  const previewDisplay = useMemo(() => {
    if (!layout) return null
    if (layout.targetDisplayId !== null) {
      const selected = displays.find((display) => display.id === layout.targetDisplayId)
      if (selected) return selected
    }
    return displays.find((display) => display.isPrimary) ?? displays[0] ?? null
  }, [displays, layout])
  const grid = useMemo(() => {
    if (!layout || !previewDisplay) return null
    return rectangularBrowserTileGrid(layout, previewDisplay)
  }, [layout, previewDisplay])
  const tileSidePx = layout?.tileSidePx ?? DEFAULT_COMPACT_OUTER_SIDE_PX

  useEffect(() => {
    void Promise.all([
      window.pageAuto.getAppSettings(),
      window.pageAuto.getBrowserWindowLayout(),
      window.pageAuto.listBrowserDisplays()
    ]).then(async ([settings, windowLayout, browserDisplays]) => {
      const browser = copyBrowser(settings.browser)
      setSaved(browser)
      setDraft(copyBrowser(browser))
      setSavedLayout(copyLayout(windowLayout))
      setLayout(copyLayout(windowLayout))
      setDisplays(browserDisplays)
      setProbe(browser.executablePath ? await window.pageAuto.probeChromeExecutable(browser.executablePath) : await window.pageAuto.detectChrome())
    }).catch((caught) => setFeedback({ kind: 'bad', text: errorText(caught) }))
  }, [])

  const update = <K extends keyof BrowserSettings>(key: K, value: BrowserSettings[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current)
    setFeedback(null)
  }

  const updateLayout = <K extends keyof BrowserWindowLayoutSettings>(key: K, value: BrowserWindowLayoutSettings[K]) => {
    setLayout((current) => current ? { ...current, [key]: value } : current)
    setFeedback(null)
  }

  const updateTileSide = (sidePx: number) => {
    setLayout((current) => current ? withCompactBrowserTileSide(current, sidePx) : current)
    setFeedback(null)
  }

  const save = async () => {
    if (!draft || !layout) return
    setBusy('save'); setFeedback(null)
    try {
      const next = await window.pageAuto.updateAppSettings({ browser: draft })
      const nextLayout = await window.pageAuto.saveBrowserWindowLayout(layout)
      const browser = copyBrowser(next.browser)
      setSaved(browser); setDraft(copyBrowser(browser))
      setSavedLayout(copyLayout(nextLayout)); setLayout(copyLayout(nextLayout))
      setFeedback({ kind: 'ok', text: 'Đã lưu cài đặt trình duyệt và cách xếp Chrome.' })
    } catch (caught) { setFeedback({ kind: 'bad', text: errorText(caught) }) } finally { setBusy(null) }
  }

  const detectChrome = async () => {
    setBusy('detect'); setFeedback(null)
    try {
      const result = await window.pageAuto.detectChrome(); setProbe(result)
      if (result.status === 'found' && result.executablePath) update('executablePath', result.executablePath)
      setFeedback({ kind: result.status === 'found' ? 'ok' : 'bad', text: result.message })
    } catch (caught) { setFeedback({ kind: 'bad', text: errorText(caught) }) } finally { setBusy(null) }
  }

  const pickChrome = async () => {
    setBusy('pick'); setFeedback(null)
    try {
      const result = await window.pageAuto.pickChromeExecutable()
      if (result.status !== 'canceled') setProbe(result)
      if (result.status === 'found' && result.executablePath) update('executablePath', result.executablePath)
      if (result.status !== 'canceled') setFeedback({ kind: result.status === 'found' ? 'ok' : 'bad', text: result.message })
    } catch (caught) { setFeedback({ kind: 'bad', text: errorText(caught) }) } finally { setBusy(null) }
  }

  const testChrome = async () => {
    if (!draft) return
    setBusy('test'); setFeedback(null); setTest(null)
    try {
      const result = await window.pageAuto.testBrowser({ settings: draft }); setTest(result)
      if (result.executablePath) setProbe({ status: result.status === 'success' ? 'found' : 'invalid', executablePath: result.executablePath, version: result.version, message: result.message })
      setFeedback({ kind: result.status === 'success' ? 'ok' : 'bad', text: result.message })
    } catch (caught) { setFeedback({ kind: 'bad', text: errorText(caught) }) } finally { setBusy(null) }
  }

  const retile = async () => {
    setBusy('retile'); setFeedback(null)
    try {
      const result = await window.pageAuto.retileBrowserWindows()
      setFeedback({ kind: result.status === 'success' ? 'ok' : 'bad', text: result.message })
    } catch (caught) { setFeedback({ kind: 'bad', text: errorText(caught) }) } finally { setBusy(null) }
  }

  if (!draft || !layout) return <div className="settings-empty">Đang đọc cài đặt trình duyệt...</div>

  const compactSummary = grid
    ? `${tileSidePx}px · ${grid.columns} cột × ${grid.rows} hàng · ${grid.capacity} Chrome/lớp. Vượt sức chứa sẽ xếp lớp lệch vị trí ổn định.`
    : `${tileSidePx}px · sức chứa được tính theo màn hình đích khi mở Chrome.`

  return <div className="settings-section settings-section-with-actions">
    <div className="settings-section-content"><div className="browser-section">
      <div className="browser-status-grid"><div><span>Phiên bản Chrome</span><strong>{probe?.version ?? 'Chưa đọc được'}</strong></div><div><span>Tình trạng Chrome</span><strong className={probe?.status === 'found' ? 'status-ok' : ''}>{probe?.status === 'found' ? 'Đã tìm thấy' : 'Chưa sẵn sàng'}</strong></div><div className="path-card"><span>Thư mục dữ liệu</span><strong title={appInfo?.dataDirectory ?? ''}>{appInfo?.dataDirectory ?? 'Đang đọc...'}</strong></div></div>
      <div className="browser-form-grid">
        <label className="field span-3"><span>Đường dẫn Chrome</span><div className="path-input-row"><input value={draft.executablePath ?? ''} onChange={(event) => update('executablePath', event.target.value || null)} placeholder="Chọn chrome.exe" /><button className="settings-button" type="button" disabled={busy !== null} onClick={() => void pickChrome()}>Chọn file</button><button className="settings-button" type="button" disabled={busy !== null} onClick={() => void detectChrome()}>{busy === 'detect' ? 'Đang tìm...' : 'Tự tìm Chrome'}</button><button className="settings-button primary" type="button" disabled={busy !== null} onClick={() => void testChrome()}>{busy === 'test' ? 'Đang kiểm tra...' : 'Kiểm tra Chrome'}</button></div></label>
        <label className="field"><span>Cách mở Chrome</span><select value={draft.mode} onChange={(event) => { const mode = event.target.value as BrowserSettings['mode']; update('mode', mode); if (mode === 'minimized') updateLayout('enabled', false) }}><option value="visible">Hiện Chrome</option><option value="minimized">Ẩn xuống taskbar</option></select></label>
        <div className="field"><span>Khung automation</span><div className="test-result ok">Desktop ổn định · tự scale</div></div>
        <div className="field"><span>Kết quả kiểm tra</span><div className={`test-result ${test?.status === 'success' ? 'ok' : test ? 'bad' : ''}`}>{test ? (test.status === 'success' ? `Hoạt động · ${test.launchDurationMs ?? 0} ms` : 'Không mở được') : 'Chưa kiểm tra'}</div></div>

        <label className="toggle-card span-3"><div><strong>Compact / xếp nhiều Chrome</strong><small>Chọn kích thước ô vuông. App tự xếp số cột × hàng theo working area thật của màn hình; không ép lưới N×N.</small></div><input type="checkbox" checked={layout.enabled} onChange={(event) => { updateLayout('enabled', event.target.checked); if (event.target.checked) update('mode', 'visible') }} /></label>
        {layout.enabled && <>
          <div className="field span-2"><span>Mức kích thước Chrome</span><div className="path-input-row">{COMPACT_SIZE_PRESETS.map((preset) => <button key={preset.sidePx} type="button" className={`settings-button ${tileSidePx === preset.sidePx ? 'primary' : ''}`} onClick={() => updateTileSide(preset.sidePx)}>{preset.label} · {preset.sidePx}px</button>)}</div></div>
          <label className="number-field"><span>Tùy chỉnh kích thước</span><div><input type="number" min={CHROME_MIN_COMPACT_OUTER_SIDE_PX} max={MAX_COMPACT_OUTER_SIDE_PX} step="50" value={tileSidePx} onChange={(event) => updateTileSide(Number(event.target.value) || DEFAULT_COMPACT_OUTER_SIDE_PX)} /><em>px</em></div></label>
          <div className="field"><span>Bố cục thực tế</span><div className="test-result ok">{grid ? `${grid.columns} cột × ${grid.rows} hàng` : 'Theo màn hình đích'}</div></div>
          <div className="field"><span>Sức chứa/lớp</span><div className="test-result ok">{grid ? `${grid.capacity} Chrome` : 'Tự tính khi mở'}</div></div>
          <label className="field span-2"><span>Màn hình đích</span><select value={layout.targetDisplayId ?? ''} onChange={(event) => updateLayout('targetDisplayId', event.target.value ? Number(event.target.value) : null)}><option value="">Màn hình tại vị trí chuột</option>{displays.map((display) => <option key={display.id} value={display.id}>{display.label}{display.isPrimary ? ' · Chính' : ''}</option>)}</select></label>
          <div className="field"><span>Chrome đang mở</span><button type="button" className="settings-button" disabled={busy !== null || dirty} onClick={() => void retile()}>{busy === 'retile' ? 'Đang xếp...' : 'Sắp xếp lại Chrome'}</button></div>
        </>}

        <label className="toggle-card"><div><strong>Không tải ảnh</strong><small>Giảm băng thông khi chạy.</small></div><input type="checkbox" checked={draft.disableImageLoading} onChange={(event) => update('disableImageLoading', event.target.checked)} /></label>
        <label className="toggle-card"><div><strong>Tắt âm thanh</strong><small>Chrome không phát âm thanh.</small></div><input type="checkbox" checked={draft.muteAudio} onChange={(event) => update('muteAudio', event.target.checked)} /></label>
        <div className="toggle-card muted"><div><strong>Tăng tốc phần cứng</strong><small>Chỉnh trong mục Nâng cao.</small></div><span>{draft.disableGpu ? 'Đang tắt' : 'Đang bật'}</span></div>
        <label className="number-field"><span>Chờ trước khi mở Chrome</span><div><input type="number" min="0" value={draft.startupDelayMs / 1000} onChange={(event) => update('startupDelayMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div></label>
        <label className="number-field"><span>Thời gian chờ Chrome mở</span><div><input type="number" min="1" value={draft.startupTimeoutMs / 1000} onChange={(event) => update('startupTimeoutMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div></label>
        <label className="number-field"><span>Thời gian chờ mở trang</span><div><input type="number" min="1" value={draft.navigationTimeoutMs / 1000} onChange={(event) => update('navigationTimeoutMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div></label>
        <label className="number-field"><span>Chờ trang ổn định</span><div><input type="number" min="0" value={draft.pageSettleDelayMs / 1000} onChange={(event) => update('pageSettleDelayMs', Math.round(Number(event.target.value) * 1000))} /><em>giây</em></div></label>
        <label className="number-field"><span>Tự đóng Chrome sau</span><div><input type="number" min="1" value={draft.maxLifetimeMinutes} onChange={(event) => update('maxLifetimeMinutes', Number(event.target.value))} /><em>phút</em></div></label>
      </div>
    </div></div>
    <div className="inline-settings-actions"><span className={`inline-settings-feedback ${feedback?.kind ?? ''}`}>{feedback?.text ?? (dirty ? 'Có thay đổi chưa lưu.' : compactSummary)}</span><div><button type="button" className="settings-button" disabled={busy !== null} onClick={() => { setDraft(copyBrowser(DEFAULT_APP_SETTINGS.browser)); setLayout(copyLayout(DEFAULT_BROWSER_WINDOW_LAYOUT)) }}>Mặc định</button><button type="button" className="settings-button" disabled={!dirty || busy !== null} onClick={() => { if (saved) setDraft(copyBrowser(saved)); if (savedLayout) setLayout(copyLayout(savedLayout)) }}>Hủy</button><button type="button" className="settings-button primary" disabled={!dirty || busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Đang lưu...' : 'Lưu cài đặt'}</button></div></div>
  </div>
}
